import path from 'node:path'

/** Testlerde STARS_ROOT ile gecici dizine yonlendirilir. */
export function root(): string {
  return process.env.STARS_ROOT ?? process.cwd()
}

export const paths = {
  publicData: () => path.join(root(), 'public', 'scheduler', 'data'),
  offerings: (semester: string) => path.join(root(), 'public', 'scheduler', 'data', 'offerings', `${semester}.json`),
  semesters: () => path.join(root(), 'public', 'scheduler', 'data', 'semesters.json'),
  lastUpdate: () => path.join(root(), 'public', 'scheduler', 'data', 'lastUpdate.json'),
  stars: () => path.join(root(), 'data', 'stars'),
  courses: (dept: string) => path.join(root(), 'data', 'stars', 'courses', `${dept}.json`),
  coursesDir: () => path.join(root(), 'data', 'stars', 'courses'),
  curricula: (dept: string) => path.join(root(), 'data', 'stars', 'curricula', `${dept}.json`),
  syllabi: (semester: string, dept: string) => path.join(root(), 'data', 'stars', 'syllabi', semester, `${dept}.json`),
  scheduleCache: (semester: string) => path.join(root(), 'data', 'stars', 'schedule', `${semester}.json`),
  departments: () => path.join(root(), 'data', 'stars', 'departments.json'),
  instructors: () => path.join(root(), 'data', 'stars', 'instructors.json'),
  prereqGraph: () => path.join(root(), 'data', 'stars', 'prereq-graph.json'),
  state: () => path.join(root(), 'data', 'stars', 'state.json'),
}
