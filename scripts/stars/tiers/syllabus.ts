import type { RawOfferings } from '../../../lib/offerings/types'
import { STARS_BASE } from '../http'
import type { Ctx } from '../lib/context'
import { readJson } from '../lib/json'
import { paths } from '../lib/paths'
import { compareCodes, deptOf, shortHash } from '../lib/store'
import { parseSyllabus } from '../parse/syllabus'
import type { SyllabusFile, SyllabusRecord } from '../types'

export interface SyllabusOptions {
  semester: string
  /** en fazla kac ders (her ders 1 + farkli hocali sube sayisi kadar istek) */
  limit: number
}

const DAY = 24 * 60 * 60 * 1000
/** donem basindan sonra bu kadar gun, haftalik yenileme; sonra yalnizca hic cekilmemisler */
const REFRESH_WINDOW_DAYS = 35
const REFRESH_EVERY_DAYS = 6.5

/**
 * /syllabus/show/{donem}/{bolum}/{no}/{sube}. Ders basina 1 + farkli hoca
 * kumesi basina 1 istek; ayni hoca kumesindeki subeler cekilen subenin
 * varyantina atanir. Icerik hash'i degismedikce varyantin fetchedAt'i sabit.
 */
export async function runSyllabus(ctx: Ctx, options: SyllabusOptions): Promise<void> {
  const { semester } = options
  const offerings = readJson<RawOfferings>(paths.offerings(semester), {})
  const now = ctx.now()
  const state = (ctx.state.syllabus[semester] ??= { firstRunAt: now, courses: {} })
  const inWindow = Date.parse(now) - Date.parse(state.firstRunAt ?? now) <= REFRESH_WINDOW_DAYS * DAY

  const due = Object.values(offerings)
    .flatMap((dept) => Object.keys(dept))
    .filter((code) => {
      const last = state.courses[code]
      if (!last) return true
      return inWindow && Date.parse(now) - Date.parse(last) >= REFRESH_EVERY_DAYS * DAY
    })
    .sort((a, b) => (state.courses[a] ?? '').localeCompare(state.courses[b] ?? '') || compareCodes(a, b))
    .slice(0, options.limit)

  const files = new Map<string, SyllabusFile>()
  const fileFor = (dept: string) => {
    if (!files.has(dept)) files.set(dept, readJson<SyllabusFile>(paths.syllabi(semester, dept), {}))
    return files.get(dept)!
  }
  const dirty = new Set<string>()
  let requests = 0
  let found = 0
  let missing = 0

  await ctx.client.runAll(due, async (code) => {
    const dept = deptOf(code)
    const number = code.split(' ')[1]
    const sections = offerings[dept]?.[code]?.sections ?? {}
    // hoca kumesine gore gruplar; her gruptan ilk sube cekilir
    const groups = new Map<string, string[]>()
    for (const [no, section] of Object.entries(sections).sort(([a], [b]) => Number(a) - Number(b))) {
      const key = (section.instructors ?? []).map((i) => i.id || i.name).sort().join('|') || section.instructor || 'Staff'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(no)
    }
    const file = fileFor(dept)
    const previous = file[code]
    const entry: SyllabusFile[string] = { sections: {}, variants: {}, fetched: [] }
    for (const members of groups.values()) {
      const rep = members[0]
      requests++
      const html = await ctx.client.get(`${STARS_BASE}/syllabus/show/${semester}/${dept}/${number}/${rep}`, { allowNotFound: true })
      const page = parseSyllabus(html ?? '')
      if (!page.found || !page.record) {
        missing++
        continue
      }
      found++
      const hash = shortHash(JSON.stringify(page.record))
      const record: SyllabusRecord = previous?.variants[hash] ?? { ...page.record, fetchedAt: ctx.now() }
      entry.variants[hash] = record
      entry.fetched!.push(rep)
      for (const no of members) entry.sections[no] = hash
    }
    state.courses[code] = now
    if (entry.fetched!.length === 0) return
    entry.sections = Object.fromEntries(Object.entries(entry.sections).sort(([a], [b]) => Number(a) - Number(b)))
    if (JSON.stringify(previous) !== JSON.stringify(entry)) {
      file[code] = entry
      dirty.add(dept)
    }
  })

  for (const dept of [...dirty].sort()) {
    const file = files.get(dept)!
    ctx.writer.write(paths.syllabi(semester, dept), Object.fromEntries(Object.entries(file).sort(([a], [b]) => compareCodes(a, b))))
  }
  const total = Object.values(offerings).reduce((sum, dept) => sum + Object.keys(dept).length, 0)
  Object.assign(ctx.coverage, {
    semester,
    courses: total,
    due: due.length,
    requests,
    found,
    missing,
    coursesChecked: Object.keys(state.courses).length,
  })
}
