import { DAY_STRIDE, NO_ROOM } from './schedule-text'
import { clean, load } from './util'

export type SlotKind = 'DY' | 'DD' | 'DR' | 'LL' | 'LO'

export interface SchedulePage {
  /** `{ [slot]: derslik }`, derslikte "(S)" yok */
  schedule: Record<string, string>
  spare: number[]
  kinds: Record<string, SlotKind>
  noSchedule: boolean
}

const KIND_BY_CLASS: Record<string, SlotKind> = {
  cl_ders_DY: 'DY',
  cl_ders_DD: 'DD',
  cl_ders_DR: 'DR',
  cl_lab_LL: 'LL',
  cl_lab_LO: 'LO',
}

/**
 * schedule.php haftalik tablosu. Hucre sinifi = tur (cl_ders_DY yuz yuze ders,
 * DD online/hibrit, DR recitation, cl_lab_LL yuz yuze lab, LO online lab).
 * "(S)" = Spare Hour. Satirlar 08:30-22:20; ilk hucre (align=right) saat etiketi.
 */
export function parseSchedulePage(html: string): SchedulePage {
  const $ = load(html)
  const result: SchedulePage = { schedule: {}, spare: [], kinds: {}, noSchedule: /no schedule/i.test(html) && !/id='schedule'/.test(html) }
  $('#schedule tbody tr').each((hour, tr) => {
    $(tr)
      .children('td')
      .filter((_, td) => $(td).attr('align') === undefined)
      .each((day, td) => {
        const cell = $(td)
        const className = (cell.attr('class') ?? '').trim()
        if (!className) return
        const slot = hour * DAY_STRIDE + day
        const raw = clean(cell.text())
        const spare = /\(S\)\s*$/.test(raw)
        const room = clean(raw.replace(/\(S\)\s*$/, ''))
        result.schedule[String(slot)] = room || NO_ROOM
        if (spare) result.spare.push(slot)
        const kind = KIND_BY_CLASS[className]
        if (kind) result.kinds[String(slot)] = kind
      })
  })
  return result
}
