/**
 * Veri kapsama raporu (salt okunur, STARS'a istek atmaz):
 *   tsx scripts/stars/coverage.ts [--semester=20261]
 * GPA kapsami, on kosul parse orani, mufredat derslerinin courses/'ta olup olmadigi,
 * data/stars boyutu, arsiv donemlerinde saat/kredi dolulugu.
 */
import fs from 'node:fs'
import path from 'node:path'

import type { RawOfferings } from '../../lib/offerings/types'
import { inWindow } from './lib/gpa'
import { readJson } from './lib/json'
import { paths } from './lib/paths'
import { CourseStore } from './lib/store'
import { collectTexts, parsePrerequisite } from './parse/prereq'
import type { CurriculumFile, StateFile } from './types'

function dirSize(dir: string): number {
  let total = 0
  if (!fs.existsSync(dir)) return 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size
  }
  return total
}

export function coverage(semester: string) {
  const offerings = readJson<RawOfferings>(paths.offerings(semester), {})
  const state = readJson<Partial<StateFile>>(paths.state(), {})
  const store = new CourseStore()
  const files = store.loadAll()
  const records = [...files.values()].flatMap((f) => Object.entries(f))
  const byCode = new Map(records)

  // GPA
  const offered = Object.values(offerings).flatMap((d) => Object.entries(d))
  const withGpa = offered.filter(([, c]) => c.averageGpa != null).length
  const withHistoryInWindow = offered.filter(([code]) => byCode.get(code)?.history.some(([sem, , , n, , gpa]) => inWindow(sem, semester) && n > 0 && (gpa ?? 0) > 0))
  const withHistoryAndGpa = withHistoryInWindow.filter(([, c]) => c.averageGpa != null).length
  const sections = offered.flatMap(([, c]) => Object.values(c.sections))

  // on kosul
  const catalog = records.filter(([, r]) => r.inCatalog)
  const checked = records.filter(([code]) => state.course?.[code])
  const withPre = records.filter(([, r]) => r.prerequisite)
  let complete = 0
  const texts = new Map<string, number>()
  for (const [, r] of withPre) {
    const p = parsePrerequisite(r.prerequisite)
    if (p.complete) complete++
    for (const t of collectTexts(p.tree)) texts.set(t, (texts.get(t) ?? 0) + 1)
  }

  // mufredat
  const curriculaDir = path.join(paths.stars(), 'curricula')
  const curricula: Record<string, { programs: number; majors: number; minors: number; semesters: number }> = {}
  const missing = new Set<string>()
  if (fs.existsSync(curriculaDir)) {
    for (const name of fs.readdirSync(curriculaDir)) {
      const file = readJson<CurriculumFile>(path.join(curriculaDir, name), { programs: [] })
      curricula[path.basename(name, '.json')] = {
        programs: file.programs.length,
        majors: file.programs.filter((p) => p.kind === 'major').length,
        minors: file.programs.filter((p) => p.kind === 'minor').length,
        semesters: file.programs.reduce((s, p) => s + p.semesters.length, 0),
      }
      for (const program of file.programs)
        for (const sem of program.semesters)
          for (const item of sem.items) if ('course' in item && !byCode.has(item.course)) missing.add(item.course)
    }
  }

  // arsiv donemleri
  const archive: Record<string, string> = {}
  for (const file of fs.readdirSync(path.dirname(paths.offerings(semester))).sort()) {
    const data = readJson<RawOfferings>(path.join(path.dirname(paths.offerings(semester)), file), {})
    const secs = Object.values(data).flatMap((d) => Object.values(d).flatMap((c) => Object.values(c.sections)))
    const courses = Object.values(data).flatMap((d) => Object.values(d))
    archive[file.slice(0, 5)] =
      `sube ${secs.length}, saatli ${secs.filter((s) => Object.keys(s.schedule ?? {}).length).length}, ` +
      `kredili ders ${courses.filter((c) => c.credits !== undefined).length}/${courses.length}, kontenjanli ${secs.filter((s) => s.quota).length}, hoca ID ${secs.filter((s) => s.instructors).length}`
  }

  return {
    semester,
    gpa: {
      courses: offered.length,
      withGpa,
      withHistoryInWindow: withHistoryInWindow.length,
      withHistoryAndGpa,
      sectionsWithInstructorGpa: sections.filter((s) => s.instructorGpa != null).length,
      sections: sections.length,
    },
    schedule: {
      withSchedule: sections.filter((s) => Object.keys(s.schedule ?? {}).length).length,
      withKinds: sections.filter((s) => s.kinds).length,
      withSpare: sections.filter((s) => s.spare?.length).length,
      multiInstructor: sections.filter((s) => (s.instructors?.length ?? 0) > 1).length,
      unlimited: sections.filter((s) => s.quota?.unlimited).length,
    },
    courses: {
      records: records.length,
      inCatalog: catalog.length,
      checkedByCourseTier: checked.length,
      catalogChecked: catalog.filter(([code]) => state.course?.[code]).length,
      withDescription: records.filter(([, r]) => r.description).length,
      historyRows: records.reduce((s, [, r]) => s + r.history.length, 0),
    },
    prerequisites: {
      withPrerequisite: withPre.length,
      catalogWithPrerequisite: catalog.filter(([, r]) => r.prerequisite).length,
      fullyParsed: complete,
      withTextParts: withPre.length - complete,
      topTexts: [...texts].sort((a, b) => b[1] - a[1]).slice(0, 10),
    },
    curricula,
    curriculumCoursesMissingInCourses: [...missing].sort(),
    size: { dataStarsBytes: dirSize(paths.stars()), largestCourseFile: largest(paths.coursesDir()) },
    archive,
  }
}

function largest(dir: string): string {
  if (!fs.existsSync(dir)) return '-'
  const [name, size] = fs
    .readdirSync(dir)
    .map((f) => [f, fs.statSync(path.join(dir, f)).size] as const)
    .sort((a, b) => b[1] - a[1])[0] ?? ['-', 0]
  return `${name} ${size}`
}

if (require.main === module) {
  const semester = process.argv.find((a) => a.startsWith('--semester='))?.split('=')[1]
    ?? readJson<Array<{ code: string }>>(paths.semesters(), [])[0]?.code
  console.log(JSON.stringify(coverage(semester!), null, 2))
}
