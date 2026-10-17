import { clean, load, toNumber, type CheerioAPI } from './util'

export interface SyllabusAssessment {
  type: string
  label: string
  count: number
  weight: number
}

export interface SyllabusRecord {
  coordinator: string | null
  assessments: SyllabusAssessment[]
  fzText: string | null
  weekly: string[]
  textbooks: string[]
  outcomes: string[]
  ectsWorkloadTotal: number | null
  prerequisiteText: string | null
}

export interface SyllabusPage {
  /** STARS "X is not a course." ya da bos iskelet */
  found: boolean
  record: SyllabusRecord | null
}

/** "N/A", "-", "None" -> null */
function meaningful(value: string): string | null {
  const text = clean(value)
  return text && !/^(n\/a|-|none|yok)$/i.test(text) ? text : null
}

/** Her bolum `<strong>Etiket:</strong>` ile baslar; icerik strong'un ebeveyn kutusudur. */
function sections($: CheerioAPI): Map<string, ReturnType<CheerioAPI>> {
  const map = new Map<string, ReturnType<CheerioAPI>>()
  $('strong').each((_, el) => {
    const label = clean($(el).text()).replace(/:$/, '')
    if (!label || map.has(label)) return
    const box = $(el).parent()
    map.set(label, box)
  })
  return map
}

/** Etiketin ardindan gelen duz metin (strong haric). */
function textAfterLabel($: CheerioAPI, box: ReturnType<CheerioAPI> | undefined): string {
  if (!box) return ''
  const copy = box.clone()
  copy.find('strong').first().remove()
  copy.find('.pad').remove()
  return clean(copy.text())
}

/**
 * /syllabus/show/{donem}/{bolum}/{no}/{sube}. "Office & Office Hours" ve iletisim
 * bilgisi okunmaz. Harf notu araligi syllabus'ta yok (README §3).
 */
export function parseSyllabus(html: string): SyllabusPage {
  const $ = load(html)
  if (/is not a course\./i.test(clean($('h1').first().text())) || !/Assessment Methods/i.test(html)) {
    return { found: false, record: null }
  }
  const box = sections($)

  const assessments: SyllabusAssessment[] = []
  box.get('Assessment Methods')?.find('table tr').each((_, tr) => {
    const cells = $(tr).children('td')
    if (cells.length < 5) return
    const weight = toNumber(cells.eq(4).text())
    if (weight === null) return
    assessments.push({
      type: clean(cells.eq(1).text()),
      label: clean(cells.eq(2).text()),
      count: toNumber(cells.eq(3).text()) ?? 1,
      weight,
    })
  })

  const outcomes: string[] = []
  box.get('Course Learning Outcomes')?.find('table tr').each((_, tr) => {
    const first = $(tr).children('td').first()
    const text = clean(first.text())
    if (text) outcomes.push(text)
  })

  const list = (label: string) =>
    (box.get(label)?.find('li').toArray() ?? [])
      .map((li) => {
        const item = $(li).clone()
        item.find('a').remove()
        return clean(item.text()).replace(/\s*\[\s*\]\s*$/, '')
      })
      .filter(Boolean)

  let weekly = list('Weekly Syllabus')
  if (weekly.length === 0) {
    const text = textAfterLabel($, box.get('Weekly Syllabus'))
    weekly = text ? [text] : []
  }

  let ectsWorkloadTotal: number | null = null
  box.get('ECTS - Workload Table')?.find('tr').each((_, tr) => {
    const cells = $(tr).children('td')
    if (/^Total Workload:?$/i.test(clean(cells.first().text()))) ectsWorkloadTotal = toNumber(cells.last().text())
  })

  return {
    found: true,
    record: {
      coordinator: meaningful(textAfterLabel($, box.get('Course Coordinator'))),
      assessments,
      fzText: meaningful(textAfterLabel($, box.get('Minimum Requirements to Qualify for the Final Exam'))),
      weekly,
      textbooks: list('Textbook and Other Required Material'),
      outcomes,
      ectsWorkloadTotal,
      prerequisiteText: meaningful(textAfterLabel($, box.get('Prerequisite(s)'))),
    },
  }
}
