import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseOfferings } from '../../scripts/stars/parse/offerings'
import { meetingsToSlots } from '../../scripts/stars/parse/schedule-text'
import type { RawOfferings } from '../../lib/offerings/types'
import { offeringsV1, snapshot20261 } from './helpers'

/**
 * Uyum testi : plainOfferings saat metninden uretilen slot
 * kumeleri, eski scraper'in schedule.php'den urettigi 20261 haritalariyla
 * (commit cba4890, donmus kopya) birebir olmali. Esik: saatli subelerin >= %99'u.
 */
test('schedule text parser matches the v1 20261 slot sets (>= 99%)', () => {
  const v1: Record<string, number[]> = {}
  for (const dept of Object.values(JSON.parse(offeringsV1()) as RawOfferings))
    for (const [code, course] of Object.entries(dept))
      for (const [no, section] of Object.entries(course.sections))
        v1[`${code}-${no}`] = Object.keys(section.schedule ?? {}).map(Number).sort((a, b) => a - b)
  let scheduled = 0
  let exact = 0
  const diffs: string[] = []
  const seen = new Set<string>()
  for (const html of Object.values(snapshot20261())) {
    for (const row of parseOfferings(html)) {
      const key = `${row.course}-${row.section}`
      seen.add(key)
      const old = v1[key]
      if (!old || old.length === 0) continue
      scheduled++
      const fresh = Object.keys(meetingsToSlots(row.meetings)).map(Number)
      if (fresh.join(',') === old.join(',')) exact++
      else diffs.push(`${key}: v1=[${old}] v2=[${fresh}]`)
    }
  }
  assert.equal(scheduled, 1614)
  assert.ok(exact / scheduled >= 0.99, `${exact}/${scheduled}\n${diffs.slice(0, 20).join('\n')}`)
  assert.equal(diffs.length, 0, diffs.join('\n'))
  assert.equal(seen.size, Object.keys(v1).length, 'ayni sube kumesi')
})
