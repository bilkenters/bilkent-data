import type { Ctx } from '../lib/context'
import { paths } from '../lib/paths'
import { CourseStore, compareCodes } from '../lib/store'
import { prereqEdges } from '../parse/prereq'
import type { PrereqGraph } from '../types'

export interface GraphReport {
  edges: number
  withPrerequisite: number
  cycles: string[][]
}

/** Tum courses/*.json'dan on kosul kenarlari + ters indeks. Donguleri raporlar. */
export function buildPrereqGraph(ctx: Ctx, store = new CourseStore()): GraphReport {
  const files = store.loadAll()
  const edges: PrereqGraph['edges'] = []
  let withPrerequisite = 0
  for (const file of [...files.values()]) {
    for (const [code, record] of Object.entries(file)) {
      if (!record.prerequisiteTree) continue
      withPrerequisite++
      const seen = new Set<string>()
      for (const [pre, group] of prereqEdges(record.prerequisiteTree)) {
        if (pre === code || seen.has(pre)) continue
        seen.add(pre)
        edges.push([code, pre, group])
      }
    }
  }
  edges.sort((a, b) => compareCodes(a[0], b[0]) || compareCodes(a[1], b[1]))
  const reverse: Record<string, string[]> = {}
  for (const [course, pre] of edges) (reverse[pre] ??= []).push(course)
  const sortedReverse = Object.fromEntries(Object.entries(reverse).sort(([a], [b]) => compareCodes(a, b)))
  ctx.writer.write(paths.prereqGraph(), { edges, reverse: sortedReverse } satisfies PrereqGraph)
  return { edges: edges.length, withPrerequisite, cycles: findCycles(edges) }
}

/** Ders -> on kosul yonunde basit donguler (Tarjan SCC, boyut > 1). */
export function findCycles(edges: PrereqGraph['edges']): string[][] {
  const adjacency = new Map<string, string[]>()
  for (const [course, pre] of edges) {
    if (!adjacency.has(course)) adjacency.set(course, [])
    adjacency.get(course)!.push(pre)
  }
  let index = 0
  const indexes = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const components: string[][] = []
  const visit = (node: string) => {
    indexes.set(node, index)
    low.set(node, index)
    index++
    stack.push(node)
    onStack.add(node)
    for (const next of adjacency.get(node) ?? []) {
      if (!indexes.has(next)) {
        visit(next)
        low.set(node, Math.min(low.get(node)!, low.get(next)!))
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, indexes.get(next)!))
      }
    }
    if (low.get(node) === indexes.get(node)) {
      const component: string[] = []
      let member: string
      do {
        member = stack.pop()!
        onStack.delete(member)
        component.push(member)
      } while (member !== node)
      if (component.length > 1) components.push(component.sort(compareCodes))
    }
  }
  for (const node of adjacency.keys()) if (!indexes.has(node)) visit(node)
  return components
}
