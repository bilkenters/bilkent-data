import { clean, load } from './util'

export interface DepartmentRow {
  code: string
  name: string
  faculty: string
}

/** plainCourseCodes.php -> bolum kodu, ad, fakulte. */
export function parseDepartments(html: string): DepartmentRow[] {
  const $ = load(html)
  const rows: DepartmentRow[] = []
  $('#ccTable tbody tr').each((_, tr) => {
    const cells = $(tr).find('td')
    const code = clean(cells.eq(0).text())
    if (!/^[A-Z]{2,6}$/.test(code)) return
    rows.push({ code, name: clean(cells.eq(1).text()), faculty: clean(cells.eq(2).text()) })
  })
  return rows
}

export interface AcademicUnitLink {
  /** STARS birim kodu (curriculum.php?DEPT=); ders kodundan farkli olabilir: EE -> EEE */
  code: string
  name: string
  faculty: string | null
  catalogUrl: string | null
  curriculum: boolean
}

/**
 * academic_units.php: fakulte basliklari + bolum satirlari (Courses/Offerings/
 * Curriculum/Staff/Catalog linkleri). Katalog sitesi cekilmez, link bilgi amacli.
 */
export function parseAcademicUnits(html: string): AcademicUnitLink[] {
  const $ = load(html)
  const units: AcademicUnitLink[] = []
  let faculty: string | null = null
  $('table.heading-table, table.row-table').each((_, table) => {
    const t = $(table)
    const title = clean(t.find('th').first().text())
    if (t.hasClass('heading-table')) {
      faculty = title || faculty
      // Hukuk gibi tek birimli fakultelerde bolum linkleri baslik satirinda
      if (t.find("a[href^='courses.php?DEPT=']").length === 0) return
    }
    const courses = t.find("a[href^='courses.php?DEPT=']").attr('href')
    const code = courses ? /DEPT=([A-Z]+)/.exec(courses)?.[1] : undefined
    if (!code) return
    const catalog = t.find("a[href*='catalog.bilkent.edu.tr']").attr('href') ?? null
    units.push({
      code,
      name: title,
      faculty,
      catalogUrl: catalog,
      curriculum: t.find("a[href^='curriculum.php']").length > 0,
    })
  })
  return units
}
