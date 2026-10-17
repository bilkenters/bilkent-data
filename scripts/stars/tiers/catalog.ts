import { ajaxUrl, STARS_BASE } from '../http'
import type { Ctx } from '../lib/context'
import { readJson } from '../lib/json'
import { paths } from '../lib/paths'
import { CourseStore, blankCourse, deptOf, unitToDept } from '../lib/store'
import { parseCatalog } from '../parse/catalog'
import { parseAcademicUnits } from '../parse/departments'
import type { DepartmentsFile } from '../types'
import { fetchDepartments } from './common'

/**
 * Ayda bir: courses.list.php her bolum icin -> acilmayanlar dahil tum katalog
 * (ad, saat dagilimi, kredi). Kayit yoksa bos kayit acilir; gecmis/aciklama
 * course katmanindan gelir. academic_units -> departments.json katalog linkleri.
 */
export async function runCatalog(ctx: Ctx): Promise<void> {
  const departments = await fetchDepartments(ctx)
  const store = new CourseStore()
  const now = ctx.now()
  let courses = 0
  let created = 0
  let dropped = 0
  let ok = 0
  await ctx.client.runAll(departments, async (dept) => {
    const html = await ctx.client.get(ajaxUrl('courses.list.php', { CRSCODES: dept.code, SHW: '' }))
    if (!html || !/id=['"]courseList['"]/.test(html)) {
      ctx.log(`   ${dept.code}: gecersiz katalog yaniti`)
      return
    }
    ok++
    const rows = parseCatalog(html).filter((row) => deptOf(row.code) === dept.code)
    const file = store.load(dept.code)
    const inCatalog = new Set<string>()
    for (const row of rows) {
      inCatalog.add(row.code)
      const existing = file[row.code]
      if (!existing) created++
      const { fetchedAt, ...base } = existing ?? { ...blankCourse(row.name), fetchedAt: now }
      store.put(row.code, { ...base, name: row.name, credits: row.credits, ects: row.ects, hours: row.hours, inCatalog: true }, now)
      courses++
    }
    // bos donen katalog (aksaklik) mevcut isaretleri silmesin
    if (rows.length === 0) return
    for (const [code, record] of Object.entries(file)) {
      if (inCatalog.has(code) || !record.inCatalog) continue
      const { fetchedAt, ...base } = record
      store.put(code, { ...base, inCatalog: false }, now)
      dropped++
    }
    ctx.state.catalog[dept.code] = now
  })
  store.flush(ctx.writer)

  // katalog linkleri (bilgi amacli; katalog sitesi cekilmez)
  const unitsHtml = await ctx.client.get(`${STARS_BASE}/homepage/academic_units.php`).catch(() => null)
  if (unitsHtml) {
    const units = parseAcademicUnits(unitsHtml)
    const file = readJson<DepartmentsFile>(paths.departments(), {})
    for (const unit of units) {
      const code = unitToDept(unit.code)
      if (file[code] && unit.catalogUrl) file[code] = { ...file[code], catalogUrl: unit.catalogUrl }
    }
    ctx.writer.write(paths.departments(), file)
  }
  Object.assign(ctx.coverage, { departmentsOk: ok, catalogCourses: courses, created, droppedFromCatalog: dropped })
}
