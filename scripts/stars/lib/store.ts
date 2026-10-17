import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { CourseFile, CourseRecord, InstructorsFile, StateFile } from '../types'
import { readJson, type Writer } from './json'
import { paths } from './paths'

export function emptyState(): StateFile {
  return { course: {}, syllabus: {}, staff: {}, catalog: {}, curriculum: {}, backfill: {}, lastRun: {} }
}

export function readState(): StateFile {
  return { ...emptyState(), ...readJson<Partial<StateFile>>(paths.state(), {}) }
}

export function shortHash(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 10)
}

/** "CS 101" -> "CS" */
export function deptOf(code: string): string {
  return code.split(' ')[0]
}

/** STARS birim kodu -> ders kodu (curriculum.php?DEPT=EE, dersler EEE). */
const UNIT_ALIAS: Record<string, string> = { EE: 'EEE' }
export function unitToDept(unit: string): string {
  return UNIT_ALIAS[unit] ?? unit
}

/** Bolum bazli ders dosyalari: tembel yukleme + degisenleri yazma. */
export class CourseStore {
  private files = new Map<string, CourseFile>()
  private dirty = new Set<string>()

  load(dept: string): CourseFile {
    let file = this.files.get(dept)
    if (!file) {
      file = readJson<CourseFile>(paths.courses(dept), {})
      this.files.set(dept, file)
    }
    return file
  }

  get(code: string): CourseRecord | undefined {
    return this.load(deptOf(code))[code]
  }

  /** icerik (fetchedAt haric) degistiyse fetchedAt'i yeniler ve kaydeder */
  put(code: string, next: Omit<CourseRecord, 'fetchedAt'>, now: string): boolean {
    const dept = deptOf(code)
    const file = this.load(dept)
    const previous = file[code]
    if (previous) {
      const { fetchedAt, ...rest } = previous
      if (JSON.stringify(rest) === JSON.stringify(next)) return false
    }
    file[code] = { ...next, fetchedAt: now }
    this.dirty.add(dept)
    return true
  }

  loadAll(): Map<string, CourseFile> {
    let names: string[] = []
    try {
      names = fs.readdirSync(paths.coursesDir()).filter((f) => f.endsWith('.json'))
    } catch {
      names = []
    }
    for (const name of names) this.load(path.basename(name, '.json'))
    return this.files
  }

  flush(writer: Writer): number {
    let count = 0
    for (const dept of [...this.dirty].sort()) {
      const file = this.files.get(dept)!
      const sorted = Object.fromEntries(Object.entries(file).sort(([a], [b]) => compareCodes(a, b)))
      if (writer.write(paths.courses(dept), sorted)) count++
    }
    this.dirty.clear()
    return count
  }
}

/** "CS 101" < "CS 102" < "CS 1010"; bolum alfabetik. */
export function compareCodes(a: string, b: string): number {
  const [da, na = ''] = a.split(' ')
  const [db, nb = ''] = b.split(' ')
  if (da !== db) return da < db ? -1 : 1
  const numA = Number(na.replace(/\D/g, '')) || 0
  const numB = Number(nb.replace(/\D/g, '')) || 0
  return numA - numB || (na < nb ? -1 : na > nb ? 1 : 0)
}

export function blankCourse(name: string): Omit<CourseRecord, 'fetchedAt'> {
  return {
    name,
    description: null,
    prerequisite: null,
    prerequisiteTree: null,
    credits: null,
    ects: null,
    hours: null,
    inCatalog: false,
    history: [],
  }
}

/** Hoca ID -> ad (+ kadro katmaninin unvan/web). Yalnizca eksik ID'ler eklenir. */
export class InstructorStore {
  readonly data: InstructorsFile
  private changed = false
  constructor() {
    this.data = readJson<InstructorsFile>(paths.instructors(), {})
  }
  /**
   * Gosterim adi (offerings/gecmis: "Selim Aksoy") ekler. Kadro listesinden gelen
   * "Aksoy Selim" ayni kelimelerden olusuyorsa gosterim adiyla degistirilir.
   */
  addName(id: string, name: string): void {
    if (!id || !name) return
    const existing = this.data[id]
    if (!existing) {
      this.data[id] = { name, title: null, dept: null, web: null }
      this.changed = true
      return
    }
    const words = (value: string) => value.toLocaleLowerCase('tr-TR').split(/\s+/).sort().join(' ')
    if (existing.name !== name && words(existing.name) === words(name)) {
      this.data[id] = { ...existing, name }
      this.changed = true
    }
  }
  set(id: string, value: InstructorsFile[string]): void {
    if (JSON.stringify(this.data[id]) === JSON.stringify(value)) return
    this.data[id] = value
    this.changed = true
  }
  flush(writer: Writer): boolean {
    if (!this.changed) return false
    const sorted = Object.fromEntries(Object.entries(this.data).sort(([a], [b]) => Number(a) - Number(b)))
    return writer.write(paths.instructors(), sorted)
  }
}
