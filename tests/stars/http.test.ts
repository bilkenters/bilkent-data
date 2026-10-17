import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StarsClient, StarsFetchError, StarsHaltError } from '../../scripts/stars/http'

/** Sahte saat: sleep aninda doner, zamani ilerletir, bekleme surelerini kaydeder. */
function fakeClock() {
  let now = 1_000_000
  const sleeps: number[] = []
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      now += ms
    },
    sleeps,
  }
}

function mockFetch(responder: (url: string, call: number) => { status: number; body?: string } | Error) {
  const calls: string[] = []
  const impl = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const result = responder(url, calls.length)
    if (result instanceof Error) throw result
    return new Response(result.body ?? '', { status: result.status })
  }) as typeof fetch
  return { impl, calls }
}

const quiet = () => {}

test('200 returns body and counts statuses', async () => {
  const clock = fakeClock()
  const { impl } = mockFetch(() => ({ status: 200, body: 'ok' }))
  const client = new StarsClient({ fetchImpl: impl, sleep: clock.sleep, now: clock.now, log: quiet })
  assert.equal(await client.get('https://x/a'), 'ok')
  assert.equal(client.stats.requests, 1)
  assert.deepEqual(client.stats.statuses, { '200': 1 })
})

test('429 backs off 2, 4 s then succeeds', async () => {
  const clock = fakeClock()
  const { impl, calls } = mockFetch((_, n) => (n <= 2 ? { status: 429, body: 'slow down' } : { status: 200, body: 'ok' }))
  const logs: string[] = []
  const client = new StarsClient({ fetchImpl: impl, sleep: clock.sleep, now: clock.now, log: (m) => logs.push(m) })
  assert.equal(await client.get('https://x/a'), 'ok')
  assert.equal(calls.length, 3)
  assert.ok(clock.sleeps.includes(2000) && clock.sleeps.includes(4000))
  assert.equal(client.stats.retries, 2)
  assert.ok(logs.some((l) => l.includes('429') && l.includes('slow down')), 'status + body snippet logged')
})

test('5xx exhausts backoff (2,4,8,16) then throws StarsFetchError', async () => {
  const clock = fakeClock()
  const { impl, calls } = mockFetch(() => ({ status: 503 }))
  const client = new StarsClient({ fetchImpl: impl, sleep: clock.sleep, now: clock.now, log: quiet })
  await assert.rejects(client.get('https://x/a'), StarsFetchError)
  assert.equal(calls.length, 5)
  for (const ms of [2000, 4000, 8000, 16000]) assert.ok(clock.sleeps.includes(ms))
})

test('423 halts immediately and blocks every later request', async () => {
  const clock = fakeClock()
  const { impl, calls } = mockFetch((url) => (url.endsWith('/b') ? { status: 423, body: 'Too many requests' } : { status: 200, body: 'ok' }))
  const client = new StarsClient({ fetchImpl: impl, sleep: clock.sleep, now: clock.now, log: quiet })
  await client.get('https://x/a')
  await assert.rejects(client.get('https://x/b'), (e: unknown) => e instanceof StarsHaltError && e.reason === 'locked')
  await assert.rejects(client.get('https://x/c'), StarsHaltError)
  assert.deepEqual(calls, ['https://x/a', 'https://x/b'], 'no retry, no further request after 423')
  assert.equal(client.halted, 'locked')
})

test('10 consecutive failures trip the circuit breaker', async () => {
  const clock = fakeClock()
  const { impl, calls } = mockFetch(() => ({ status: 404 }))
  const client = new StarsClient({ fetchImpl: impl, sleep: clock.sleep, now: clock.now, log: quiet })
  const urls = Array.from({ length: 15 }, (_, i) => `https://x/${i}`)
  const result = await client.runAll(urls, (u) => client.get(u))
  assert.equal(client.halted, 'breaker')
  assert.equal(calls.length, 10)
  assert.equal(result.failed.length, 9)
  assert.equal(result.skipped.length, 6)
})

test('allowNotFound returns null and does not count toward the breaker', async () => {
  const clock = fakeClock()
  const { impl } = mockFetch(() => ({ status: 404 }))
  const client = new StarsClient({ fetchImpl: impl, sleep: clock.sleep, now: clock.now, log: quiet, breakerThreshold: 3 })
  for (let i = 0; i < 5; i++) assert.equal(await client.get(`https://x/${i}`, { allowNotFound: true }), null)
  assert.equal(client.halted, null)
})

test('budget stops the run; remaining items are skipped', async () => {
  const clock = fakeClock()
  const { impl, calls } = mockFetch(() => ({ status: 200, body: 'ok' }))
  const client = new StarsClient({ fetchImpl: impl, sleep: clock.sleep, now: clock.now, log: quiet, budget: 3 })
  const result = await client.runAll(['a', 'b', 'c', 'd', 'e'], (u) => client.get(`https://x/${u}`))
  assert.equal(calls.length, 3)
  assert.equal(result.done.length, 3)
  assert.equal(result.skipped.length, 2)
  assert.equal(client.halted, 'budget')
})

test('request starts are spaced by at least minIntervalMs (<= 3 req/s)', async () => {
  // sanal saat: sleep, saati beklenen baslangic anina ilerletir (gercek zamanlayici yok, deterministik)
  let now = 0
  const starts: number[] = []
  const impl = (async () => {
    starts.push(now)
    return new Response('ok', { status: 200 })
  }) as typeof fetch
  const client = new StarsClient({
    fetchImpl: impl,
    now: () => now,
    sleep: (ms) => {
      const target = now + ms
      return Promise.resolve().then(() => {
        now = Math.max(now, target)
      })
    },
    log: quiet,
  })
  await client.runAll(Array.from({ length: 10 }, (_, i) => i), (i) => client.get(`https://x/${i}`), 2)
  assert.equal(starts.length, 10)
  const sorted = [...starts].sort((a, b) => a - b)
  assert.deepEqual(sorted, starts, 'baslangiclar sirali')
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 400, `gap ${starts[i] - starts[i - 1]}`)
  assert.ok((starts.length - 1) / ((starts[9] - starts[0]) / 1000) <= 2.5)
})

test('concurrency: never more than 2 in flight, heavy requests one at a time', async () => {
  let inFlight = 0
  let maxInFlight = 0
  let heavyInFlight = 0
  let maxHeavy = 0
  const impl = (async (input: string | URL | Request) => {
    const heavy = String(input).includes('heavy')
    inFlight++
    if (heavy) heavyInFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    maxHeavy = Math.max(maxHeavy, heavyInFlight)
    await new Promise((r) => setTimeout(r, 5))
    inFlight--
    if (heavy) heavyInFlight--
    return new Response('ok', { status: 200 })
  }) as typeof fetch
  const client = new StarsClient({ fetchImpl: impl, minIntervalMs: 0, log: quiet })
  const jobs = Array.from({ length: 12 }, (_, i) => (i % 2 ? `https://x/heavy/${i}` : `https://x/light/${i}`))
  await client.runAll(jobs, (u) => client.get(u, { heavy: u.includes('heavy') }), 4)
  assert.ok(maxInFlight <= 2, `maxInFlight ${maxInFlight}`)
  assert.equal(maxHeavy, 1)
})

test('network errors are retried and reported as ERR:<code>', async () => {
  const clock = fakeClock()
  const { impl } = mockFetch((_, n) => (n === 1 ? Object.assign(new Error('boom'), { cause: { code: 'ECONNRESET' } }) : { status: 200, body: 'ok' }))
  const client = new StarsClient({ fetchImpl: impl, sleep: clock.sleep, now: clock.now, log: quiet })
  assert.equal(await client.get('https://x/a'), 'ok')
  assert.equal(client.stats.statuses['ERR:ECONNRESET'], 1)
})
