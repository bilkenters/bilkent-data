import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parsePrerequisite, prereqEdges } from '../../scripts/stars/parse/prereq'
import { findCycles } from '../../scripts/stars/tiers/prereq-graph'

const tree = (input: string) => parsePrerequisite(input).tree

test('CS 202 -> and[CS 201, or[MATH 132, MATH 210]]', () => {
  assert.deepEqual(tree('CS 201 and (MATH 132 or MATH 210)'), {
    and: [{ course: 'CS 201' }, { or: [{ course: 'MATH 132' }, { course: 'MATH 210' }] }],
  })
  assert.equal(parsePrerequisite('CS 201 and (MATH 132 or MATH 210)').complete, true)
})

test('upper-case operators, nested groups, extra spaces', () => {
  assert.deepEqual(tree('(CTIS 221 OR CTIS 251) AND CTIS 310'), {
    and: [{ or: [{ course: 'CTIS 221' }, { course: 'CTIS 251' }] }, { course: 'CTIS 310' }],
  })
  assert.deepEqual(tree('(MATH 220 or MATH 223) and ( MATH 132 or MATH 210)'), {
    and: [{ or: [{ course: 'MATH 220' }, { course: 'MATH 223' }] }, { or: [{ course: 'MATH 132' }, { course: 'MATH 210' }] }],
  })
})

test('and binds tighter than or', () => {
  assert.deepEqual(tree('CS 101 and CS 102 or CS 114'), {
    or: [{ and: [{ course: 'CS 101' }, { course: 'CS 102' }] }, { course: 'CS 114' }],
  })
})

test('commas follow the explicit connector at the same level, else and', () => {
  assert.deepEqual(tree('MATH 101, MATH 102 or MATH 103'), { or: [{ course: 'MATH 101' }, { course: 'MATH 102' }, { course: 'MATH 103' }] })
  assert.deepEqual(tree('MATH 101, PHYS 101'), { and: [{ course: 'MATH 101' }, { course: 'PHYS 101' }] })
})

test('free text becomes { text } and marks the parse incomplete', () => {
  const r = parsePrerequisite('CS 201 or consent of the instructor')
  assert.deepEqual(r.tree, { or: [{ course: 'CS 201' }, { text: 'consent of the instructor' }] })
  assert.equal(r.complete, false)
  assert.deepEqual(r.texts, ['consent of the instructor'])
  assert.deepEqual(tree('Junior standing'), { text: 'Junior standing' })
})

test('none / empty -> null; "Pre:" prefix stripped; codes without space normalised', () => {
  assert.equal(tree('none'), null)
  assert.equal(tree(''), null)
  assert.deepEqual(tree('Pre: ELS 101 or ENG 101'), { or: [{ course: 'ELS 101' }, { course: 'ENG 101' }] })
  assert.deepEqual(tree('CS201 and MATH101'), { and: [{ course: 'CS 201' }, { course: 'MATH 101' }] })
})

test('unbalanced parentheses are repaired but flagged', () => {
  const extra = parsePrerequisite('(CS 202 or CS 211) and CS 224)')
  assert.deepEqual(extra.tree, { and: [{ or: [{ course: 'CS 202' }, { course: 'CS 211' }] }, { course: 'CS 224' }] })
  assert.equal(extra.complete, false)
  const missing = parsePrerequisite('ECON 102 and (ECON 204 or MAN 211')
  assert.deepEqual(missing.tree, { and: [{ course: 'ECON 102' }, { or: [{ course: 'ECON 204' }, { course: 'MAN 211' }] }] })
})

test('edges carry the direct parent group', () => {
  assert.deepEqual(prereqEdges(tree('CS 201 and (MATH 132 or MATH 210)')), [
    ['CS 201', 'and'],
    ['MATH 132', 'or'],
    ['MATH 210', 'or'],
  ])
})

test('cycle detection', () => {
  assert.deepEqual(findCycles([['A 101', 'B 101', 'and'], ['B 101', 'A 101', 'and'], ['C 101', 'A 101', 'or']]), [['A 101', 'B 101']])
  assert.deepEqual(findCycles([['A 101', 'B 101', 'and']]), [])
})
