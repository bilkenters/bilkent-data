import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { RawOfferings } from '../../lib/offerings/types'
import { run } from '../../scripts/stars/run'
import type { CourseFile, CurriculumFile, InstructorsFile, PrereqGraph, StateFile, SyllabusFile } from '../../scripts/stars/types'
import { fixture, mockFetch, noSleep, snapshot20261, starsRoutes, tempRoot, type Route } from './helpers'

const quiet = () => {}
const read = <T>(dir: string, rel: string): T => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'))

async function tier(tierName: Parameters<typeof run>[0]['tier'], routes: Route[], extra: Partial<Parameters<typeof run>[0]> = {}) {
  const { impl, calls } = mockFetch(...routes)
  const result = await run({ tier: tierName, fetchImpl: impl, log: quiet, sleep: noSleep, ...extra })
  return { ...result, calls }
}

const oldOfferingsRoute: Route = (u) => {
  if (!u.pathname.endsWith('/courses.oldOfferings.php')) return null
  const course = u.searchParams.get('COURSE')
  if (course === 'CS 202') return { status: 200, body: fixture('oldOfferings-CS_202.html') }
  if (course === 'EDU 113') return { status: 200, body: fixture('oldOfferings-EDU_113.html') }
  return { status: 200, body: '<div>no such course</div>' }
}

test('course: oldOfferings -> CourseRecord, prereq tree + graph, instructor names; heavy lane', async () => {
  const dir = tempRoot()
  const result = await tier('course', [oldOfferingsRoute], { only: ['CS 202', 'EDU 113', 'XYZ 999'] })
  assert.equal(result.calls.length, 3)
  const cs = read<CourseFile>(dir, 'data/stars/courses/CS.json')['CS 202']
  assert.equal(cs.prerequisite, 'CS 201 and (MATH 132 or MATH 210)')
  assert.deepEqual(cs.prerequisiteTree, { and: [{ course: 'CS 201' }, { or: [{ course: 'MATH 132' }, { course: 'MATH 210' }] }] })
  assert.equal(cs.history.length, 131)
  assert.deepEqual(cs.history[0], ['20253', '1', ['8438'], 46, 2.17, 2.17])
  assert.equal(cs.inCatalog, false)
  assert.equal(read<CourseFile>(dir, 'data/stars/courses/EDU.json')['EDU 113'].prerequisite, null)
  const graph = read<PrereqGraph>(dir, 'data/stars/prereq-graph.json')
  assert.deepEqual(graph.edges, [['CS 202', 'CS 201', 'and'], ['CS 202', 'MATH 132', 'or'], ['CS 202', 'MATH 210', 'or']])
  assert.deepEqual(graph.reverse['CS 201'], ['CS 202'])
  assert.equal(read<InstructorsFile>(dir, 'data/stars/instructors.json')['8438'].name, 'Aynur Dayanık')
  const state = read<StateFile>(dir, 'data/stars/state.json')
  assert.ok(state.course['XYZ 999'], 'bulunamayan ders de kontrol edildi sayilir')
  assert.equal(state.lastRun.course.coverage.notFound, 1)

  // ayni icerik -> fetchedAt ve dosya sabit (yalnizca state degisir)
  const second = await tier('course', [oldOfferingsRoute], { only: ['CS 202'] })
  assert.deepEqual(second.changed.map((f) => path.basename(f)), ['state.json'])
})

test('course queue: never-checked offered courses first, then catalog, then oldest', async () => {
  const dir = tempRoot()
  fs.mkdirSync(path.join(dir, 'data/stars/courses'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'data/stars/courses/AAA.json'), JSON.stringify({ 'AAA 100': { name: 'x', history: [] } }))
  const result = await tier('course', [oldOfferingsRoute], { limit: 3 })
  const asked = result.calls.map((c) => decodeURIComponent(c.split('COURSE=')[1]))
  const offered = new Set(Object.values(read<RawOfferings>(dir, 'public/scheduler/data/offerings/20261.json')).flatMap((d) => Object.keys(d)))
  assert.ok(asked.every((c) => offered.has(c)), asked.join(','))
})

test('catalog: courses.list -> inCatalog records with hours; academic_units -> catalog links', async () => {
  const dir = tempRoot({ offerings: false })
  fs.mkdirSync(path.join(dir, 'data/stars'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'data/stars/departments.json'), JSON.stringify({ CTIS: { name: 'Information Systems', faculty: 'X', catalogUrl: null } }))
  const routes: Route[] = [
    (u) => (u.pathname.endsWith('/plainCourseCodes.php') ? { status: 200, body: fixture('plainCourseCodes.html') } : null),
    (u) => {
      if (!u.pathname.endsWith('/courses.list.php')) return null
      const dept = u.searchParams.get('CRSCODES')
      if (dept === 'CS') return { status: 200, body: fixture('courses.list-CS.html') }
      if (dept === 'EDU') return { status: 200, body: fixture('courses.list-EDU.html') }
      return { status: 200, body: "<table id='courseList'><tbody></tbody></table>" }
    },
    (u) => (u.pathname.endsWith('/academic_units.php') ? { status: 200, body: fixture('academic_units.html') } : null),
  ]
  await tier('catalog', routes)
  const cs = read<CourseFile>(dir, 'data/stars/courses/CS.json')
  assert.equal(Object.keys(cs).length, 115)
  assert.deepEqual(cs['CS 101'].hours, { lectureOnline: 0, lectureF2F: 3, recitation: 0, labF2F: 4, labOnline: 0 })
  assert.equal(cs['CS 101'].inCatalog, true)
  assert.deepEqual(cs['CS 101'].history, [])
  assert.equal(read<Record<string, { catalogUrl: string }>>(dir, 'data/stars/departments.json').CTIS.catalogUrl, 'https://catalog.bilkent.edu.tr/current/dep/d18.html')
})

test('syllabus: one request per distinct instructor set, sections share variant hash', async () => {
  const dir = tempRoot()
  // CS 101 subeleri tek hocali (Lori Russell Dag) -> 1 istek
  const offerings = read<RawOfferings>(dir, 'public/scheduler/data/offerings/20261.json')
  fs.writeFileSync(path.join(dir, 'public/scheduler/data/offerings/20261.json'), JSON.stringify({ CS: { 'CS 101': offerings.CS['CS 101'] } }))
  const route: Route = (u) =>
    u.pathname.startsWith('/syllabus/show/20261/CS/101/') ? { status: 200, body: fixture('syllabus-20261-CS-101-1.html') } : null
  const result = await tier('syllabus', [route])
  const instructorsSets = new Set(Object.values(offerings.CS['CS 101'].sections).map((s) => s.instructor))
  assert.equal(result.calls.length, instructorsSets.size)
  const file = read<SyllabusFile>(dir, 'data/stars/syllabi/20261/CS.json')['CS 101']
  const hashes = new Set(Object.values(file.sections))
  assert.equal(Object.keys(file.sections).length, Object.keys(offerings.CS['CS 101'].sections).length)
  assert.equal(hashes.size, 1)
  assert.equal(file.variants[[...hashes][0]].assessments.length, 5)
  // hafta dolmadan tekrar: istek yok
  const again = await tier('syllabus', [route])
  assert.equal(again.calls.length, 0)
})

test('staff: title/web by STARS ID; list name replaced by display name; no contact data', async () => {
  const dir = tempRoot({ offerings: false })
  fs.mkdirSync(path.join(dir, 'data/stars'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'data/stars/instructors.json'), JSON.stringify({ '9412': { name: 'Can Alkan', title: null, dept: null, web: null } }))
  const routes: Route[] = [
    (u) => (u.pathname.endsWith('/academic_units.php') ? { status: 200, body: fixture('academic_units.html') } : null),
    (u) => (u.pathname.endsWith('/staff.list.php') && u.searchParams.get('DEPT') === 'CS' ? { status: 200, body: fixture('staff.list-SAMPLE.html') } : null),
    (u) => (u.pathname.endsWith('/staff.list.php') ? { status: 200, body: "<table id='staffList'></table>" } : null),
  ]
  await tier('staff', routes)
  const file = read<InstructorsFile>(dir, 'data/stars/instructors.json')
  assert.deepEqual(file['9412'], { name: 'Can Alkan', title: 'PROFESSOR', dept: 'CS', web: 'http://www.cs.bilkent.edu.tr/~calkan/' })
  assert.equal(file['1111'].name, 'Aksoy Selim')
  const raw = fs.readFileSync(path.join(dir, 'data/stars/instructors.json'), 'utf8')
  assert.doesNotMatch(raw, /0000|XX|mail|phone|office/i)
})

test('curriculum: programs, semesters, elective group lists (major/minor only)', async () => {
  const dir = tempRoot({ offerings: false })
  const routes: Route[] = [
    (u) => (u.pathname.endsWith('/academic_units.php') ? { status: 200, body: fixture('academic_units.html') } : null),
    (u) => (u.pathname.endsWith('/homepage/curriculum.php') && u.searchParams.get('DEPT') === 'CTIS' ? { status: 200, body: fixture('curriculum-CTIS.html') } : null),
    (u) => {
      if (!u.pathname.endsWith('/curriculum.printableHTML.php')) return null
      const program = u.searchParams.get('PROGRAM')
      return { status: 200, body: fixture(`curriculum.printable-${program}.html`) }
    },
    (u) => {
      if (!u.pathname.endsWith('/curriculum.electiveCourses.php')) return null
      const key = `${u.searchParams.get('PROGRAM')}-${u.searchParams.get('CODE')}`
      const known = ['CTIS_BS_F-CTIS_F_UR', 'CTIS_MN-CTIS_MEL']
      return { status: 200, body: known.includes(key) ? fixture(`curriculum.electives-${key}.html`) : "<table class='printMod'></table>" }
    },
  ]
  await tier('curriculum', routes, { only: ['CTIS'] })
  const file = read<CurriculumFile>(dir, 'data/stars/curricula/CTIS.json')
  assert.deepEqual(file.programs.map((p) => [p.id, p.kind, p.semesters.length]), [['CTIS_BS_F', 'major', 8], ['CTIS_MN', 'minor', 1]])
  const groups = file.programs[0].electiveGroups!
  assert.equal(groups.find((g) => g.code === 'CTIS_F_UR')!.courses, null, '1.191 dersli acik secmeli saklanmaz')
  assert.ok(file.programs[1].electiveGroups![0].courses!.includes('CTIS 222'))
})

test('backfill: fills only missing fields; 20251 schedules rebuilt from text', async () => {
  const dir = tempRoot({ offerings: false })
  const snap = snapshot20261()
  // 20251 dosyasi: CS 101-1 saatsiz ve kredisiz (bozuk arsiv gibi), hoca "A  B" bicimi
  fs.mkdirSync(path.join(dir, 'public/scheduler/data/offerings'), { recursive: true })
  const broken: RawOfferings = {
    CS: { 'CS 101': { name: 'Algorithms and Programming I', sections: { '1': { instructor: 'Lori Russell Dağ', schedule: {} } } } },
    GE: {
      'GE 400': {
        name: 'Transdisciplinary Senior Project',
        sections: {
          '1': { instructor: 'Tolga Bölükbaşı  Bengü Cilalı', schedule: { '0': 'X-1' } },
          '2': { instructor: 'Bengü Yurtseven\u00a0\u00a0Eliza Gheorghe', schedule: {} },
        },
      },
    },
  }
  fs.writeFileSync(path.join(dir, 'public/scheduler/data/offerings/20251.json'), JSON.stringify(broken))
  const routes: Route[] = [
    (u) => (u.pathname.endsWith('/plainCourseCodes.php') ? { status: 200, body: fixture('plainCourseCodes.html') } : null),
    (u) => {
      if (!u.pathname.endsWith('/plainOfferings.php')) return null
      const dept = u.searchParams.get('COURSE_CODE') ?? ''
      return { status: 200, body: snap[dept] ?? "<div id='poDiv'>no course</div>" }
    },
  ]
  await tier('backfill', routes, { only: ['20251'] })
  const file = read<RawOfferings>(dir, 'public/scheduler/data/offerings/20251.json')
  const cs = file.CS['CS 101']
  assert.equal(cs.credits, 4)
  assert.deepEqual(Object.keys(cs.sections['1'].schedule!).map(Number), [2, 4, 9, 11, 16, 23, 36, 43])
  assert.equal(cs.sections['1'].quota?.total, 65)
  assert.equal(file.GE['GE 400'].sections['1'].instructor, 'Tolga Bölükbaşı, Bengü Cilalı')
  assert.equal(file.GE['GE 400'].sections['2'].instructor, 'Bengü Yurtseven, Eliza Gheorghe', 'NBSP ayiricili eski bicim')
  assert.notEqual(file.GE['GE 400'].sections['1'].schedule!['0'], 'X-1', 'onarim donemi: saatler metinden')
  assert.ok(Object.keys(file).length > 2, 'eksik dersler eklendi')
  const state = read<StateFile>(dir, 'data/stars/state.json')
  assert.equal(state.backfill['20251'].length, 61)
  // tamamlanan donem tekrar istenmez (yalnizca bolum listesi)
  const again = await tier('backfill', routes, { only: ['20251'] })
  assert.equal(again.calls.length, 1)
})

test('run(): unknown tier rejected by parseArgs', async () => {
  const { parseArgs } = await import('../../scripts/stars/run')
  assert.throws(() => parseArgs(['--tier=nope']))
  assert.deepEqual(parseArgs(['--tier=course', '--budget=5', '--dry-run', '--only=CS 202,EDU 113']), {
    tier: 'course', budget: 5, limit: undefined, semester: undefined, dryRun: true, only: ['CS 202', 'EDU 113'],
  })
})
