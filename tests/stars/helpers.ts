import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

export const FIXTURES = path.join(__dirname, '..', '..', 'scripts', 'stars', '__fixtures__')
export const REPO = path.join(__dirname, '..', '..')

export function fixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8')
}

let snapshotCache: Record<string, string> | null = null
/** 20261 plainOfferings anlik goruntusu (61 bolum, 2026-09-25). */
export function snapshot20261(): Record<string, string> {
  snapshotCache ??= JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FIXTURES, 'snapshot', 'plainOfferings-20261.json.gz'))).toString())
  return snapshotCache!
}

/**
 * Gecici repo koku (STARS_ROOT). Canli repo verisine baglanmamak icin sabit girdiler:
 * semesters.json (20261 guncel), eski scraper'in 20261 offerings'i (commit cba4890,
 * snapshot/offerings-20261-v1.json.gz), lastUpdate.json ve bos gpa-data.json.
 */
export function tempRoot(options: { offerings?: boolean } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stars-'))
  const data = path.join(dir, 'public', 'scheduler', 'data')
  fs.mkdirSync(path.join(data, 'offerings'), { recursive: true })
  fs.writeFileSync(
    path.join(data, 'semesters.json'),
    JSON.stringify([
      { year: '2026-2027', code: '20261', name: 'Fall' },
      { year: '2025-2026', code: '20253', name: 'Summer' },
      { year: '2025-2026', code: '20252', name: 'Spring' },
      { year: '2025-2026', code: '20251', name: 'Fall' },
    ]),
  )
  fs.writeFileSync(path.join(data, 'lastUpdate.json'), JSON.stringify({ lastUpdate: '2026-09-25T16:29:59.039Z', semester: '20261' }))
  fs.writeFileSync(path.join(data, 'gpa-data.json'), '{}')
  if (options.offerings !== false) fs.writeFileSync(path.join(data, 'offerings', '20261.json'), offeringsV1())
  process.env.STARS_ROOT = dir
  return dir
}

export function offeringsV1(): string {
  return zlib.gunzipSync(fs.readFileSync(path.join(FIXTURES, 'snapshot', 'offerings-20261-v1.json.gz'))).toString()
}

export type Route = (url: URL) => { status: number; body?: string } | null

/** URL'ye gore cevap veren sahte fetch; eslesmeyen istek 404. Istekleri kaydeder. */
export function mockFetch(...routes: Route[]) {
  const calls: string[] = []
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    calls.push(url.pathname + url.search)
    for (const route of routes) {
      const hit = route(url)
      if (hit) return new Response(hit.body ?? '', { status: hit.status })
    }
    return new Response('', { status: 404 })
  }) as typeof fetch
  return { impl, calls }
}

/** Standart STARS rotalari: bolum listesi + 20261 anlik goruntusu + schedule fixture'lari. */
export function starsRoutes(overrides: Route[] = []): Route[] {
  const snap = snapshot20261()
  const schedules: Record<string, string> = {
    'CS 101-1': 'schedule-CS_101-1-20261.html',
    'ECON 102-1': 'schedule-ECON_102-1-20261.html',
    'CHEM 101-1': 'schedule-CHEM_101-1-20261.html',
    'ENG 101-1': 'schedule-ENG_101-1-20261.html',
  }
  return [
    ...overrides,
    (u) => (u.pathname.endsWith('/plainCourseCodes.php') ? { status: 200, body: fixture('plainCourseCodes.html') } : null),
    (u) => {
      if (!u.pathname.endsWith('/plainOfferings.php')) return null
      const dept = u.searchParams.get('COURSE_CODE') ?? ''
      const sem = u.searchParams.get('SEMESTER')
      if (sem === '20261' && snap[dept]) return { status: 200, body: snap[dept] }
      // bilinmeyen donem/bolum: bos tablo
      return { status: 200, body: "<table id='poTable'><thead></thead><tbody></tbody></table>" }
    },
    (u) => {
      if (!u.pathname.endsWith('/schedule.php')) return null
      const file = schedules[u.searchParams.get('COURSE') ?? '']
      return { status: 200, body: file ? fixture(file) : fixture('schedule-TURK_101-1-20261.html') }
    },
  ]
}

export const noSleep = async () => {}
