import type { RawOfferings } from '../../../lib/offerings/types'
import { ajaxUrl } from '../http'
import type { Ctx } from '../lib/context'
import { readJson } from '../lib/json'
import { paths } from '../lib/paths'
import { CourseStore, InstructorStore, blankCourse } from '../lib/store'
import { parseOldOfferings } from '../parse/old-offerings'
import { collectTexts, parsePrerequisite } from '../parse/prereq'
import type { HistoryTuple } from '../types'
import { buildPrereqGraph } from './prereq-graph'

export interface CourseOptions {
  semester: string
  /** bu calismada en fazla kac ders */
  limit: number
  /** yalnizca bu dersler (test/elle) */
  only?: string[]
}

/**
 * courses.oldOfferings: aciklama, on kosul, tum donem x sube GPA satirlari.
 * Kapsam: katalogdaki tum dersler + bu donem acilanlar. Sira: hic kontrol
 * edilmemisler (once bu donem acilanlar), sonra en eski kontrol.
 */
export function courseQueue(ctx: Ctx, store: CourseStore, semester: string): string[] {
  const offerings = readJson<RawOfferings>(paths.offerings(semester), {})
  const offered = new Set(Object.values(offerings).flatMap((dept) => Object.keys(dept)))
  const all = new Set<string>(offered)
  for (const file of store.loadAll().values()) for (const code of Object.keys(file)) all.add(code)
  return [...all].sort((a, b) => {
    const ca = ctx.state.course[a] ?? ''
    const cb = ctx.state.course[b] ?? ''
    if (ca !== cb) return ca < cb ? -1 : 1
    const oa = offered.has(a) ? 0 : 1
    const ob = offered.has(b) ? 0 : 1
    return oa - ob || a.localeCompare(b)
  })
}

export async function runCourse(ctx: Ctx, options: CourseOptions): Promise<void> {
  const store = new CourseStore()
  const instructors = new InstructorStore()
  const queue = (options.only ?? courseQueue(ctx, store, options.semester)).slice(0, options.limit)
  const offered = new Set(Object.values(readJson<RawOfferings>(paths.offerings(options.semester), {})).flatMap((d) => Object.keys(d)))
  let updated = 0
  let checked = 0
  let notFound = 0
  let rows = 0
  const result = await ctx.client.runAll(
    queue,
    async (code) => {
      const html = await ctx.client.get(ajaxUrl('courses.oldOfferings.php', { COURSE: code }), { heavy: true })
      const now = ctx.now()
      const page = parseOldOfferings(html ?? '')
      checked++
      ctx.state.course[code] = now
      if (!page.found) {
        notFound++
        return
      }
      const existing = store.get(code)
      const { fetchedAt, ...base } = existing ?? { ...blankCourse(page.name ?? code), fetchedAt: now }
      const history: HistoryTuple[] = page.rows.map((row) => [
        row.semester,
        row.section,
        row.instructors.map((i) => i.id).filter(Boolean),
        row.students,
        row.sectionGpa,
        row.courseGpa,
      ])
      for (const row of page.rows) for (const ref of row.instructors) instructors.addName(ref.id, ref.name)
      rows += history.length
      const prereq = parsePrerequisite(page.prerequisite)
      const next = {
        ...base,
        name: base.inCatalog ? base.name : page.name ?? base.name,
        description: page.description,
        prerequisite: page.prerequisite,
        prerequisiteTree: prereq.tree,
        credits: base.inCatalog ? base.credits : page.credits ?? base.credits,
        ects: base.inCatalog ? base.ects : page.ects ?? base.ects,
        history,
      }
      if (store.put(code, next, now)) updated++
    },
    1,
  )
  store.flush(ctx.writer)
  instructors.flush(ctx.writer)
  const graph = buildPrereqGraph(ctx, store)
  if (graph.cycles.length) ctx.log(`   on kosul donguleri: ${graph.cycles.map((c) => c.join(' <-> ')).join(' | ')}`)

  const coursesAll = [...store.loadAll().values()].flatMap((file) => Object.entries(file))
  const offeredChecked = [...offered].filter((code) => ctx.state.course[code]).length
  const texts = new Map<string, number>()
  let complete = 0
  for (const [, record] of coursesAll) {
    if (!record.prerequisite) continue
    const parse = parsePrerequisite(record.prerequisite)
    if (parse.complete) complete++
    for (const text of collectTexts(parse.tree)) texts.set(text, (texts.get(text) ?? 0) + 1)
  }
  Object.assign(ctx.coverage, {
    queued: queue.length,
    checked,
    updated,
    notFound,
    failed: result.failed.length,
    skipped: result.skipped.length,
    historyRows: rows,
    offered: offered.size,
    offeredChecked,
    remainingNeverChecked: coursesAll.filter(([code]) => !ctx.state.course[code]).length,
    withPrerequisite: graph.withPrerequisite,
    prerequisiteComplete: complete,
    prereqEdges: graph.edges,
    prereqCycles: graph.cycles.length,
    topPrereqTexts: [...texts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => `${n}× ${t}`).join(' | '),
  })
}
