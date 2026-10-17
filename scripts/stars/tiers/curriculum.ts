import { STARS_BASE } from '../http'
import type { Ctx } from '../lib/context'
import { readJson } from '../lib/json'
import { paths } from '../lib/paths'
import { unitToDept } from '../lib/store'
import { parseAcademicUnits } from '../parse/departments'
import { parseCurriculum, parseElectiveCourses, parseProgramList } from '../parse/curriculum'
import type { CurriculumFile, CurriculumProgram, DepartmentsFile } from '../types'

export interface CurriculumOptions {
  /** program bu kadar gunden yeniyse atla (donemde bir) */
  maxAgeDays?: number
  /** secmeli grubu bundan buyukse ders listesi saklanmaz (acik secmeli) */
  maxElectiveCourses?: number
  only?: string[]
}

const HOME = `${STARS_BASE}/homepage`
const DAY = 24 * 60 * 60 * 1000

/**
 * Donemde bir: academic_units -> curriculum.php?DEPT= (program listesi) ->
 * ajax/curriculum.printableHTML.php?PROGRAM=&TRACK= (donem donem mufredat) ->
 * lisans (major/minor) programlarinda ajax/curriculum.electiveCourses.php
 * (secmeli grup ders listeleri). Katalog sitesi cekilmez; linki departments.json'a.
 */
export async function runCurriculum(ctx: Ctx, options: CurriculumOptions = {}): Promise<void> {
  const maxAge = (options.maxAgeDays ?? 120) * DAY
  const maxElective = options.maxElectiveCourses ?? 400
  const unitsHtml = await ctx.client.get(`${HOME}/academic_units.php`)
  const units = parseAcademicUnits(unitsHtml ?? '').filter((u) => u.curriculum && (!options.only || options.only.includes(u.code)))
  if (!options.only && units.length < 20) throw new Error(`academic_units: only ${units.length} units with curriculum`)

  // katalog linkleri
  const departments = readJson<DepartmentsFile>(paths.departments(), {})
  let departmentsChanged = false
  for (const unit of units) {
    const code = unitToDept(unit.code)
    if (departments[code] && unit.catalogUrl && departments[code].catalogUrl !== unit.catalogUrl) {
      departments[code] = { ...departments[code], catalogUrl: unit.catalogUrl }
      departmentsChanged = true
    }
  }
  if (departmentsChanged) ctx.writer.write(paths.departments(), departments)

  let programsFetched = 0
  let programsSkipped = 0
  let electiveLists = 0
  let unitsDone = 0
  await ctx.client.runAll(
    units,
    async (unit) => {
      const listHtml = await ctx.client.get(`${HOME}/curriculum.php?DEPT=${encodeURIComponent(unit.code)}`)
      const programs = parseProgramList(listHtml ?? '')
      const dept = unitToDept(unit.code)
      const file = readJson<CurriculumFile>(paths.curricula(dept), { programs: [] })
      const byId = new Map(file.programs.map((p) => [p.id, p]))
      const next: CurriculumProgram[] = []
      for (const link of programs) {
        const id = link.track ? `${link.program}:${link.track}` : link.program
        const last = ctx.state.curriculum[id]
        const existing = byId.get(id)
        if (existing && last && Date.now() - Date.parse(last) < maxAge) {
          next.push(existing)
          programsSkipped++
          continue
        }
        const html = await ctx.client.get(
          `${HOME}/ajax/curriculum.printableHTML.php?PROGRAM=${encodeURIComponent(link.program)}&TRACK=${encodeURIComponent(link.track)}`,
        )
        const page = parseCurriculum(html ?? '')
        const electiveGroups: NonNullable<CurriculumProgram['electiveGroups']> = []
        for (const group of page.electiveGroups) {
          let courses: string[] | null = null
          if (link.kind !== 'other') {
            const url =
              `${HOME}/ajax/curriculum.electiveCourses.php?DEPT=${encodeURIComponent(unit.code)}&PROGRAM=${encodeURIComponent(link.program)}` +
              `&TRACK=${encodeURIComponent(link.track)}&CODE=${encodeURIComponent(group.code)}&TITLE=${encodeURIComponent(group.title)}`
            const list = parseElectiveCourses((await ctx.client.get(url)) ?? '')
            electiveLists++
            courses = list.length > maxElective ? null : list
          }
          electiveGroups.push({ code: group.code, title: group.title, count: group.count, courses })
        }
        const program: CurriculumProgram = {
          id,
          name: link.name,
          kind: link.kind,
          semesters: page.semesters,
          electiveGroups,
          fetchedAt: existing?.fetchedAt ?? ctx.now(),
        }
        // icerik degismediyse fetchedAt sabit
        if (existing) {
          const { fetchedAt: a, ...x } = existing
          const { fetchedAt: b, ...y } = program
          if (JSON.stringify(x) !== JSON.stringify(y)) program.fetchedAt = ctx.now()
        }
        next.push(program)
        ctx.state.curriculum[id] = ctx.now()
        programsFetched++
      }
      if (next.length > 0) ctx.writer.write(paths.curricula(dept), { programs: next } satisfies CurriculumFile)
      unitsDone++
    },
    1,
  )
  Object.assign(ctx.coverage, { units: units.length, unitsDone, programsFetched, programsSkipped, electiveLists })
}
