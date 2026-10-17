/** Donem kodu: YYYYT (T: 1 guz, 2 bahar, 3 yaz, 7/8 final tekrar). YYYY = akademik yilin ilk yili. */

export function academicYear(semester: string): number {
  return Number(semester.slice(0, 4))
}

export function isRegularTerm(semester: string): boolean {
  return /^[123]$/.test(semester.slice(4))
}

export function semesterInfo(code: string): { year: string; code: string; name: string } {
  const year = academicYear(code)
  const term = code.slice(4)
  const names: Record<string, string> = { '1': 'Fall', '2': 'Spring', '3': 'Summer' }
  return { year: `${year}-${year + 1}`, code, name: names[term] ?? 'Unknown' }
}

/** Siradaki olasi donemler (eski scraper'la ayni mantik). */
export function nextSemesters(latest: string): string[] {
  const year = academicYear(latest)
  const term = Number(latest.slice(4))
  const result: string[] = []
  if (term < 3) result.push(`${year}${term + 1}`)
  if (term >= 2) result.push(`${year + 1}1`)
  return result
}
