import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { RawOfferings } from '../../lib/offerings/types'
import { run } from '../../scripts/stars/run'
import { fixture, mockFetch, noSleep, starsRoutes, tempRoot, type Route } from './helpers'

const quiet = () => {}
const OFFERINGS = 'public/scheduler/data/offerings/20261.json'

function setup() {
  return tempRoot()
}

function snapshotFiles(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else out[path.relative(dir, full)] = fs.readFileSync(full, 'utf8')
    }
  }
  walk(dir)
  return out
}

/** yeni donem kontrolu: 20262/20271 icin bos tablo (starsRoutes varsayilani) */
async function live(routes: Route[], extra: Partial<Parameters<typeof run>[0]> = {}) {
  const { impl, calls } = mockFetch(...routes)
  const result = await run({ tier: 'live', fetchImpl: impl, log: quiet, sleep: noSleep, ...extra })
  return { ...result, calls }
}

test('live: writes offerings in the v2 contract; second run is a 0-diff no-op', async () => {
  const dir = setup()
  const first = await live(starsRoutes())
  assert.equal(first.summary.halted, null)
  assert.ok(first.changed.some((f) => f.endsWith('offerings/20261.json')))
  assert.ok(!fs.existsSync(path.join(dir, 'public/scheduler/data/gpa-data.json')), 'gpa-data.json silinir')

  const data: RawOfferings = JSON.parse(fs.readFileSync(path.join(dir, OFFERINGS), 'utf8'))
  const ge400 = data.GE['GE 400'].sections['1']
  assert.equal(ge400.instructor, 'Tolga Bölükbaşı, Bengü Cilalı')
  assert.deepEqual(ge400.instructors, [{ id: '8580', name: 'Tolga Bölükbaşı' }, { id: '13335', name: 'Bengü Cilalı' }])
  assert.deepEqual(data.GE['GE 100'].sections['1'].quota, { assigned: 0, total: 0, available: 0, unlimited: true })
  assert.equal(data.GE['GE 100'].sections['1'].instructor, 'Staff')
  // schedule.php onbellegi: CS 101-1 spare + tur, derslikte (S) yok
  const cs101 = data.CS['CS 101'].sections['1']
  assert.deepEqual(cs101.spare, [4])
  assert.equal(cs101.schedule!['4'], 'EA-Z03')
  assert.equal(cs101.kinds!['2'], 'LL')
  assert.equal(data.ECON['ECON 102'].sections['1'].kinds!['15'], 'DR')
  // GPA: course onbellegi yok -> onceki deger korunur (null ile ezilmez)
  assert.equal(data.CS['CS 101'].averageGpa != null, true)
  const lastUpdate = JSON.parse(fs.readFileSync(path.join(dir, 'public/scheduler/data/lastUpdate.json'), 'utf8'))
  assert.equal(lastUpdate.semester, '20261')
  assert.equal(typeof lastUpdate.run.requests, 'number')

  const before = snapshotFiles(dir)
  const second = await live(starsRoutes())
  assert.deepEqual(second.changed.filter((f) => !f.includes('schedule/20261.json')), [])
  const after = snapshotFiles(dir)
  // schedule.php'si bos donen (fixture'i olmayan) subeler yeniden denenir ama dosyalar ayni
  assert.deepEqual(after, before)
  assert.ok(!second.calls.some((c) => c.includes('CS%20101-1')), 'onbellekteki sube icin schedule.php cagrilmaz')
})

test('live: every request 503 -> run fails and no file changes', async () => {
  const dir = setup()
  const before = snapshotFiles(dir)
  await assert.rejects(live([() => ({ status: 503, body: 'down' })]))
  assert.deepEqual(snapshotFiles(dir), before)
})

test('live: plainOfferings 503 everywhere -> breaker, department threshold, nothing written', async () => {
  const dir = setup()
  const before = snapshotFiles(dir)
  const result = await live(starsRoutes([(u) => (u.pathname.endsWith('/plainOfferings.php') ? { status: 503 } : null)]))
  assert.equal(result.summary.halted, 'breaker')
  assert.deepEqual(result.changed, [])
  assert.deepEqual(snapshotFiles(dir), before)
})

test('live: 423 stops the run immediately (no new STARS request after the lock)', async () => {
  const dir = setup()
  const before = snapshotFiles(dir)
  let served = 0
  let lockedAt = -1
  const { impl, calls } = mockFetch(
    ...starsRoutes([
      (u) => {
        if (!u.pathname.endsWith('/plainOfferings.php') || u.searchParams.get('SEMESTER') !== '20261') return null
        served++
        if (served === 6) {
          lockedAt = calls.length
          return { status: 423, body: 'Too many requests' }
        }
        return null
      },
    ]),
  )
  const result = await run({ tier: 'live', fetchImpl: impl, log: quiet, sleep: noSleep })
  assert.equal(result.summary.halted, 'locked')
  // kilit aninda zaten yolda olan en fazla 1 istek (eszamanlilik 2); yenisi baslamaz
  assert.ok(calls.length - lockedAt <= 1, `kilitten sonra ${calls.length - lockedAt} istek`)
  assert.deepEqual(snapshotFiles(dir), before, 'esik altinda: hicbir dosya yazilmaz')
})

test('live: a failed department keeps its previous data', async () => {
  const dir = setup()
  const previous: RawOfferings = JSON.parse(fs.readFileSync(path.join(dir, OFFERINGS), 'utf8'))
  await live(starsRoutes([(u) => (u.searchParams.get('COURSE_CODE') === 'CS' ? { status: 500 } : null)]))
  const data: RawOfferings = JSON.parse(fs.readFileSync(path.join(dir, OFFERINGS), 'utf8'))
  assert.deepEqual(data.CS, previous.CS)
  assert.ok(data.GE['GE 400'].sections['1'].instructors, 'digerleri yeni bicimde')
})

test('live: GPA comes from the course cache (5-year window, student weighted)', async () => {
  const dir = setup()
  fs.mkdirSync(path.join(dir, 'data/stars/courses'), { recursive: true })
  const history = [
    ['20252', '1', ['5957'], 60, 2.5, 2.4],
    ['20252', '2', ['999'], 40, 2.2, 2.4],
    ['20251', '1', ['5957'], 50, 3.0, 3.0],
    ['20158', '1', ['5957'], 3, 0, 0],
    ['20152', '1', ['5957'], 80, 1.0, 1.0],
  ]
  fs.writeFileSync(
    path.join(dir, 'data/stars/courses/CS.json'),
    JSON.stringify({ 'CS 101': { name: 'Algorithms and Programming I', description: null, prerequisite: null, prerequisiteTree: null, credits: 4, ects: 6.5, hours: null, inCatalog: true, history, fetchedAt: '2026-09-25T00:00:00.000Z' } }),
  )
  fs.writeFileSync(path.join(dir, 'data/stars/state.json'), JSON.stringify({ course: { 'CS 101': '2026-09-25T00:00:00.000Z' } }))
  await live(starsRoutes())
  const data: RawOfferings = JSON.parse(fs.readFileSync(path.join(dir, OFFERINGS), 'utf8'))
  const course = data.CS['CS 101']
  // (2.4*100 + 3.0*50) / 150 = 2.6 ; 20152 pencere disi, 20158 final tekrar
  assert.equal(course.averageGpa, 2.6)
  assert.equal(course.gpaSampleSize, 150)
  assert.equal(course.gpaSemesters, 2)
  // hoca 5957: (2.5*60 + 3.0*50)/110 = 2.727 -> 2.73
  assert.equal(course.sections['1'].instructorGpa, 2.73)
  assert.equal(course.sections['1'].instructorGpaSampleSize, 110)
})

test('live: fixtures used by the harness exist', () => {
  assert.ok(fixture('plainCourseCodes.html').length > 1000)
})

test('live --dry-run: reports changes but writes nothing', async () => {
  const dir = setup()
  const before = snapshotFiles(dir)
  const result = await live(starsRoutes(), { dryRun: true })
  assert.ok(result.changed.length > 0)
  assert.deepEqual(snapshotFiles(dir), before)
})
