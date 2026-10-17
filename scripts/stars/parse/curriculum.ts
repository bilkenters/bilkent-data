import { clean, load, toNumber } from './util'

export type ProgramKind = 'major' | 'minor' | 'other'

export interface ProgramLink {
  program: string
  track: string
  name: string
  kind: ProgramKind
  /** "Undergraduate Programs" / "Graduate Programs" */
  level: string
}

/** curriculum.php?DEPT=<BOLUM> -> program listesi (openCurriculumlPage('CTIS_BS_F','')). */
export function parseProgramList(html: string): ProgramLink[] {
  const $ = load(html)
  const programs: ProgramLink[] = []
  $('div.titlebar').each((_, bar) => {
    const level = clean($(bar).text())
    const graduate = /graduate/i.test(level) && !/undergraduate/i.test(level)
    const list = $(bar).nextAll('ul.ddmarkermenu').first()
    let heading = ''
    list.children().each((__, child) => {
      const el = $(child)
      if (child.type === 'tag' && child.name === 'h4') {
        heading = clean(el.text())
        return
      }
      const onclick = el.find('a').attr('onclick') ?? ''
      const match = /openCurriculumlPage\('([^']*)',\s*'([^']*)'\)/.exec(onclick)
      if (!match) return
      const anchor = el.find('a').first().clone()
      anchor.find('small').remove()
      const kind: ProgramKind = graduate ? 'other' : /minor/i.test(heading) ? 'minor' : /major/i.test(heading) ? 'major' : 'other'
      programs.push({ program: match[1], track: match[2], name: clean(anchor.text()), kind, level })
    })
  })
  return programs
}

export type CurriculumItem =
  | { course: string; credits: number | null }
  | { elective: string; credits: number | null; group?: string }

export interface CurriculumSemester {
  label: string
  items: CurriculumItem[]
}

export interface ElectiveGroupRef {
  code: string
  title: string
  /** ozet tablosundaki sayi: "Technical Elective (6)" -> 6 */
  count: number | null
}

export interface CurriculumPage {
  name: string | null
  semesters: CurriculumSemester[]
  electiveGroups: ElectiveGroupRef[]
  /** mufredattaki on kosul metinleri (ders -> "CS 101") */
  prerequisites: Record<string, string>
}

const YEAR_TR: Record<string, string> = {
  'First Year': '1. Yıl',
  'Second Year': '2. Yıl',
  'Third Year': '3. Yıl',
  'Fourth Year': '4. Yıl',
  'Fifth Year': '5. Yıl',
}
const TERM_TR: Record<string, string> = { 'Autumn Semester': 'Güz', 'Fall Semester': 'Güz', 'Spring Semester': 'Bahar', 'Summer Semester': 'Yaz' }

/** "Technical Electives (3)" ~ "Technical Elective" : tekil, sayisiz, kucuk harf. */
function electiveKey(title: string): string {
  return clean(title.replace(/\(\s*\d+\s*\)/g, ''))
    .toLowerCase()
    .replace(/electives\b/g, 'elective')
}

/**
 * ajax/curriculum.printableHTML.php?PROGRAM=&TRACK= : yil basliklari (h2) +
 * donem tablolari (table.printMod, thead th "Autumn Semester"), satirlar:
 * kod, ad, ders/lab saati, kredi, ECTS, on kosul ("Pre: ..."). Kodu bos satir =
 * secmeli kutusu. Sondaki "Elective Courses" tablosu grup kodlarini verir.
 */
export function parseCurriculum(html: string): CurriculumPage {
  const $ = load(html)
  const semesters: CurriculumSemester[] = []
  const electiveGroups: ElectiveGroupRef[] = []
  const prerequisites: Record<string, string> = {}

  $('a[href*="openElectiveGroup"]').each((_, a) => {
    const args = [...($(a).attr('href') ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1])
    if (args.length < 4) return
    const rowLabel = clean($(a).closest('tr').children('td').first().text())
    const count = /\((\d+)\)\s*$/.exec(rowLabel)?.[1]
    electiveGroups.push({ code: args[3], title: args[4] ?? rowLabel, count: count ? Number(count) : null })
  })
  const groupByKey = new Map(electiveGroups.map((g) => [electiveKey(g.title), g.code]))

  let year = ''
  $('h2.printModHeader, table.printMod').each((_, el) => {
    const node = $(el)
    if (el.type === 'tag' && el.name === 'h2') {
      year = clean(node.text())
      return
    }
    const term = clean(node.find('thead th[colspan]').first().text())
    if (!term || /elective courses/i.test(term)) return
    const label = [YEAR_TR[year] ?? year, TERM_TR[term] ?? term].filter(Boolean).join(' ') || term
    const items: CurriculumItem[] = []
    node.find('tr').each((__, tr) => {
      const cells = $(tr).children('td')
      if (cells.length < 6) return
      const codeCell = cells.eq(0).clone()
      codeCell.find('sup').remove()
      const code = clean(codeCell.text()).replace(/\s+/g, ' ')
      const name = clean(cells.eq(1).text())
      const credits = toNumber(cells.eq(4).text())
      if (/^[A-Z]+ \d+[A-Z]?$/.test(code)) {
        items.push({ course: code, credits })
        const pre = clean(cells.eq(6).text()).replace(/^Pre:\s*/i, '')
        if (pre) prerequisites[code] = pre
      } else if (name) {
        const group = groupByKey.get(electiveKey(name))
        items.push(group ? { elective: name, credits, group } : { elective: name, credits })
      }
    })
    if (items.length > 0) semesters.push({ label, items })
  })

  const title = clean($('font.title').last().text()) || null
  return { name: title, semesters, electiveGroups, prerequisites }
}

/** ajax/curriculum.electiveCourses.php -> gruptaki ders kodlari. */
export function parseElectiveCourses(html: string): string[] {
  const $ = load(html)
  const codes: string[] = []
  $('table.printMod tr').each((_, tr) => {
    const code = clean($(tr).children('td').first().text()).replace(/\s+/g, ' ')
    if (/^[A-Z]+ \d+[A-Z]?$/.test(code) && !codes.includes(code)) codes.push(code)
  })
  return codes
}
