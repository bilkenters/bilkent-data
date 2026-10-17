import { STARS_BASE, ajaxUrl } from '../http'
import type { Ctx } from '../lib/context'
import { InstructorStore, unitToDept } from '../lib/store'
import { parseAcademicUnits } from '../parse/departments'
import { parseStaffList } from '../parse/staff'

/**
 * Ayda bir: staff.list.php?DEPT= her akademik birim icin -> id, unvan, web.
 * Telefon / oda / e-posta parser'da bile okunmaz. Ad: offerings/gecmisteki
 * gosterim adi ("Ad Soyad") varsa o, yoksa listedeki "Soyad Ad".
 */
export async function runStaff(ctx: Ctx): Promise<void> {
  const unitsHtml = await ctx.client.get(`${STARS_BASE}/homepage/academic_units.php`)
  const units = parseAcademicUnits(unitsHtml ?? '')
  if (units.length < 20) throw new Error(`academic_units: only ${units.length} units`)
  const store = new InstructorStore()
  let people = 0
  let ok = 0
  await ctx.client.runAll(units, async (unit) => {
    const html = await ctx.client.get(ajaxUrl('staff.list.php', { DEPT: unit.code, orderby: '' }))
    if (!html || !/id=['"]staffList['"]/.test(html)) return
    ok++
    for (const row of parseStaffList(html)) {
      const existing = store.data[row.id]
      store.set(row.id, {
        name: existing?.name ?? row.listName,
        title: row.title,
        dept: unitToDept(unit.code),
        web: row.web,
      })
      people++
    }
    ctx.state.staff[unit.code] = ctx.now()
  })
  store.flush(ctx.writer)
  Object.assign(ctx.coverage, { units: units.length, unitsOk: ok, staffRows: people, instructors: Object.keys(store.data).length })
}
