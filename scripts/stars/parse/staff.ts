import { clean, load } from './util'

export interface StaffRow {
  id: string
  /** STARS listesindeki bicim: "Soyad Ad" */
  listName: string
  title: string | null
  web: string | null
}

/**
 * staff.list.php?DEPT=<BOLUM>. Sutunlar: ad, unvan, dahili, direkt hat, e-posta,
 * oda, web, linkler. Telefon / oda / e-posta bilerek OKUNMAZ (kural: hicbir
 * dosyaya yazilmaz); yalnizca ad, unvan, web ve STARS ID'si.
 */
export function parseStaffList(html: string): StaffRow[] {
  const $ = load(html)
  const rows: StaffRow[] = []
  $('#staffList tr').each((_, tr) => {
    const cells = $(tr).children('td')
    if (cells.length < 8) return
    const id = /openCoursesPage\('(\d+)'\)/.exec($.html(cells.eq(7)) ?? '')?.[1]
    if (!id) return
    const title = clean(cells.eq(1).text())
    const web = cells.eq(6).find('a').attr('href')?.trim() || null
    rows.push({ id, listName: clean(cells.eq(0).text()), title: title || null, web })
  })
  return rows
}
