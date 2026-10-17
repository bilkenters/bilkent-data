import { canonicalScheduleText, parseScheduleText, type Meeting } from './schedule-text'
import { clean, leadingInt, load, parseInstructorCell, splitSectionCode, toNumber, type InstructorRef } from './util'

export interface OfferingQuota {
  assigned: number
  total: number
  available: number
  unlimited?: true
  /** "Mand. or Elect." gibi kontenjan tipi */
  kind?: string
}

export interface OfferingRow {
  course: string
  section: string
  name: string
  instructors: InstructorRef[]
  lectureHours: number | null
  labHours: number | null
  credits: number | null
  ects: number | null
  /** kontenjan sutunlari "-" ise (eski donemler) null */
  quota: OfferingQuota | null
  enrollment: { mandatory: number; elective: number; total: number } | null
  meetings: Meeting[]
  /** kanonik saat metni ("" = saat yok) */
  scheduleText: string
  unparsedSchedule: string[]
}

/**
 * plainOfferings.php satirlari. 16 sutun: sube, ad, hoca(lar), ders/lab saati,
 * kredi, ECTS, atanmis kontenjan (+tip) ve toplam, zorunlu/secmeli/toplam kayit,
 * bos kontenjan (+tip) ve toplam, saat metni, linkler.
 */
export function parseOfferings(html: string): OfferingRow[] {
  const $ = load(html)
  const rows: OfferingRow[] = []
  $('#poTable tbody tr').each((_, tr) => {
    const cells = $(tr).children('td')
    if (cells.length < 15) return
    const split = splitSectionCode(cells.eq(0).text())
    if (!split) return
    const text = (i: number) => clean(cells.eq(i).text())

    const assignedText = text(7)
    const unlimited = /unlimited/i.test(assignedText)
    const quotaCells = [7, 8, 12, 13].map(text)
    let quota: OfferingQuota | null = null
    if (unlimited) {
      quota = { assigned: 0, total: 0, available: 0, unlimited: true }
    } else if (!quotaCells.every((value) => value === '-' || value === '')) {
      const kind = clean(assignedText.replace(/^-?\d+/, '')) || undefined
      quota = {
        assigned: leadingInt(assignedText) ?? 0,
        total: leadingInt(text(8)) ?? 0,
        available: leadingInt(text(12)) ?? 0,
        ...(kind ? { kind } : {}),
      }
    }
    const enrollmentCells = [9, 10, 11].map(text)
    const enrollment = enrollmentCells.every((value) => value === '-' || value === '')
      ? null
      : {
          mandatory: leadingInt(enrollmentCells[0]) ?? 0,
          elective: leadingInt(enrollmentCells[1]) ?? 0,
          total: leadingInt(enrollmentCells[2]) ?? 0,
        }

    const scheduleHtml = $.html(cells.eq(14).contents()) ?? ''
    const { meetings, unparsed } = parseScheduleText(scheduleHtml.replace(/<(?!br)[^>]+>/gi, ''))

    rows.push({
      course: split[0],
      section: split[1],
      name: text(1),
      instructors: parseInstructorCell($, cells.eq(2)),
      lectureHours: toNumber(text(3)),
      labHours: toNumber(text(4)),
      credits: toNumber(text(5)),
      ects: toNumber(text(6)),
      quota,
      enrollment,
      meetings,
      scheduleText: canonicalScheduleText(meetings),
      unparsedSchedule: unparsed,
    })
  })
  return rows
}
