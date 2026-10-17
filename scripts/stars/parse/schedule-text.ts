/**
 * plainOfferings "Schedule" sutunu -> slot haritasi.
 *   "Tue 13:30-15:20 (EA-Z03)<br> Wed 08:30-12:20 (B-201)"
 * Slot indeksi mevcut sozlesmeyle ayni: index = saatIndeksi * 7 + gunIndeksi,
 * saat 0 = 08:30, gun 0 = Pazartesi. STARS saat satirlari 08:30-22:20 (14 satir).
 */

export const DAY_STRIDE = 7
export const FIRST_MINUTE = 8 * 60 + 30
export const HOUR_ROWS = 14
/** Derslik yoksa (online vb.) eski scraper'la ayni yer tutucu. */
export const NO_ROOM = 'N/A'

const DAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

export interface Meeting {
  day: number
  start: string
  end: string
  room: string | null
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** "Mon 08:30-10:20 (B-201)" satirlari; taninmayan satirlar `unparsed`'a. */
export function parseScheduleText(text: string): { meetings: Meeting[]; unparsed: string[] } {
  const meetings: Meeting[] = []
  const unparsed: string[] = []
  const lines = text
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n')
    .map((line) => line.replace(/ /g, ' ').trim())
    .filter(Boolean)
  for (const line of lines) {
    const match = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})(?:\s*\(([^)]*)\))?$/.exec(line)
    if (!match) {
      unparsed.push(line)
      continue
    }
    const room = match[4]?.trim() || null
    meetings.push({ day: DAY_INDEX[match[1]], start: match[2].padStart(5, '0'), end: match[3].padStart(5, '0'), room })
  }
  return { meetings, unparsed }
}

/** Bir toplantinin kapsadigi saat indeksleri (bitis dahil, "10:20" -> 1). */
export function hourIndexes(start: string, end: string): number[] {
  const first = Math.floor((minutes(start) - FIRST_MINUTE) / 60)
  const last = Math.ceil((minutes(end) - FIRST_MINUTE) / 60) - 1
  const hours: number[] = []
  for (let h = Math.max(0, first); h <= Math.min(HOUR_ROWS - 1, last); h++) hours.push(h)
  return hours
}

/** Toplantilar -> `{ [slot]: derslik }` (derslik yoksa "N/A"). */
export function meetingsToSlots(meetings: Meeting[]): Record<string, string> {
  const slots: Array<[number, string]> = []
  for (const meeting of meetings) {
    for (const hour of hourIndexes(meeting.start, meeting.end)) {
      slots.push([hour * DAY_STRIDE + meeting.day, meeting.room ?? NO_ROOM])
    }
  }
  slots.sort((a, b) => a[0] - b[0])
  const result: Record<string, string> = {}
  for (const [slot, room] of slots) if (!(slot in result)) result[String(slot)] = room
  return result
}

/** Saat metninin kanonik bicimi: degisiklik tespiti (schedule.php onbellegi) icin. */
export function canonicalScheduleText(meetings: Meeting[]): string {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return meetings.map((m) => `${days[m.day]} ${m.start}-${m.end}${m.room ? ` (${m.room})` : ''}`).join('\n')
}
