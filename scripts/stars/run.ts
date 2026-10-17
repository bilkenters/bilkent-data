/**
 * STARS scraper v2 — tek giris noktasi.
 *   tsx scripts/stars/run.ts --tier=live|catalog|course|syllabus|staff|curriculum|backfill
 *                            [--budget=<istek>] [--limit=<ders>] [--semester=20261] [--dry-run]
 * Kurallar: docs/stars-veri/README.md "Rate-limit ayrıntısı" (<= 3 istek/sn, 423 => dur), 01-scraper.md.
 * Cikis kodu: 0; 423/devre kesici => 75 (ilerleme yazilmis, workflow zinciri durur ama
 * commit'ler); butce dolmasi normal (0). Beklenmeyen hata => 1, katman dosya yazmaz.
 */
import fs from 'node:fs'

import { StarsClient } from './http'
import type { Ctx } from './lib/context'
import { createWriter, readJson } from './lib/json'
import { paths } from './lib/paths'
import { semesterInfo } from './lib/semesters'
import { readState } from './lib/store'
import { runBackfill } from './tiers/backfill'
import { runCatalog } from './tiers/catalog'
import { runCourse } from './tiers/course'
import { runCurriculum } from './tiers/curriculum'
import { runLive, type LiveResult } from './tiers/live'
import { runStaff } from './tiers/staff'
import { runSyllabus } from './tiers/syllabus'
import type { RunSummary } from './types'

const TIERS = ['live', 'catalog', 'course', 'syllabus', 'staff', 'curriculum', 'backfill'] as const
type Tier = (typeof TIERS)[number]

/** Katman basina varsayilan istek butcesi (bkz. 01-scraper.md tablo). */
const DEFAULT_BUDGET: Record<Tier, number> = {
  live: 2700,
  catalog: 120,
  course: 200,
  syllabus: 1400,
  staff: 80,
  curriculum: 900,
  backfill: 450,
}

export interface RunOptions {
  tier: Tier
  budget?: number
  limit?: number
  semester?: string
  dryRun?: boolean
  only?: string[]
  fetchImpl?: typeof fetch
  log?: (msg: string) => void
  sleep?: (ms: number) => Promise<void>
}

export function parseArgs(argv: string[]): RunOptions {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
  const tier = (get('tier') ?? 'live') as Tier
  if (!TIERS.includes(tier)) throw new Error(`bilinmeyen katman: ${tier}`)
  const number = (name: string) => (get(name) ? Number(get(name)) : undefined)
  return {
    tier,
    budget: number('budget'),
    limit: number('limit'),
    semester: get('semester'),
    dryRun: argv.includes('--dry-run'),
    only: get('only')?.split(',').map((s) => s.trim()).filter(Boolean),
  }
}

function currentSemester(): string {
  const semesters = readJson<Array<{ code: string }>>(paths.semesters(), [])
  if (!semesters[0]) throw new Error('semesters.json bos')
  return semesters[0].code
}

function nextSixHour(now: Date): string {
  const next = new Date(now)
  next.setUTCMinutes(0, 0, 0)
  next.setUTCHours(Math.floor(now.getUTCHours() / 6) * 6 + 6)
  return next.toISOString()
}

export async function run(options: RunOptions): Promise<{ summary: RunSummary; changed: string[]; live?: LiveResult }> {
  const log = options.log ?? ((msg: string) => console.log(msg))
  const budget = options.budget ?? DEFAULT_BUDGET[options.tier]
  const client = new StarsClient({ budget, fetchImpl: options.fetchImpl, log, sleep: options.sleep })
  const writer = createWriter(Boolean(options.dryRun), log)
  const state = readState()
  const stateBefore = JSON.stringify({ ...state, lastRun: undefined })
  const ctx: Ctx = { client, writer, state, log, now: () => new Date().toISOString(), coverage: {} }
  const semester = options.semester ?? currentSemester()
  log(`== STARS ${options.tier} (donem ${semester}, butce ${budget}${options.dryRun ? ', dry-run' : ''})`)

  let live: LiveResult | undefined
  switch (options.tier) {
    case 'live':
      live = await runLive(ctx, { semester: options.semester })
      break
    case 'catalog':
      await runCatalog(ctx)
      break
    case 'course':
      await runCourse(ctx, { semester, limit: options.limit ?? budget, only: options.only })
      break
    case 'syllabus':
      await runSyllabus(ctx, { semester, limit: options.limit ?? 1100 })
      break
    case 'staff':
      await runStaff(ctx)
      break
    case 'curriculum':
      await runCurriculum(ctx, { only: options.only })
      break
    case 'backfill':
      await runBackfill(ctx, { semesters: options.only })
      break
  }

  const summary: RunSummary = {
    tier: options.tier,
    at: new Date().toISOString(),
    requests: client.stats.requests,
    statuses: client.stats.statuses,
    durationMs: client.stats.durationMs,
    halted: client.stats.halted,
    coverage: ctx.coverage,
  }

  // durum + ozet yalnizca veri degistiyse yazilir (ayni veriyle ikinci calisma = 0 diff)
  const dataChanged = writer.changed.length > 0
  const stateChanged = JSON.stringify({ ...state, lastRun: undefined }) !== stateBefore
  if (dataChanged || stateChanged) {
    state.lastRun[options.tier] = summary
    writer.write(paths.state(), state)
  }
  if (live?.offeringsChanged) {
    const now = new Date()
    const info = semesterInfo(live.semester)
    writer.write(paths.lastUpdate(), {
      lastUpdate: now.toISOString(),
      semester: live.semester,
      semesterName: `${info.year} ${info.name}`,
      nextUpdate: nextSixHour(now),
      lastChange: live.newSemester
        ? { date: now.toISOString(), type: 'new_semester', description: `${info.year} ${info.name} dönemi eklendi` }
        : { date: now.toISOString(), type: 'update', description: `Güncelleme (${ctx.coverage.withSchedule}/${ctx.coverage.sections} şube saatli)` },
      stats: { totalCourses: live.totalCourses, totalDepartments: live.totalDepartments },
      run: { requests: summary.requests, statuses: summary.statuses, durationMs: summary.durationMs, halted: summary.halted, coverage: summary.coverage },
    })
    // okuyan yok (README #12): v2 uretmez
    writer.remove(`${paths.publicData()}/gpa-data.json`)
  }

  log(`== ozet ${JSON.stringify(summary)}`)
  log(`== degisen dosya: ${writer.changed.length}${options.dryRun ? ' (dry-run, yazilmadi)' : ''}`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      `### STARS ${options.tier}`,
      `- istek: ${summary.requests}, sure: ${(summary.durationMs / 1000).toFixed(0)} s, durum: ${JSON.stringify(summary.statuses)}${summary.halted ? `, **durdu: ${summary.halted}**` : ''}`,
      ...Object.entries(summary.coverage).map(([k, v]) => `- ${k}: ${v}`),
      `- degisen dosya: ${writer.changed.length}`,
      '',
    ]
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'))
  }
  return { summary, changed: writer.changed, live }
}

/** 423 ya da devre kesici: ilerleme yazildi, workflow zinciri dursun (EX_TEMPFAIL). */
export const EXIT_HALTED = 75

if (require.main === module) {
  run(parseArgs(process.argv.slice(2)))
    .then(({ summary }) => {
      if (summary.halted === 'locked' || summary.halted === 'breaker') process.exit(EXIT_HALTED)
    })
    .catch((error) => {
      console.error('Fatal:', error)
      process.exit(1)
    })
}
