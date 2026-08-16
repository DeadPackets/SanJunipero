import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { SimEvent } from '@sj/shared'
import { detectFirsts } from './firsts.js'
import { migrateNarratorTables } from './schema.js'
import { NarratorStore } from './store.js'

const ev = (seq: number, tick: number, type: string, payload: unknown = {}): SimEvent => ({ seq, tick, type, payload })

const speechAndTrade = [
  ev(1, 10, 'agent_spoke', { agentId: 'a', text: 'first', x: 0, y: 0 }),
  ev(2, 11, 'agent_spoke', { agentId: 'b', text: 'second', x: 0, y: 0 }),
  ev(3, 12, 'action_completed', { agentId: 'a', verb: 'give' }),
]

describe('detectFirsts', () => {
  it('emits first_speech and first_trade once each', () => {
    const ms = detectFirsts(speechAndTrade, { seenKinds: new Set(), rulebookCount: 0 })
    expect(ms).toHaveLength(2)
    expect(ms[0]).toEqual({ kind: 'first_speech', label: 'the first word spoken', eventSeq: 1, day: 0, tick: 10 })
    expect(ms[1]).toEqual({ kind: 'first_trade', label: 'the first trade', eventSeq: 3, day: 0, tick: 12 })
  })

  it('already-seen kinds are suppressed', () => {
    const ms = detectFirsts(speechAndTrade, { seenKinds: new Set(['first_speech']), rulebookCount: 0 })
    expect(ms.map((m) => m.kind)).toEqual(['first_trade'])
  })

  it('first_law fires from rulebookCount, citing the first event of the day', () => {
    const ms = detectFirsts(speechAndTrade, { seenKinds: new Set(), rulebookCount: 1 })
    const law = ms.find((m) => m.kind === 'first_law')
    expect(law).toEqual({ kind: 'first_law', label: 'the first law', eventSeq: 1, day: 0, tick: 10 })
  })

  it('first_law already seen emits nothing', () => {
    const ms = detectFirsts(speechAndTrade, { seenKinds: new Set(['first_law']), rulebookCount: 1 })
    expect(ms.find((m) => m.kind === 'first_law')).toBeUndefined()
  })

  it('non-give action_completed is not a trade', () => {
    const ms = detectFirsts([ev(1, 5, 'action_completed', { agentId: 'a', verb: 'fish' })], { seenKinds: new Set(), rulebookCount: 0 })
    expect(ms).toEqual([])
  })

  it('persists via NarratorStore: kinds round-trip, duplicate kind throws', () => {
    const db = new Database(':memory:')
    migrateNarratorTables(db)
    const store = new NarratorStore(db)
    const ms = detectFirsts(speechAndTrade, { seenKinds: store.milestoneKinds(), rulebookCount: 0 })
    for (const m of ms) store.insertMilestone(m)
    expect(store.milestoneKinds()).toEqual(new Set(['first_speech', 'first_trade']))
    expect(() => store.insertMilestone(ms[0])).toThrow()
    // a re-run gated by seenKinds emits nothing new
    expect(detectFirsts(speechAndTrade, { seenKinds: store.milestoneKinds(), rulebookCount: 0 })).toEqual([])
  })
})
