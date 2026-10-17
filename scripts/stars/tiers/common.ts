import { ajaxUrl } from '../http'
import { parseDepartments, type DepartmentRow } from '../parse/departments'
import { parseOfferings, type OfferingRow } from '../parse/offerings'
import type { Ctx } from '../lib/context'

/** plainCourseCodes: bolum listesi. Gelmezse ya da cok kisaysa hata (katman yazmaz). */
export async function fetchDepartments(ctx: Ctx): Promise<DepartmentRow[]> {
  const html = await ctx.client.get(ajaxUrl('plainCourseCodes.php'))
  const departments = parseDepartments(html ?? '')
  if (departments.length < 30) throw new Error(`plainCourseCodes: only ${departments.length} departments parsed`)
  return departments
}

/**
 * Bir bolumun bir donemdeki subeleri. "no course" -> []; gecersiz govde
 * (poTable yok) -> null, cagiran onceki veriyi korur.
 */
export async function fetchOfferings(ctx: Ctx, dept: string, semester: string): Promise<OfferingRow[] | null> {
  const html = await ctx.client.get(ajaxUrl('plainOfferings.php', { COURSE_CODE: dept, SEMESTER: semester }))
  // o donem dersi olmayan bolum: <div id='poDiv'>no course</div> (gecerli, bos)
  if (html && /<div id=['"]poDiv['"]>\s*no course\s*<\/div>/i.test(html)) return []
  if (!html || !/id=['"]poTable['"]/.test(html)) {
    ctx.log(`   ${dept}/${semester}: gecersiz yanit (${html?.length ?? 0} B)`)
    return null
  }
  return parseOfferings(html)
}
