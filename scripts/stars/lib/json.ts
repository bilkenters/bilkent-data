import fs from 'node:fs'
import path from 'node:path'

/**
 * Diff dostu JSON: ilkel degerlerden olusan dizi/nesneler tek satira, digerleri
 * girintili. Ayni veri her zaman ayni metni uretir (churn yok).
 */
export function formatJson(value: unknown, indent = 2): string {
  return format(value, 0, indent) + '\n'
}

const isPrimitive = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v)
const isLeaf = (v: unknown) => isPrimitive(v) || (Array.isArray(v) && v.every(isPrimitive))
const FLAT_MAX = 200

/** Tek satira sigan, yalnizca ilkel (ya da ilkel dizi) iceren dizi/nesne. */
function isFlat(value: unknown): boolean {
  if (isPrimitive(value)) return true
  const children = Array.isArray(value) ? value : Object.values(value as object)
  return children.every(isLeaf) && JSON.stringify(value).length <= FLAT_MAX
}

function format(value: unknown, depth: number, indent: number): string {
  if (value === undefined) return 'null'
  if (isFlat(value)) return JSON.stringify(value)
  const pad = ' '.repeat((depth + 1) * indent)
  const end = ' '.repeat(depth * indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[\n${value.map((v) => pad + format(v, depth + 1, indent)).join(',\n')}\n${end}]`
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return '{}'
  return `{\n${entries.map(([k, v]) => `${pad}${JSON.stringify(k)}: ${format(v, depth + 1, indent)}`).join(',\n')}\n${end}}`
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

export interface Writer {
  dryRun: boolean
  changed: string[]
  write(file: string, data: unknown): boolean
  remove(file: string): boolean
}

/** Degismeyen dosyaya dokunmaz; dry-run'da yazmaz ama degisecek dosyalari sayar. */
export function createWriter(dryRun: boolean, log: (msg: string) => void = console.log): Writer {
  const changed: string[] = []
  return {
    dryRun,
    changed,
    write(file, data) {
      const next = formatJson(data)
      let current: string | null = null
      try {
        current = fs.readFileSync(file, 'utf8')
      } catch {
        current = null
      }
      if (current === next) return false
      changed.push(file)
      if (dryRun) {
        log(`   [dry-run] would write ${path.relative(process.cwd(), file)} (${next.length} B)`)
        return true
      }
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, next)
      return true
    },
    remove(file) {
      if (!fs.existsSync(file)) return false
      changed.push(file)
      if (!dryRun) fs.rmSync(file)
      return true
    },
  }
}
