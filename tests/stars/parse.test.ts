import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseCatalog } from '../../scripts/stars/parse/catalog'
import { parseCurriculum, parseElectiveCourses, parseProgramList } from '../../scripts/stars/parse/curriculum'
import { parseAcademicUnits, parseDepartments } from '../../scripts/stars/parse/departments'
import { parseOfferings } from '../../scripts/stars/parse/offerings'
import { parseOldOfferings } from '../../scripts/stars/parse/old-offerings'
import { parseSchedulePage } from '../../scripts/stars/parse/schedule-page'
import { hourIndexes, meetingsToSlots, parseScheduleText } from '../../scripts/stars/parse/schedule-text'
import { parseStaffList } from '../../scripts/stars/parse/staff'
import { parseSyllabus } from '../../scripts/stars/parse/syllabus'
import { semesterFromLabel, splitSectionCode } from '../../scripts/stars/parse/util'
import { fixture } from './helpers'

test('plainCourseCodes: 61 departments with faculty', () => {
  const rows = parseDepartments(fixture('plainCourseCodes.html'))
  assert.equal(rows.length, 61)
  assert.deepEqual(rows[0], { code: 'ACC', name: 'Accounting Information Systems', faculty: 'School of Applied Languages' })
  assert.ok(rows.every((r) => r.faculty.length > 0))
})

test('academic_units: faculty headings, catalog links, heading-level units (LAW), EE unit code', () => {
  const units = parseAcademicUnits(fixture('academic_units.html'))
  const ctis = units.find((u) => u.code === 'CTIS')!
  assert.equal(ctis.faculty, 'Faculty of Applied Sciences')
  assert.equal(ctis.catalogUrl, 'https://catalog.bilkent.edu.tr/current/dep/d18.html')
  assert.equal(ctis.curriculum, true)
  assert.ok(units.find((u) => u.code === 'LAW')?.curriculum)
  assert.ok(units.find((u) => u.code === 'EE'))
})

test('plainOfferings GE: multi-instructor with IDs, Unlimited quota, Staff, schedule text', () => {
  const rows = parseOfferings(fixture('plainOfferings-GE-20261.html'))
  assert.equal(rows.length, 35)
  const ge400 = rows.find((r) => r.course === 'GE 400' && r.section === '1')!
  assert.deepEqual(ge400.instructors, [
    { id: '8580', name: 'Tolga Bölükbaşı' },
    { id: '13335', name: 'Bengü Cilalı' },
  ])
  assert.equal(ge400.scheduleText, 'Mon 15:30-17:20 (MA-Z05)\nTue 15:30-17:20 (MA-104)\nFri 10:30-12:20 (MA-104)')
  assert.deepEqual(ge400.quota, { assigned: 33, total: 33, available: 0, kind: 'Mand. or Elect.' })
  assert.deepEqual(ge400.enrollment, { mandatory: 33, elective: 0, total: 33 })
  assert.equal(ge400.credits, 6)
  assert.equal(ge400.ects, 8.5)

  const ge100 = rows.find((r) => r.course === 'GE 100')!
  assert.deepEqual(ge100.instructors, [])
  assert.deepEqual(ge100.quota, { assigned: 0, total: 0, available: 0, unlimited: true })
  assert.equal(ge100.enrollment?.total, 1664)
  assert.deepEqual(ge100.meetings, [])
  assert.equal(ge100.scheduleText, '')
})

test('plainOfferings HUM 20101: "-" quota/enrollment columns -> null; 20151 filled', () => {
  const old = parseOfferings(fixture('plainOfferings-HUM-20101.html'))
  assert.ok(old.length > 0)
  assert.ok(old.every((r) => r.quota === null && r.enrollment === null))
  assert.equal(old[0].instructors[0].id, '8281')
  const newer = parseOfferings(fixture('plainOfferings-HUM-20151.html'))
  assert.ok(newer.every((r) => r.quota !== null && r.enrollment !== null))
})

test('plainOfferings EDU: multi-instructor EDU 113-1', () => {
  const rows = parseOfferings(fixture('plainOfferings-EDU-20261.html'))
  const edu113 = rows.find((r) => r.course === 'EDU 113' && r.section === '1')!
  assert.ok(edu113.instructors.length > 1)
  assert.ok(edu113.instructors.every((i) => /^\d+$/.test(i.id)))
})

test('schedule text -> slot index (hour * 7 + day), end inclusive', () => {
  assert.deepEqual(hourIndexes('08:30', '12:20'), [0, 1, 2, 3])
  assert.deepEqual(hourIndexes('13:30', '15:20'), [5, 6])
  assert.deepEqual(hourIndexes('21:30', '22:20'), [13])
  const { meetings, unparsed } = parseScheduleText('Tue 13:30-15:20 (EA-Z03)<br /> Wed 08:30-12:20 (B-201)<br />Fri 10:30-11:20')
  assert.deepEqual(unparsed, [])
  assert.deepEqual(meetingsToSlots(meetings), {
    '2': 'B-201', '9': 'B-201', '16': 'B-201', '18': 'N/A', '23': 'B-201', '36': 'EA-Z03', '43': 'EA-Z03',
  })
})

test('schedule.php: kinds, spare without (S) in room, no schedule', () => {
  const cs = parseSchedulePage(fixture('schedule-CS_101-1-20261.html'))
  assert.deepEqual(cs.spare, [4])
  assert.equal(cs.schedule['4'], 'EA-Z03')
  assert.equal(cs.kinds['4'], 'DY')
  assert.equal(cs.kinds['2'], 'LL')
  assert.deepEqual(Object.keys(cs.schedule).map(Number), [2, 4, 9, 11, 16, 23, 36, 43])
  const econ = parseSchedulePage(fixture('schedule-ECON_102-1-20261.html'))
  assert.ok(Object.values(econ.kinds).includes('DR'))
  const turk = parseSchedulePage(fixture('schedule-TURK_101-1-20261.html'))
  assert.equal(turk.noSchedule, true)
  assert.deepEqual(turk.schedule, {})
})

test('oldOfferings CS 202: description, prerequisite, credits, all history rows', () => {
  const page = parseOldOfferings(fixture('oldOfferings-CS_202.html'))
  assert.equal(page.found, true)
  assert.equal(page.code, 'CS 202')
  assert.equal(page.prerequisite, 'CS 201 and (MATH 132 or MATH 210)')
  assert.match(page.description!, /^Abstract data types\./)
  assert.equal(page.credits, 3)
  assert.equal(page.ects, 5)
  assert.equal(page.rows.length, 131)
  assert.deepEqual(page.rows[0], { semester: '20253', section: '1', instructors: [{ id: '8438', name: 'Aynur Dayanık' }], students: 46, sectionGpa: 2.17, courseGpa: 2.17 })
  assert.deepEqual(page.rows.at(-1), { semester: '19902', section: '1', instructors: [], students: 36, sectionGpa: 2.89, courseGpa: 2.89 })
  // "semester error!" etiketli final tekrar satirlari link'teki koddan
  assert.ok(page.rows.some((r) => r.semester === '20158'))
})

test('oldOfferings EDU 113: prerequisite "none" -> null; unknown course -> found false', () => {
  const page = parseOldOfferings(fixture('oldOfferings-EDU_113.html'))
  assert.equal(page.prerequisite, null)
  assert.equal(page.rows.length, 1)
  assert.equal(parseOldOfferings('<div></div>').found, false)
})

test('courses.list: full catalog incl. hour split', () => {
  const cs = parseCatalog(fixture('courses.list-CS.html'))
  assert.equal(cs.length, 115)
  assert.deepEqual(cs.find((r) => r.code === 'CS 101'), {
    code: 'CS 101',
    name: 'Algorithms and Programming I',
    hours: { lectureOnline: 0, lectureF2F: 3, recitation: 0, labF2F: 4, labOnline: 0 },
    credits: 4,
    ects: 6.5,
  })
  assert.equal(parseCatalog(fixture('courses.list-EDU.html')).length, 33)
})

test('syllabus: assessments, FZ, weekly, textbooks, workload; missing course', () => {
  const cs = parseSyllabus(fixture('syllabus-20261-CS-101-1.html')).record!
  assert.equal(cs.coordinator, 'Uğur Doğrusöz')
  assert.deepEqual(cs.assessments.map((a) => [a.label, a.weight]), [['Final', 35], ['Midterm', 35], ['Homeworks', 5], ['Quizzes', 10], ['Labs', 15]])
  assert.match(cs.fzText!, /minimum of 40% on the midterm/)
  assert.equal(cs.weekly.length, 14)
  assert.equal(cs.textbooks.length, 1)
  assert.doesNotMatch(cs.textbooks[0], /download/)
  assert.equal(cs.ectsWorkloadTotal, 194.5)
  assert.equal(cs.prerequisiteText, null)

  const math = parseSyllabus(fixture('syllabus-20261-MATH-101-1.html')).record!
  assert.equal(math.assessments.reduce((s, a) => s + a.weight, 0), 100)
  assert.match(math.fzText!, /less than 40 points/)
  assert.equal(math.ectsWorkloadTotal, 190)

  const ge = parseSyllabus(fixture('syllabus-20261-GE-100-1.html')).record!
  assert.equal(ge.fzText, null, '"N/A" -> null')
  assert.deepEqual(parseSyllabus(fixture('syllabus-20261-CS-999-1.html')), { found: false, record: null })
})

test('staff list: only id, name, title, web — no phone/office/e-mail', () => {
  const rows = parseStaffList(fixture('staff.list-SAMPLE.html'))
  assert.deepEqual(rows[0], { id: '1111', listName: 'Aksoy Selim', title: 'PROFESSOR', web: 'http://www.cs.bilkent.edu.tr/~saksoy/' })
  assert.equal(rows[2].web, null)
  const serialized = JSON.stringify(rows)
  assert.doesNotMatch(serialized, /0000|XX|mail/i)
})

test('curriculum.php: program list with major/minor/other', () => {
  assert.deepEqual(
    parseProgramList(fixture('curriculum-CTIS.html')).map((p) => [p.program, p.kind]),
    [['CTIS_BS_F', 'major'], ['CTIS_MN', 'minor']],
  )
  assert.deepEqual(
    parseProgramList(fixture('curriculum-CS.html')).map((p) => [p.program, p.kind]),
    [['CS_BS', 'major'], ['CS_PHD', 'other'], ['CS_MS', 'other']],
  )
})

test('curriculum printable: 8 semesters, courses, elective boxes mapped to group codes', () => {
  const ctis = parseCurriculum(fixture('curriculum.printable-CTIS_BS_F.html'))
  assert.equal(ctis.semesters.length, 8)
  assert.equal(ctis.semesters[0].label, '1. Yıl Güz')
  assert.deepEqual(ctis.semesters[0].items[0], { course: 'CTIS 151', credits: 4 })
  assert.deepEqual(ctis.semesters[1].items.find((i) => 'elective' in i), { elective: 'Mathematics Elective', credits: 4, group: 'CTIS_F_MATH' })
  const last = ctis.semesters[7].items.at(-1)!
  assert.deepEqual(last, { elective: 'Information Systems Electives (2)', credits: 6, group: 'CTIS_F_RE' })
  assert.equal(ctis.prerequisites['CTIS 152'], 'CTIS 151')
  const cs = parseCurriculum(fixture('curriculum.printable-CS_BS.html'))
  assert.ok(cs.electiveGroups.some((g) => g.code === 'CS_RE' && g.count === 6))
  const minor = parseCurriculum(fixture('curriculum.printable-CTIS_MN.html'))
  assert.equal(minor.semesters.length, 1)
  assert.equal(parseElectiveCourses(fixture('curriculum.electives-CS_BS-CS_RE.html'))[0], 'CS 311')
})

test('helpers: section codes and semester labels', () => {
  assert.deepEqual(splitSectionCode('CS 202-001'), ['CS 202', '1'])
  assert.deepEqual(splitSectionCode('GE 100-1'), ['GE 100', '1'])
  assert.equal(semesterFromLabel('2025-2026 Summer'), '20253')
  assert.equal(semesterFromLabel('2014-2015 Fall Final Exam Retake'), '20147')
  assert.equal(semesterFromLabel('2015-2016 semester error!'), null)
})
