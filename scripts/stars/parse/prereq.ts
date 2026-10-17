/**
 * On kosul ifadesi -> agac. Deterministik, LLM yok.
 *   "CS 201 and (MATH 132 or MATH 210)" -> and[CS 201, or[MATH 132, MATH 210]]
 * Oncelik: `and` > `or`; virgul, ayni seviyedeki ilk acik baglaca (yoksa `and`)
 * esitlenir. Ders kodu olmayan kelimeler `{ text }` olur ("consent of instructor").
 * Dengesiz parantez tolere edilir (fazla ")" atlanir, eksik ")" sonda kapanir).
 */

export type PrereqNode =
  | { course: string }
  | { and: PrereqNode[] }
  | { or: PrereqNode[] }
  | { text: string }

export interface PrereqParse {
  tree: PrereqNode | null
  /** hic `{ text }` parcasi yok ve parantez onarimi gerekmedi */
  complete: boolean
  texts: string[]
}

type Token =
  | { t: 'course'; v: string }
  | { t: 'op'; v: 'and' | 'or' }
  | { t: 'comma' }
  | { t: 'open' }
  | { t: 'close' }
  | { t: 'text'; v: string }

const COURSE = /^([A-Z]{2,6})\s*[- ]?\s*(\d{3}[A-Z]?)\b/
const TRIM_TEXT = /^[\s.;:,-]+|[\s.;:,-]+$/g

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let text: string[] = []
  const flush = () => {
    const value = text.join(' ').replace(TRIM_TEXT, '')
    if (value) tokens.push({ t: 'text', v: value })
    text = []
  }
  let rest = input.replace(/ /g, ' ').trim()
  while (rest.length > 0) {
    const space = /^\s+/.exec(rest)
    if (space) {
      rest = rest.slice(space[0].length)
      continue
    }
    const ch = rest[0]
    if (ch === '(' || ch === '[') {
      flush()
      tokens.push({ t: 'open' })
      rest = rest.slice(1)
      continue
    }
    if (ch === ')' || ch === ']') {
      flush()
      tokens.push({ t: 'close' })
      rest = rest.slice(1)
      continue
    }
    if (ch === ',' || ch === ';') {
      flush()
      tokens.push({ t: 'comma' })
      rest = rest.slice(1)
      continue
    }
    if (ch === '&') {
      flush()
      tokens.push({ t: 'op', v: 'and' })
      rest = rest.slice(1)
      continue
    }
    const course = COURSE.exec(rest)
    if (course) {
      flush()
      tokens.push({ t: 'course', v: `${course[1]} ${course[2]}` })
      rest = rest.slice(course[0].length)
      continue
    }
    const word = /^[^\s(),;[\]&]+/.exec(rest)!
    const lower = word[0].toLowerCase()
    if (lower === 'and' || lower === 'or') {
      flush()
      tokens.push({ t: 'op', v: lower })
    } else {
      text.push(word[0])
    }
    rest = rest.slice(word[0].length)
  }
  flush()
  return tokens
}

type Item = PrereqNode | 'and' | 'or' | 'comma'

function group(kind: 'and' | 'or', items: PrereqNode[]): PrereqNode {
  const flat: PrereqNode[] = []
  for (const item of items) {
    if (kind in item) flat.push(...(item as Record<string, PrereqNode[]>)[kind])
    else flat.push(item)
  }
  return flat.length === 1 ? flat[0] : kind === 'and' ? { and: flat } : { or: flat }
}

/** Bir parantez seviyesindeki islenen/bagla c dizisini agaca cevirir. */
function reduce(items: Item[]): PrereqNode | null {
  // virgulleri cozumle: sagdaki ilk acik baglac, yoksa soldaki, yoksa 'and'
  const resolved: Item[] = items.map((item, i) => {
    if (item !== 'comma') return item
    const right = items.slice(i + 1).find((x) => x === 'and' || x === 'or')
    const left = [...items.slice(0, i)].reverse().find((x) => x === 'and' || x === 'or')
    return (right ?? left ?? 'and') as 'and' | 'or'
  })
  // ardisik islenenler arasina 'and' koy; fazla/eksik baglaclari at
  const seq: Item[] = []
  for (const item of resolved) {
    const isOp = item === 'and' || item === 'or'
    const last = seq[seq.length - 1]
    const lastIsOp = last === 'and' || last === 'or'
    if (isOp) {
      if (seq.length === 0) continue
      if (lastIsOp) seq[seq.length - 1] = item
      else seq.push(item)
    } else {
      if (seq.length > 0 && !lastIsOp) seq.push('and')
      seq.push(item)
    }
  }
  while (seq.length && (seq[seq.length - 1] === 'and' || seq[seq.length - 1] === 'or')) seq.pop()
  if (seq.length === 0) return null
  // and > or
  const ors: PrereqNode[] = []
  let ands: PrereqNode[] = []
  for (const item of seq) {
    if (item === 'or') {
      ors.push(group('and', ands))
      ands = []
    } else if (item !== 'and') {
      ands.push(item as PrereqNode)
    }
  }
  ors.push(group('and', ands))
  return group('or', ors)
}

export function parsePrerequisite(raw: string | null | undefined): PrereqParse {
  const input = (raw ?? '').replace(/^\s*(pre(requisites?)?|prereq)\s*:\s*/i, '').trim()
  if (!input || /^(none|-|yok)$/i.test(input)) return { tree: null, complete: true, texts: [] }

  const tokens = tokenize(input)
  let repaired = false
  const stack: Item[][] = [[]]
  for (const token of tokens) {
    const top = stack[stack.length - 1]
    switch (token.t) {
      case 'course':
        top.push({ course: token.v })
        break
      case 'text':
        top.push({ text: token.v })
        break
      case 'op':
        top.push(token.v)
        break
      case 'comma':
        top.push('comma')
        break
      case 'open':
        stack.push([])
        break
      case 'close': {
        if (stack.length === 1) {
          repaired = true
          break
        }
        const inner = reduce(stack.pop()!)
        if (inner) stack[stack.length - 1].push(inner)
        break
      }
    }
  }
  while (stack.length > 1) {
    repaired = true
    const inner = reduce(stack.pop()!)
    if (inner) stack[stack.length - 1].push(inner)
  }
  const tree = reduce(stack[0])
  const texts = collectTexts(tree)
  return { tree, complete: !repaired && texts.length === 0, texts }
}

export function collectTexts(node: PrereqNode | null): string[] {
  if (!node) return []
  if ('text' in node) return [node.text]
  if ('course' in node) return []
  return ('and' in node ? node.and : node.or).flatMap(collectTexts)
}

/** Agactaki her ders kodu + dogrudan ebeveyn grubunun tipi (kok = 'and'). */
export function prereqEdges(node: PrereqNode | null, parent: 'and' | 'or' = 'and'): Array<[string, 'and' | 'or']> {
  if (!node || 'text' in node) return []
  if ('course' in node) return [[node.course, parent]]
  if ('and' in node) return node.and.flatMap((child) => prereqEdges(child, 'and'))
  return node.or.flatMap((child) => prereqEdges(child, 'or'))
}
