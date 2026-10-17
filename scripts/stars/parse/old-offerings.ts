import { clean, load, parseInstructorCell, semesterFromLabel, splitSectionCode, toNumber, type InstructorRef } from './util'

export interface CourseHours {
  lectureOnline: number
  lectureF2F: number
  recitation: number
  labF2F: number
  labOnline: number
}

export interface HistoryRow {
  semester: string
  section: string
  instructors: InstructorRef[]
  students: number
  sectionGpa: number | null
  courseGpa: number | null
}

export interface OldOfferingsPage {
  code: string | null
  name: string | null
  description: string | null
  /** ham ifade; "none"/bos -> null */
  prerequisite: string | null
  credits: number | null
  ects: number | null
  /** oldOfferings'in saat kutulari (etiketler tutarsiz; katalog varsa o tercih edilir) */
  hoursRaw: Record<string, number>
  rows: HistoryRow[]
  /** sayfa gercek bir ders sayfasi mi (olmayan derste STARS kisa bir govde donuyor) */
  found: boolean
}

function kv(value: string): number | null {
  return toNumber(value.replace(/^:/, ''))
}

/** courses.oldOfferings.php: ust bilgi (aciklama, on kosul, saat, kredi) + #sections satirlari. */
export function parseOldOfferings(html: string): OldOfferingsPage {
  const $ = load(html)
  const caption = clean($('#divInfo caption').first().text())
  const captionMatch = /^([A-Z]+ \d+[A-Z]?)\s+(.*)$/.exec(caption)
  const description = clean($('#divCourseDesc .catalog').first().text()) || null

  let prerequisite: string | null = null
  let credits: number | null = null
  let ects: number | null = null
  const hoursRaw: Record<string, number> = {}
  $('#divCourseDesc table.stdForm').each((_, table) => {
    const t = $(table)
    const title = clean(t.children('caption').text())
    if (/^Prerequisite/i.test(title)) {
      const value = clean(t.find('td').first().text())
      prerequisite = value && !/^none$/i.test(value) ? value : null
      return
    }
    if (/^Credits/i.test(title)) {
      t.find('tr').each((__, tr) => {
        const cells = $(tr).find('td')
        const label = clean(cells.eq(0).text())
        if (/bilkent/i.test(label)) credits = kv(clean(cells.eq(1).text()))
        if (/ects/i.test(label)) ects = kv(clean(cells.eq(1).text()))
      })
      return
    }
    if (t.hasClass('oldCourse')) return
    if (/hours/i.test(title)) {
      t.find('tr').each((__, tr) => {
        const cells = $(tr).find('td')
        const value = kv(clean(cells.eq(1).text()))
        if (value !== null) hoursRaw[`${title}/${clean(cells.eq(0).text())}`] = value
      })
    }
  })

  const rows: HistoryRow[] = []
  $('#sections tbody tr').each((_, tr) => {
    const cells = $(tr).children('td')
    if (cells.length < 6) return
    const split = splitSectionCode(cells.eq(1).text())
    const linkSemester = /openEvalPageForSection\(\s*'(\d{5})'/.exec($.html(cells.eq(6)) ?? '')?.[1]
      ?? /openSyllabusPage\([^)]*?'(\d{5})'/.exec($.html(cells.eq(6)) ?? '')?.[1]
    const semester = linkSemester ?? semesterFromLabel(cells.eq(0).text())
    if (!split || !semester) return
    rows.push({
      semester,
      section: split[1],
      instructors: parseInstructorCell($, cells.eq(2)),
      students: toNumber(cells.eq(3).text()) ?? 0,
      sectionGpa: toNumber(cells.eq(4).text()),
      courseGpa: toNumber(cells.eq(5).text()),
    })
  })

  return {
    code: captionMatch?.[1] ?? null,
    name: captionMatch?.[2] ?? null,
    description,
    prerequisite,
    credits,
    ects,
    hoursRaw,
    rows,
    found: Boolean(captionMatch) || rows.length > 0,
  }
}
