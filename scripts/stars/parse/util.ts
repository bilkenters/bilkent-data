import * as cheerio from 'cheerio'
import type { Cheerio, CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'

export type { CheerioAPI }

export function load(html: string): CheerioAPI {
  return cheerio.load(html)
}

/** Bosluklari tekillestirir, &nbsp; dahil. */
export function clean(value: string | undefined | null): string {
  return (value ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

/** "3", "6.5", "6,5" -> sayi; bos / "-" -> null. */
export function toNumber(value: string | undefined | null): number | null {
  const text = clean(value).replace(',', '.')
  if (!text || text === '-') return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

/** Metnin ilk tamsayisi: "22 Mand. or Elect." -> 22. */
export function leadingInt(value: string | undefined | null): number | null {
  const match = /-?\d+/.exec(clean(value))
  return match ? Number(match[0]) : null
}

export interface InstructorRef {
  /** STARS personel ID'si; bilinmiyorsa '' */
  id: string
  name: string
}

/**
 * STARS hoca hucresi: her hoca ayri `display:table-row` span'i, ad ilk div'de,
 * ID `openCoursesPage('5957')`'de. Span yoksa duz metin ("Staff" ya da ad).
 * HTML'de kapanmamis <a> var; regex yerine DOM uzerinden gidiyoruz.
 */
export function parseInstructorCell($: CheerioAPI, cell: Cheerio<AnyNode>): InstructorRef[] {
  const rows = cell.find('span').filter((_, el) => /table-row/.test($(el).attr('style') ?? ''))
  if (rows.length === 0) {
    const text = clean(cell.text())
    if (!text || /^staff$/i.test(text)) return []
    return [{ id: '', name: text }]
  }
  const result: InstructorRef[] = []
  rows.each((_, el) => {
    const row = $(el)
    const name = clean(row.find('div').first().text())
    const id = /openCoursesPage\('(\d+)'\)/.exec($.html(row) ?? '')?.[1] ?? ''
    if (name && !/^staff$/i.test(name)) result.push({ id, name })
  })
  return result
}

export function joinInstructorNames(instructors: InstructorRef[]): string {
  return instructors.length > 0 ? instructors.map((i) => i.name).join(', ') : 'Staff'
}

const TERM_BY_NAME: Record<string, string> = {
  fall: '1',
  spring: '2',
  summer: '3',
  'fall final exam retake': '7',
  'spring final exam retake': '8',
}

/** "2025-2026 Fall" -> "20251"; bilinmeyen -> null. */
export function semesterFromLabel(label: string): string | null {
  const match = /^(\d{4})-\d{4}\s+(.+)$/.exec(clean(label))
  if (!match) return null
  const term = TERM_BY_NAME[match[2].toLowerCase()]
  return term ? `${match[1]}${term}` : null
}

/** "CS 101-1" -> ["CS 101", "1"]; "CS 202-001" -> ["CS 202", "1"]. */
export function splitSectionCode(value: string): [string, string] | null {
  const match = /^([A-Z]+\s+\d+[A-Z]?)-0*(\d+[A-Z]?)$/.exec(clean(value))
  if (!match) return null
  return [match[1].replace(/\s+/, ' '), match[2]]
}

export function deptOf(courseCode: string): string {
  return courseCode.split(' ')[0]
}
