/** public/scheduler/data/offerings/<kod>.json semasi (scheduler scraper uretiyor). */

export interface RawQuota {
  assigned: number
  total: number
  available: number
  /** STARS "Unlimited": total/available 0 kalir (S1, scraper v2) */
  unlimited?: true
}

export interface RawEnrollment {
  mandatory: number
  elective: number
  total: number
}

export interface RawSection {
  instructor: string
  /** timeslot index -> derslik. index = saatIndeksi * 7 + gunIndeksi */
  schedule?: Record<string, string>
  quota?: RawQuota
  enrollment?: RawEnrollment
  /** 20252'den itibaren: hocanin bu dersteki gecmis ortalamasi */
  instructorGpa?: number | null
  instructorGpaSampleSize?: number | null
  instructorLetterGrade?: string | null
  /** S1 (scraper v2): STARS ID'li hoca listesi; "Staff" -> []. `instructor` bunlarin ", " ile birlesimi */
  instructors?: RawInstructor[]
  /** S1: spare (yedek) saat slotlari; `schedule`'da da yer alir (scheduler davranisi ayri karar) */
  spare?: number[]
  /** S1: slot -> tur (DY yuz yuze ders, DD online/hibrit, DR recitation, LL yuz yuze lab, LO online lab) */
  kinds?: Record<string, SlotKind>
}

export interface RawInstructor {
  /** STARS personel ID'si; bilinmiyorsa '' */
  id: string
  name: string
}

export type SlotKind = 'DY' | 'DD' | 'DR' | 'LL' | 'LO'

export interface RawCourse {
  name: string
  credits?: number
  ects?: number
  lectureHours?: number
  labHours?: number
  averageGpa?: number | null
  gpaSampleSize?: number | null
  letterGrade?: string | null
  /** S1: GPA penceresindeki donem sayisi (son 5 akademik yil) */
  gpaSemesters?: number
  sections: Record<string, RawSection>
}

/** bolum kodu -> ders kodu -> ders */
export type RawOfferings = Record<string, Record<string, RawCourse>>

export interface MeetingTime {
  /** "Pazartesi" */
  day: string
  /** "08:30-10:20" */
  time: string
  /** "B-Z03" (bos olabilir) */
  room: string
}

export interface CourseSection {
  section: string
  instructor: string
  meetings: MeetingTime[]
  quota?: RawQuota
  enrollment?: RawEnrollment
  instructorGpa?: number | null
  instructorLetterGrade?: string | null
}

export interface OfferedCourse {
  /** "MATH 101" */
  code: string
  /** "math-101" */
  slug: string
  /** bolum kodu, "MATH" */
  department: string
  /** "Calculus I" */
  name: string
  credits?: number
  ects?: number
  lectureHours?: number
  labHours?: number
  sections: CourseSection[]
  averageGpa?: number | null
  gpaSampleSize?: number | null
  letterGrade?: string | null
}

export interface DepartmentSummary {
  code: string
  tr: string
  slug: string
  courseCount: number
  sectionCount: number
}
