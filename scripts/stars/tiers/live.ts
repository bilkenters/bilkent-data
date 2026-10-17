import type { RawCourse, RawOfferings, RawSection } from '../../../lib/offerings/types'
import { ajaxUrl } from '../http'
import { courseGpa, instructorGpa } from '../lib/gpa'
import type { Ctx } from '../lib/context'
import { readJson } from '../lib/json'
import { paths } from '../lib/paths'
import { nextSemesters, semesterInfo } from '../lib/semesters'
import { CourseStore, InstructorStore, compareCodes, shortHash } from '../lib/store'
import type { OfferingRow } from '../parse/offerings'
import { parseSchedulePage } from '../parse/schedule-page'
import { meetingsToSlots } from '../parse/schedule-text'
import { joinInstructorNames } from '../parse/util'
import type { DepartmentsFile, ScheduleCacheFile } from '../types'
import { fetchDepartments, fetchOfferings } from './common'

export interface LiveOptions {
  semester?: string
  /** schedule.php icin ust sinir (donem basinda ~2.000) */
  scheduleBudget?: number
  /** yeni donem kontrolunu atla (backfill/test) */
  skipNewSemester?: boolean
}

export interface LiveResult {
  semester: string
  offeringsChanged: boolean
  newSemester: string | null
  totalCourses: number
  totalDepartments: number
  skipped: string | null
}

type Semester = { year: string; code: string; name: string }

async function detectNewSemester(ctx: Ctx, semesters: Semester[]): Promise<Semester | null> {
  const latest = semesters[0]?.code
  if (!latest) return null
  for (const code of nextSemesters(latest)) {
    if (semesters.some((s) => s.code === code)) continue
    for (const dept of ['MATH', 'ENG']) {
      const rows = await fetchOfferings(ctx, dept, code).catch(() => null)
      if (rows && rows.length > 0) {
        ctx.log(`✓ yeni donem: ${code}`)
        return semesterInfo(code)
      }
    }
  }
  return null
}

const GPA_KEYS = ['averageGpa', 'letterGrade', 'gpaSampleSize', 'gpaSemesters'] as const
const INSTRUCTOR_GPA_KEYS = ['instructorGpa', 'instructorLetterGrade', 'instructorGpaSampleSize'] as const

/** Bir bolumun satirlarini offerings bicimine cevirir (GPA ve spare/tur sonradan eklenir). */
export function buildDepartment(rows: OfferingRow[]): Record<string, RawCourse> {
  const courses: Record<string, RawCourse> = {}
  for (const row of rows) {
    let course = courses[row.course]
    if (!course) {
      course = courses[row.course] = {
        name: row.name,
        credits: row.credits ?? 0,
        ects: row.ects ?? 0,
        lectureHours: row.lectureHours ?? 0,
        labHours: row.labHours ?? 0,
        sections: {},
      }
    }
    const section: RawSection = {
      instructor: joinInstructorNames(row.instructors),
      instructors: row.instructors,
      schedule: meetingsToSlots(row.meetings),
    }
    if (row.quota) {
      const { kind, ...quota } = row.quota
      section.quota = quota
    }
    if (row.enrollment) section.enrollment = row.enrollment
    course.sections[row.section] = section
  }
  for (const course of Object.values(courses)) {
    course.sections = Object.fromEntries(
      Object.entries(course.sections).sort(([a], [b]) => Number(a) - Number(b) || a.localeCompare(b)),
    )
  }
  return courses
}

function copyKeys<T extends object>(target: T, source: object | undefined, keys: readonly string[]): void {
  if (!source) return
  for (const key of keys) {
    const value = (source as Record<string, unknown>)[key]
    if (value !== undefined && value !== null) (target as Record<string, unknown>)[key] = value
  }
}

/** Anahtar sirasi sabit: diff okunur kalsin. */
function orderCourse(course: RawCourse): RawCourse {
  const { name, credits, ects, lectureHours, labHours, averageGpa, letterGrade, gpaSampleSize, gpaSemesters, sections, ...rest } = course
  return { name, credits, ects, lectureHours, labHours, averageGpa, letterGrade, gpaSampleSize, gpaSemesters, ...rest, sections }
}

function orderSection(section: RawSection): RawSection {
  const { instructor, instructors, schedule, spare, kinds, quota, enrollment, instructorGpa: g, instructorLetterGrade, instructorGpaSampleSize, ...rest } = section
  return { instructor, instructors, schedule, spare, kinds, quota, enrollment, instructorGpa: g, instructorLetterGrade, instructorGpaSampleSize, ...rest }
}

export async function runLive(ctx: Ctx, options: LiveOptions = {}): Promise<LiveResult> {
  const semesters = readJson<Semester[]>(paths.semesters(), [])
  let newSemester: Semester | null = null
  if (!options.skipNewSemester && !options.semester) {
    newSemester = await detectNewSemester(ctx, semesters)
    if (newSemester) {
      semesters.unshift(newSemester)
      ctx.writer.write(paths.semesters(), semesters)
    }
  }
  const semester = options.semester ?? semesters[0]?.code
  if (!semester) throw new Error('semesters.json bos')

  // 1) bolumler + plainOfferings (her bolum 1 istek)
  const departments = await fetchDepartments(ctx)
  const results = new Map<string, OfferingRow[] | null>()
  await ctx.client.runAll(departments, async (dept) => {
    results.set(dept.code, await fetchOfferings(ctx, dept.code, semester))
  })

  const previous = readJson<RawOfferings>(paths.offerings(semester), {})
  const nonEmpty = [...results].filter(([, rows]) => rows && rows.length > 0).map(([code]) => code)
  const failed = departments.filter((d) => !results.get(d.code)).map((d) => d.code)
  const previousCount = Object.keys(previous).length
  ctx.coverage.departments = departments.length
  ctx.coverage.departmentsOk = departments.length - failed.length
  ctx.coverage.departmentsWithOfferings = nonEmpty.length
  if (failed.length) ctx.log(`   bolum yaniti yok/gecersiz: ${failed.join(' ')}`)
  if (previousCount > 0 && nonEmpty.length < 0.9 * previousCount) {
    ctx.log(`!! ${nonEmpty.length} bolum < onceki ${previousCount} x %90: offerings YAZILMADI`)
    return { semester, offeringsChanged: false, newSemester: newSemester?.code ?? null, totalCourses: 0, totalDepartments: 0, skipped: 'department-threshold' }
  }

  // 2) offerings: yanit gelen bolum yeniden kurulur, gelmeyen bolumun onceki verisi korunur
  const next: RawOfferings = {}
  const deptCodes = [...new Set([...Object.keys(previous), ...nonEmpty])].sort()
  const rowsByKey = new Map<string, OfferingRow>()
  for (const dept of deptCodes) {
    const rows = results.get(dept)
    if (rows === undefined || rows === null) {
      if (previous[dept]) next[dept] = previous[dept]
      continue
    }
    if (rows.length === 0) continue
    next[dept] = buildDepartment(rows)
    for (const row of rows) rowsByKey.set(`${row.course}-${row.section}`, row)
  }

  // 3) schedule.php: yalnizca saat metni degisen / yeni subeler
  const cachePath = paths.scheduleCache(semester)
  const cache = readJson<ScheduleCacheFile>(cachePath, {})
  const todo: Array<{ key: string; hash: string }> = []
  for (const [key, row] of rowsByKey) {
    if (row.meetings.length === 0) {
      delete cache[key]
      continue
    }
    const hash = shortHash(row.scheduleText)
    if (cache[key]?.h !== hash) todo.push({ key, hash })
  }
  for (const key of Object.keys(cache)) {
    const dept = key.split(' ')[0]
    if (results.get(dept) && !rowsByKey.has(key)) delete cache[key]
  }
  const scheduleBudget = options.scheduleBudget ?? 2500
  const queue = todo.slice(0, scheduleBudget)
  let mismatched = 0
  let fetched = 0
  await ctx.client.runAll(queue, async ({ key, hash }) => {
    const html = await ctx.client.get(ajaxUrl('schedule.php', { COURSE: key, SEMESTER: semester }))
    const page = parseSchedulePage(html ?? '')
    const textSlots = Object.keys(meetingsToSlots(rowsByKey.get(key)!.meetings))
    const pageSlots = Object.keys(page.schedule)
    if (textSlots.join(',') !== pageSlots.sort((a, b) => Number(a) - Number(b)).join(',')) {
      mismatched++
      ctx.log(`   schedule.php slot farki ${key}: metin=[${textSlots}] sayfa=[${pageSlots}]`)
      // bos sayfa buyuk olasilikla aksaklik: onbellege alma, sonraki calismada yeniden dene
      if (pageSlots.length === 0) return
    }
    const allowed = new Set(textSlots)
    cache[key] = {
      h: hash,
      spare: page.spare.filter((slot) => allowed.has(String(slot))).sort((a, b) => a - b),
      kinds: Object.fromEntries(Object.entries(page.kinds).filter(([slot]) => allowed.has(slot))),
    }
    fetched++
  })
  ctx.coverage.scheduleFetched = fetched
  ctx.coverage.schedulePending = todo.length - fetched
  ctx.coverage.scheduleMismatch = mismatched

  // 4) spare/tur + GPA (course katmani onbelleginden; yoksa onceki deger korunur)
  const courses = new CourseStore()
  const instructors = new InstructorStore()
  let sections = 0
  let withSchedule = 0
  let withKinds = 0
  let withSpare = 0
  let withGpa = 0
  for (const dept of Object.keys(next)) {
    if (!results.get(dept)) continue
    for (const [code, course] of Object.entries(next[dept])) {
      const prevCourse = previous[dept]?.[code]
      const record = courses.get(code)
      const checked = Boolean(ctx.state.course[code]) && record
      if (checked) {
        const gpa = courseGpa(record!.history, semester)
        if (gpa) Object.assign(course, gpa)
      } else {
        copyKeys(course, prevCourse, GPA_KEYS)
      }
      if (course.averageGpa != null) withGpa++

      for (const [no, section] of Object.entries(course.sections)) {
        sections++
        const key = `${code}-${no}`
        const scheduleKeys = Object.keys(section.schedule ?? {})
        if (scheduleKeys.length) withSchedule++
        const cached = cache[key]
        const row = rowsByKey.get(key)
        if (cached && row && cached.h === shortHash(row.scheduleText)) {
          if (cached.spare.length) {
            section.spare = cached.spare
            withSpare++
          }
          if (Object.keys(cached.kinds).length) {
            section.kinds = cached.kinds
            withKinds++
          }
        }
        for (const ref of section.instructors ?? []) instructors.addName(ref.id, ref.name)
        const single = section.instructors?.length === 1 ? section.instructors[0] : null
        if (checked) {
          const ig = single?.id ? instructorGpa(record!.history, single.id, semester) : null
          if (ig) {
            section.instructorGpa = ig.gpa
            section.instructorLetterGrade = ig.letterGrade
            section.instructorGpaSampleSize = ig.sampleSize
          }
        } else {
          const prevSection = prevCourse?.sections?.[no]
          if (prevSection && single && prevSection.instructor === section.instructor) copyKeys(section, prevSection, INSTRUCTOR_GPA_KEYS)
        }
        course.sections[no] = orderSection(section)
      }
      next[dept][code] = orderCourse(course)
    }
    next[dept] = Object.fromEntries(Object.entries(next[dept]).sort(([a], [b]) => compareCodes(a, b)))
  }

  const offeringsChanged = ctx.writer.write(paths.offerings(semester), next)
  ctx.writer.write(cachePath, Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b))))
  instructors.flush(ctx.writer)

  // bolum sozlugu: ad + fakulte (katalog linki catalog/curriculum katmanindan)
  const previousDepartments = readJson<DepartmentsFile>(paths.departments(), {})
  const departmentsFile: DepartmentsFile = {}
  for (const dept of [...departments].sort((a, b) => a.code.localeCompare(b.code))) {
    departmentsFile[dept.code] = { name: dept.name, faculty: dept.faculty, catalogUrl: previousDepartments[dept.code]?.catalogUrl ?? null }
  }
  ctx.writer.write(paths.departments(), departmentsFile)

  const totalCourses = Object.values(next).reduce((sum, dept) => sum + Object.keys(dept).length, 0)
  Object.assign(ctx.coverage, { semester, sections, withSchedule, withKinds, withSpare, courses: totalCourses, coursesWithGpa: withGpa })
  return { semester, offeringsChanged, newSemester: newSemester?.code ?? null, totalCourses, totalDepartments: Object.keys(next).length, skipped: null }
}
