import type { CourseHours } from './old-offerings'
import { clean, load, toNumber } from './util'

export interface CatalogRow {
  code: string
  name: string
  hours: CourseHours
  credits: number | null
  ects: number | null
}

/**
 * courses.list.php?CRSCODES=<BOLUM>&SHW= : acilmayanlar dahil tum katalog.
 * Sutunlar: kod, ad, ders (online/hibrit, yuz yuze, recitation), lab (yuz yuze,
 * online), kredi, ECTS, linkler.
 */
export function parseCatalog(html: string): CatalogRow[] {
  const $ = load(html)
  const rows: CatalogRow[] = []
  $('#courseList tbody tr').each((_, tr) => {
    const cells = $(tr).children('td')
    const code = clean(cells.eq(0).text()).replace(/\s+/g, ' ')
    if (!/^[A-Z]+ \d+[A-Z]?$/.test(code)) return
    const n = (i: number) => toNumber(cells.eq(i).text()) ?? 0
    rows.push({
      code,
      name: clean(cells.eq(1).text()),
      hours: { lectureOnline: n(2), lectureF2F: n(3), recitation: n(4), labF2F: n(5), labOnline: n(6) },
      credits: toNumber(cells.eq(7).text()),
      ects: toNumber(cells.eq(8).text()),
    })
  })
  return rows
}
