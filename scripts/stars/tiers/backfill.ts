import type { RawCourse, RawOfferings, RawSection } from '../../../lib/offerings/types'
import type { Ctx } from '../lib/context'
import { readJson } from '../lib/json'
import { paths } from '../lib/paths'
import { compareCodes } from '../lib/store'
import type { OfferingRow } from '../parse/offerings'
import { buildDepartment } from './live'
import { fetchDepartments, fetchOfferings } from './common'

/** saatleri plainOfferings metninden bastan uretilecek donemler (arsive bozuk girmis) */
export const REPAIR_SEMESTERS = ['20251']
export const BACKFILL_FROM = '20201'

export interface BackfillOptions {
  semesters?: string[]
}

/**
 * Tek seferlik: 20201'den guncel donemden oncekine kadar (20201-20251 gorevi +
 * 20252/20253'te eksik hoca ID'leri) kredi/ECTS/saat/kontenjan/kayit ve hoca
 * ID'leri. Yalnizca eksik alanlar doldurulur; 20251'de saatler metinden yeniden
 * uretilir. Ilerleme state.backfill[donem] (tamamlanan bolumler).
 */
export function mergeSemester(existing: RawOfferings, dept: string, rows: OfferingRow[], repair: boolean): { changed: number } {
  const built = buildDepartment(rows)
  const target = (existing[dept] ??= {})
  let changed = 0
  for (const [code, fresh] of Object.entries(built)) {
    const course = target[code]
    if (!course) {
      target[code] = fresh
      changed++
      continue
    }
    for (const key of ['credits', 'ects', 'lectureHours', 'labHours'] as const) {
      if (course[key] === undefined && fresh[key] !== undefined) {
        course[key] = fresh[key]
        changed++
      }
    }
    for (const [no, freshSection] of Object.entries(fresh.sections)) {
      const section = course.sections[no]
      if (!section) {
        course.sections[no] = freshSection
        changed++
        continue
      }
      changed += fillSection(section, freshSection, repair)
    }
    target[code] = reorder(course)
  }
  existing[dept] = Object.fromEntries(Object.entries(target).sort(([a], [b]) => compareCodes(a, b)))
  return { changed }
}

function fillSection(section: RawSection, fresh: RawSection, repair: boolean): number {
  let changed = 0
  if (!section.instructors && fresh.instructors) {
    section.instructors = fresh.instructors
    changed++
  }
  // eski bicim "Ad1  Ad2" / "Ad1\u00a0\u00a0Ad2" -> "Ad1, Ad2"
  const legacy = section.instructor.replace(/\u00a0/g, ' ')
  if (fresh.instructors && fresh.instructors.length > 1 && legacy === fresh.instructors.map((i) => i.name).join('  ')) {
    section.instructor = fresh.instructor
    changed++
  }
  if (!section.quota && fresh.quota) {
    section.quota = fresh.quota
    changed++
  }
  if (!section.enrollment && fresh.enrollment) {
    section.enrollment = fresh.enrollment
    changed++
  }
  const freshSchedule = fresh.schedule ?? {}
  const hasSchedule = Object.keys(section.schedule ?? {}).length > 0
  if ((repair || !hasSchedule) && Object.keys(freshSchedule).length > 0 && JSON.stringify(section.schedule) !== JSON.stringify(freshSchedule)) {
    section.schedule = freshSchedule
    changed++
  }
  return changed
}

function reorder(course: RawCourse): RawCourse {
  const { name, credits, ects, lectureHours, labHours, sections, ...rest } = course
  const ordered: RawCourse = { name, credits, ects, lectureHours, labHours, ...rest, sections }
  for (const [no, s] of Object.entries(sections)) {
    const { instructor, instructors, schedule, quota, enrollment, ...others } = s
    ordered.sections[no] = { instructor, instructors, schedule, quota, enrollment, ...others }
  }
  ordered.sections = Object.fromEntries(Object.entries(ordered.sections).sort(([a], [b]) => Number(a) - Number(b) || a.localeCompare(b)))
  return ordered
}

export function backfillTargets(): string[] {
  const semesters = readJson<Array<{ code: string }>>(paths.semesters(), []).map((s) => s.code)
  const current = semesters[0]
  const range = semesters.filter((code) => code >= BACKFILL_FROM && code < current).sort()
  // once onarim (20251), sonra eskiden yeniye
  return [...REPAIR_SEMESTERS.filter((c) => range.includes(c)), ...range.filter((c) => !REPAIR_SEMESTERS.includes(c))]
}

/**
 * Agsiz on gecis: hoca ID'leri doldurulmus subelerde eski "Ad1  Ad2" (NBSP dahil)
 * bicimini "Ad1, Ad2"ye cevirir. Idempotent; tamamlanmis donemlerde de calisir.
 */
export function normalizeLegacyInstructors(file: RawOfferings): number {
  let changed = 0
  for (const dept of Object.values(file))
    for (const course of Object.values(dept))
      for (const section of Object.values(course.sections)) {
        const names = section.instructors?.map((i) => i.name) ?? []
        if (names.length < 2) continue
        if (section.instructor.replace(/\u00a0/g, ' ') === names.join('  ')) {
          section.instructor = names.join(', ')
          changed++
        }
      }
  return changed
}

export async function runBackfill(ctx: Ctx, options: BackfillOptions = {}): Promise<void> {
  const targets = options.semesters ?? backfillTargets()
  if (targets.length === 0) return
  let normalized = 0
  for (const semester of targets) {
    const file = readJson<RawOfferings>(paths.offerings(semester), {})
    const count = normalizeLegacyInstructors(file)
    if (count > 0) {
      ctx.writer.write(paths.offerings(semester), file)
      normalized += count
    }
  }
  ctx.coverage.instructorStringsNormalized = normalized
  const departments = await fetchDepartments(ctx)
  const summary: string[] = []
  for (const semester of targets) {
    if (ctx.client.halted) break
    const done = new Set(ctx.state.backfill[semester] ?? [])
    const todo = departments.filter((d) => !done.has(d.code))
    if (todo.length === 0) continue
    const file = readJson<RawOfferings>(paths.offerings(semester), {})
    const repair = REPAIR_SEMESTERS.includes(semester)
    let changed = 0
    let sectionsWithSchedule = 0
    await ctx.client.runAll(todo, async (dept) => {
      const rows = await fetchOfferings(ctx, dept.code, semester)
      if (rows === null) return
      if (rows.length > 0) changed += mergeSemester(file, dept.code, rows, repair).changed
      sectionsWithSchedule += rows.filter((r) => r.meetings.length > 0).length
      done.add(dept.code)
    })
    const ordered = Object.fromEntries(Object.entries(file).sort(([a], [b]) => a.localeCompare(b)))
    ctx.writer.write(paths.offerings(semester), ordered)
    ctx.state.backfill[semester] = [...done].sort()
    const complete = departments.every((d) => done.has(d.code))
    summary.push(`${semester}:${done.size}/${departments.length}${complete ? '✓' : ''}(+${changed})`)
  }
  ctx.coverage.backfill = summary.join(' ')
  ctx.coverage.remaining = targets.filter((sem) => departments.some((d) => !(ctx.state.backfill[sem] ?? []).includes(d.code))).join(' ') || 'none'
}

/** Test/rapor icin: bir donem dosyasinda saatli sube sayisi. */
export function countScheduled(offerings: RawOfferings): { sections: number; withSchedule: number } {
  let sections = 0
  let withSchedule = 0
  for (const dept of Object.values(offerings))
    for (const course of Object.values(dept))
      for (const section of Object.values(course.sections)) {
        sections++
        if (Object.keys(section.schedule ?? {}).length) withSchedule++
      }
  return { sections, withSchedule }
}
