import { expect, it } from 'vitest'
import type { ChronicleEntry } from '@sj/shared'
import { sinceVisit } from './catchup.js'
const entries = [
  { seq: 11, tick: 20, type: 'agent_spoke', label: 'A stated intention' },
  { seq: 12, tick: 20, type: 'structure_completed', label: 'A completed house' },
] as ChronicleEntry[]
it('uses event sequence to distinguish changes within the same minute', () => {
  expect(sinceVisit(entries, { runId: 'town-a', seq: 11, tick: 20 }, 12, 'town-a')).toEqual([
    entries[1],
  ])
})
it('distinguishes a first visit, an empty return and a fresh town', () => {
  expect(sinceVisit(entries, { runId: 'town-a', seq: null, tick: null }, 12, 'town-a')).toBeNull()
  expect(sinceVisit(entries, { runId: 'town-a', seq: 12, tick: 20 }, 12, 'town-a')).toEqual([])
  expect(sinceVisit(entries, { runId: 'town-a', seq: 100, tick: 500 }, 12, 'town-a')).toBeNull()
})
it('does not claim the retained list includes every change during a long absence', () => {
  expect(sinceVisit(entries, { runId: 'town-a', seq: 1, tick: 0 }, 12, 'town-a')).toEqual(entries)
})

it('rejects a different run even after its event sequence has passed the old cursor', () => {
  expect(sinceVisit(entries, { runId: 'old-town', seq: 11, tick: 20 }, 200, 'town-a')).toBeNull()
  expect(sinceVisit(entries, { runId: null, seq: 11, tick: 20 }, 200, 'town-a')).toBeNull()
  expect(sinceVisit(entries, { runId: 'town-a', seq: 11, tick: 20 }, 200, null)).toBeNull()
})
