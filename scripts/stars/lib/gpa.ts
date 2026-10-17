import type { HistoryTuple } from '../types'
import { academicYear, isRegularTerm } from './semesters'

export const GPA_WINDOW_YEARS = 5
export const MIN_INSTRUCTOR_STUDENTS = 20

export function gpaToLetterGrade(gpa: number): string {
  if (gpa >= 3.67) return 'A'
  if (gpa >= 3.33) return 'A-'
  if (gpa >= 3.0) return 'B+'
  if (gpa >= 2.67) return 'B'
  if (gpa >= 2.33) return 'B-'
  if (gpa >= 2.0) return 'C+'
  if (gpa >= 1.67) return 'C'
  if (gpa >= 1.33) return 'C-'
  if (gpa >= 1.0) return 'D+'
  if (gpa >= 0.67) return 'D'
  return 'F'
}

/**
 * Pencere: guncel donemin akademik yilindan onceki 5 tam akademik yil
 * (20261..20263 icin 2021-22..2025-26). Yil icinde sabit kalir.
 * Final tekrar donemleri (x7/x8) ve GPA'si 0/bos satirlar (S/U dersler) disarida.
 */
export function inWindow(semester: string, currentSemester: string): boolean {
  const year = academicYear(semester)
  const current = academicYear(currentSemester)
  return isRegularTerm(semester) && year >= current - GPA_WINDOW_YEARS && year <= current - 1
}

const round2 = (n: number) => Math.round(n * 100) / 100

export interface GpaSummary {
  averageGpa: number
  letterGrade: string
  gpaSampleSize: number
  gpaSemesters: number
}

/** Ders ortalamasi: STARS "Course GPA", ogrenci sayisiyla agirlikli. */
export function courseGpa(history: HistoryTuple[], currentSemester: string): GpaSummary | null {
  let weighted = 0
  let students = 0
  const semesters = new Set<string>()
  for (const [semester, , , count, , gpa] of history) {
    if (!inWindow(semester, currentSemester) || gpa === null || gpa <= 0 || count <= 0) continue
    weighted += gpa * count
    students += count
    semesters.add(semester)
  }
  if (students === 0) return null
  const averageGpa = round2(weighted / students)
  return { averageGpa, letterGrade: gpaToLetterGrade(averageGpa), gpaSampleSize: students, gpaSemesters: semesters.size }
}

/** Hocanin bu dersteki (tek hocali) sube GPA'lari, ayni pencere; n < 20 -> null. */
export function instructorGpa(history: HistoryTuple[], instructorId: string, currentSemester: string): { gpa: number; letterGrade: string; sampleSize: number } | null {
  let weighted = 0
  let students = 0
  for (const [semester, , ids, count, sectionGpa] of history) {
    if (!inWindow(semester, currentSemester) || ids.length !== 1 || ids[0] !== instructorId) continue
    if (sectionGpa === null || sectionGpa <= 0 || count <= 0) continue
    weighted += sectionGpa * count
    students += count
  }
  if (students < MIN_INSTRUCTOR_STUDENTS) return null
  const gpa = round2(weighted / students)
  return { gpa, letterGrade: gpaToLetterGrade(gpa), sampleSize: students }
}
