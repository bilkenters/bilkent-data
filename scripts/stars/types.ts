/**
 * data/stars/** sozlesmesi (docs/stars-veri/01-scraper.md §"Veri sozlesmesi").
 * Yalnizca sunucu/build okur. S2/S3 okuyuculari (lib/stars/**) bu tipleri kullanir.
 */
import type { PrereqNode } from './parse/prereq'

export type { PrereqNode }

export interface CourseHours {
  lectureOnline: number
  lectureF2F: number
  recitation: number
  labF2F: number
  labOnline: number
}

/** [donem, sube, hocaID'leri, ogrenci, subeGPA, dersGPA] */
export type HistoryTuple = [
  semester: string,
  section: string,
  instructorIds: string[],
  students: number,
  sectionGpa: number | null,
  courseGpa: number | null,
]

export interface CourseRecord {
  name: string
  /** katalog metni (Ingilizce, oldugu gibi) */
  description: string | null
  /** ham ifade; "none" -> null */
  prerequisite: string | null
  prerequisiteTree: PrereqNode | null
  credits: number | null
  ects: number | null
  /** courses.list'ten; katalogda olmayan derste null */
  hours: CourseHours | null
  inCatalog: boolean
  /** STARS'in verdigi tum satirlar, yeniden eskiye (1990'a kadar) */
  history: HistoryTuple[]
  /** kaydin icerigi en son degistiginde (ya da ilk yazildiginda); kontrol zamani state.json'da */
  fetchedAt: string
}

/** data/stars/courses/<BOLUM>.json */
export type CourseFile = Record<string, CourseRecord>

/** data/stars/prereq-graph.json */
export interface PrereqGraph {
  edges: Array<[course: string, prerequisite: string, group: 'and' | 'or']>
  reverse: Record<string, string[]>
}

/** data/stars/departments.json */
export type DepartmentsFile = Record<string, { name: string; faculty: string; catalogUrl: string | null }>

export type CurriculumItem =
  | { course: string; credits: number | null }
  | { elective: string; credits: number | null; group?: string }

export interface CurriculumProgram {
  /** STARS program kodu; iz (track) varsa "PROG:TRACK" */
  id: string
  name: string
  kind: 'major' | 'minor' | 'other'
  semesters: Array<{ label: string; items: CurriculumItem[] }>
  /** secmeli gruplari; `courses` null = cekilmedi (lisansustu) ya da cok genis (acik secmeli) */
  electiveGroups?: Array<{ code: string; title: string; count: number | null; courses: string[] | null }>
  fetchedAt: string
}

/** data/stars/curricula/<BOLUM>.json */
export interface CurriculumFile {
  programs: CurriculumProgram[]
}

/** data/stars/instructors.json — telefon / ofis / e-posta YOK */
export type InstructorsFile = Record<string, { name: string; title: string | null; dept: string | null; web: string | null }>

export interface SyllabusRecord {
  coordinator: string | null
  assessments: Array<{ type: string; label: string; count: number; weight: number }>
  fzText: string | null
  weekly: string[]
  textbooks: string[]
  outcomes: string[]
  ectsWorkloadTotal: number | null
  prerequisiteText: string | null
  fetchedAt: string
}

/** data/stars/syllabi/<donem>/<BOLUM>.json */
export type SyllabusFile = Record<
  string,
  {
    /** sube -> varyant hash'i. Ayni hoca kumesindeki subeler cekilen subenin varyantina atanir. */
    sections: Record<string, string>
    variants: Record<string, SyllabusRecord>
    /** gercekten cekilen subeler */
    fetched?: string[]
  }
>

/** data/stars/schedule/<donem>.json — schedule.php onbellegi (tur + spare), saat metni hash'ine bagli */
export type ScheduleCacheFile = Record<string, { h: string; spare: number[]; kinds: Record<string, 'DY' | 'DD' | 'DR' | 'LL' | 'LO'> }>

export interface RunSummary {
  tier: string
  at: string
  requests: number
  statuses: Record<string, number>
  durationMs: number
  halted: string | null
  coverage: Record<string, number | string>
}

/** data/stars/state.json */
export interface StateFile {
  /** ders -> son kontrol (oldOfferings) */
  course: Record<string, string>
  /** donem -> ders -> son kontrol */
  syllabus: Record<string, { firstRunAt?: string; courses: Record<string, string> }>
  staff: Record<string, string>
  catalog: Record<string, string>
  curriculum: Record<string, string>
  /** donem -> tamamlanan bolumler */
  backfill: Record<string, string[]>
  lastRun: Record<string, RunSummary>
}
