/**
 * STARS icin ortak HTTP istemcisi. Kurallar: docs/stars-veri/README.md "Rate-limit ayrıntısı".
 * - Global: istek baslangiclari arasi >= minIntervalMs (400 ms => <= 2,5 istek/sn),
 *   ayni anda en fazla `concurrency` istek; `heavy` istekler (oldOfferings) tek tek.
 * - 423 => calisma durur (StarsHaltError 'locked'); sonraki her get() aninda hata.
 * - 429/5xx/ag hatasi => 2, 4, 8, 16 s geri cekilme; sonra StarsFetchError.
 * - Art arda `breakerThreshold` hata => 'breaker'. Butce dolunca => 'budget'.
 */

export const STARS_BASE = 'https://stars.bilkent.edu.tr'
export const STARS_AJAX = `${STARS_BASE}/homepage/ajax`
export const USER_AGENT = 'bilkenters-bot/1.0 (+https://www.bilkenters.com)'

export type HaltReason = 'locked' | 'breaker' | 'budget'

export class StarsHaltError extends Error {
  constructor(public reason: HaltReason, message: string) {
    super(message)
    this.name = 'StarsHaltError'
  }
}

export class StarsFetchError extends Error {
  constructor(public status: number | string, public url: string) {
    super(`STARS ${status} ${url}`)
    this.name = 'StarsFetchError'
  }
}

export interface HttpStats {
  requests: number
  retries: number
  bytes: number
  statuses: Record<string, number>
  failures: number
  halted: HaltReason | null
  startedAt: string
  durationMs: number
}

export interface HttpOptions {
  fetchImpl?: typeof fetch
  concurrency?: number
  heavyConcurrency?: number
  minIntervalMs?: number
  budget?: number
  timeoutMs?: number
  backoffMs?: number[]
  breakerThreshold?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  log?: (msg: string) => void
}

export interface GetOptions {
  /** buyuk sayfa (oldOfferings): eszamanlilik 1 */
  heavy?: boolean
  /** 404'u hata saymadan null don (olmayan syllabus vb.) */
  allowNotFound?: boolean
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

class Semaphore {
  private queue: Array<() => void> = []
  private active = 0
  constructor(private size: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.size) {
      this.active++
      return
    }
    await new Promise<void>((resolve) => this.queue.push(resolve))
  }
  release(): void {
    const next = this.queue.shift()
    if (next) next()
    else this.active--
  }
}

export class StarsClient {
  readonly stats: HttpStats
  private readonly fetchImpl: typeof fetch
  private readonly minIntervalMs: number
  private readonly budget: number
  private readonly timeoutMs: number
  private readonly backoffMs: number[]
  private readonly breakerThreshold: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private readonly log: (msg: string) => void
  private readonly slots: Semaphore
  private readonly heavySlots: Semaphore
  private nextStartAt = 0
  private consecutiveFailures = 0
  private readonly t0: number

  constructor(options: HttpOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.minIntervalMs = options.minIntervalMs ?? 400
    this.budget = options.budget ?? Infinity
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.backoffMs = options.backoffMs ?? [2000, 4000, 8000, 16000]
    this.breakerThreshold = options.breakerThreshold ?? 10
    this.sleep = options.sleep ?? defaultSleep
    this.now = options.now ?? Date.now
    this.log = options.log ?? ((msg) => console.log(msg))
    this.slots = new Semaphore(options.concurrency ?? 2)
    this.heavySlots = new Semaphore(options.heavyConcurrency ?? 1)
    this.t0 = this.now()
    this.stats = {
      requests: 0,
      retries: 0,
      bytes: 0,
      statuses: {},
      failures: 0,
      halted: null,
      startedAt: new Date(this.t0).toISOString(),
      durationMs: 0,
    }
  }

  get halted(): HaltReason | null {
    return this.stats.halted
  }

  get remainingBudget(): number {
    return this.budget - this.stats.requests
  }

  private halt(reason: HaltReason, message: string): never {
    if (!this.stats.halted) {
      this.stats.halted = reason
      this.log(`!! STARS durduruldu (${reason}): ${message}`)
    }
    throw new StarsHaltError(this.stats.halted, message)
  }

  private checkHalt(url: string): void {
    if (this.stats.halted) throw new StarsHaltError(this.stats.halted, `halted before ${url}`)
  }

  /** Global aralik: her istek baslangici bir oncekinden en az minIntervalMs sonra. */
  private async pace(): Promise<void> {
    const now = this.now()
    const startAt = Math.max(now, this.nextStartAt)
    this.nextStartAt = startAt + this.minIntervalMs
    if (startAt > now) await this.sleep(startAt - now)
  }

  private count(status: number | string, bytes = 0): void {
    const key = String(status)
    this.stats.statuses[key] = (this.stats.statuses[key] ?? 0) + 1
    this.stats.bytes += bytes
    this.stats.durationMs = this.now() - this.t0
  }

  private fail(url: string, status: number | string): never {
    this.stats.failures++
    this.consecutiveFailures++
    if (this.consecutiveFailures >= this.breakerThreshold) {
      this.halt('breaker', `${this.consecutiveFailures} consecutive failures, last ${status} ${url}`)
    }
    throw new StarsFetchError(status, url)
  }

  async get(url: string, options: GetOptions = {}): Promise<string | null> {
    this.checkHalt(url)
    if (options.heavy) await this.heavySlots.acquire()
    await this.slots.acquire()
    try {
      for (let attempt = 0; ; attempt++) {
        this.checkHalt(url)
        if (this.stats.requests >= this.budget) this.halt('budget', `budget ${this.budget} reached`)
        // butceden once ayir: paralel seritler ayni son hakki ikisi birden almasin
        this.stats.requests++
        await this.pace()
        // butce dolmasi zaten ayrilmis istegi durdurmaz; kilit/devre kesici durdurur
        if (this.stats.halted && this.stats.halted !== 'budget') {
          this.stats.requests--
          this.checkHalt(url)
        }
        if (attempt > 0) this.stats.retries++

        let status: number | string
        let body = ''
        try {
          const response = await this.fetchImpl(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(this.timeoutMs),
          })
          status = response.status
          body = await response.text()
        } catch (error) {
          const err = error as { name?: string; cause?: { code?: string } }
          status = `ERR:${err.cause?.code ?? err.name ?? 'fetch'}`
        }
        this.count(status, body.length)

        if (status === 200) {
          this.consecutiveFailures = 0
          return body
        }
        const snippet = body.replace(/\s+/g, ' ').slice(0, 200)
        this.log(`   ${status} ${url} ${snippet ? `:: ${snippet}` : ''}`)

        if (status === 423) this.halt('locked', `423 Locked on ${url}`)
        if (status === 404 && options.allowNotFound) {
          this.consecutiveFailures = 0
          return null
        }
        const retryable = typeof status === 'string' || status === 429 || status >= 500
        if (retryable && attempt < this.backoffMs.length) {
          await this.sleep(this.backoffMs[attempt])
          continue
        }
        this.fail(url, status)
      }
    } finally {
      this.slots.release()
      if (options.heavy) this.heavySlots.release()
    }
  }

  /**
   * Isleri sirayla dagitir; halt olunca kalanlar baslatilmaz. Hata veren isler
   * `failed`'a duser, halt hatasi disari tasinmaz (durum `halted`'ta).
   */
  async runAll<T, R>(items: T[], worker: (item: T) => Promise<R>, parallel = 2): Promise<{ done: Array<[T, R]>; failed: T[]; skipped: T[] }> {
    const done: Array<[T, R]> = []
    const failed: T[] = []
    const skipped: T[] = []
    let cursor = 0
    const lane = async () => {
      while (cursor < items.length) {
        const item = items[cursor++]
        if (this.stats.halted) {
          skipped.push(item)
          continue
        }
        try {
          done.push([item, await worker(item)])
        } catch (error) {
          if (error instanceof StarsHaltError) skipped.push(item)
          else if (error instanceof StarsFetchError) failed.push(item)
          else throw error
        }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, parallel) }, lane))
    return { done, failed, skipped }
  }
}

export function ajaxUrl(endpoint: string, params: Record<string, string> = {}): string {
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
  return `${STARS_AJAX}/${endpoint}${query ? `?${query}` : ''}`
}
