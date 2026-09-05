import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { SimEvent } from '@sj/shared'
import { detectFirsts, populationDelta } from './firsts.js'
import { migrateNarratorTables } from './schema.js'
import { NarratorStore } from './store.js'

const ev = (seq: number, tick: number, type: string, payload: unknown = {}): SimEvent => ({
  seq,
  tick,
  type,
  payload,
})

const ratified = (seq: number, tick: number): SimEvent =>
  ev(seq, tick, 'law_ratified', {
    lawId: 'law_slate',
    agentId: 'nadia',
    text: 'Nobody takes another\u2019s planks.',
    why: '',
    predicate: { kind: 'forbid', verb: 'take' },
    votes: { for: ['nadia'], against: [] },
  })

const speechAndTrade = [
  ev(1, 10, 'agent_spoke', { agentId: 'a', text: 'first', x: 0, y: 0 }),
  ev(2, 11, 'agent_spoke', { agentId: 'b', text: 'second', x: 0, y: 0 }),
  ev(3, 12, 'action_completed', { agentId: 'a', verb: 'give' }),
]

describe('detectFirsts', () => {
  it('emits first_speech and first_trade once each', () => {
    const ms = detectFirsts(speechAndTrade, { seenKinds: new Set(), rulebookCount: 0 })
    expect(ms).toHaveLength(2)
    expect(ms[0]).toEqual({
      kind: 'first_speech',
      tier: 1,
      domain: 'engine',
      label: 'the first word spoken',
      eventSeq: 1,
      day: 0,
      tick: 10,
      agentIds: ['a'],
    })
    expect(ms[1]).toEqual({
      kind: 'first_trade',
      tier: 1,
      domain: 'engine',
      label: 'the first trade',
      eventSeq: 3,
      day: 0,
      tick: 12,
      agentIds: ['a'],
    })
  })

  it('already-seen kinds are suppressed', () => {
    const ms = detectFirsts(speechAndTrade, {
      seenKinds: new Set(['first_speech']),
      rulebookCount: 0,
    })
    expect(ms.map((m) => m.kind)).toEqual(['first_trade'])
  })

  // The town writes its own rules now, so the first one is the council that passed it and the
  // person who put it to the room — not a count of rows in the court's book.
  it('first_law fires on the ratification, naming whoever proposed it', () => {
    const ms = detectFirsts([...speechAndTrade, ratified(4, 20)], {
      seenKinds: new Set(),
      rulebookCount: 0,
    })
    expect(ms.find((m) => m.kind === 'first_law')).toEqual({
      kind: 'first_law',
      tier: 1,
      domain: 'engine',
      label: 'the first law',
      eventSeq: 4,
      day: 0,
      tick: 20,
      agentIds: ['nadia'],
    })
  })

  it('fires once, and never from a rulebook the town never voted on', () => {
    expect(
      detectFirsts([ratified(1, 20), ratified(2, 30)], {
        seenKinds: new Set(),
        rulebookCount: 0,
      }).filter((m) => m.kind === 'first_law'),
    ).toHaveLength(1)
    expect(
      detectFirsts([ratified(1, 20)], { seenKinds: new Set(['first_law']), rulebookCount: 1 }).find(
        (m) => m.kind === 'first_law',
      ),
    ).toBeUndefined()
    expect(
      detectFirsts(speechAndTrade, { seenKinds: new Set(), rulebookCount: 9 }).find(
        (m) => m.kind === 'first_law',
      ),
    ).toBeUndefined()
  })

  it('non-give action_completed is not a trade — it is whatever it actually was', () => {
    const ms = detectFirsts([ev(1, 5, 'action_completed', { agentId: 'a', verb: 'fish' })], {
      seenKinds: new Set(),
      rulebookCount: 0,
    })
    expect(ms.map((m) => m.kind)).toEqual(['first_fish'])
  })

  it('persists via NarratorStore: kinds round-trip, duplicate kind throws', () => {
    const db = new Database(':memory:')
    migrateNarratorTables(db)
    const store = new NarratorStore(db)
    const ms = detectFirsts(speechAndTrade, { seenKinds: store.milestoneKinds(), rulebookCount: 0 })
    for (const m of ms) store.insertMilestone(m)
    expect(store.milestoneKinds()).toEqual(new Set(['first_speech', 'first_trade']))
    expect(() => {
      store.insertMilestone(ms[0]!)
    }).toThrow()
    // a re-run gated by seenKinds emits nothing new
    expect(
      detectFirsts(speechAndTrade, { seenKinds: store.milestoneKinds(), rulebookCount: 0 }),
    ).toEqual([])
  })
})

// Payload shapes from the arrivals design §2; the engine's own lane lands the zod schemas.
describe('the valley road counts both ways', () => {
  const arrived = ev(1, 600, 'agent_arrived', {
    id: 'mira',
    name: 'Mira',
    sex: 'f',
    ageDays: 11_315,
    x: 65,
    y: 127,
  })
  const departed = ev(2, 700, 'agent_departed', { agentId: 'reza' })

  it('adds the person the road brought and takes away the one it took', () => {
    expect(populationDelta(arrived)).toBe(1)
    expect(populationDelta(departed)).toBe(-1)
  })

  it('fires the first coming and the first going once each, naming the body', () => {
    const firsts = detectFirsts([arrived, arrived, departed, departed], { seenKinds: [] })
    expect(firsts.filter((m) => m.kind === 'first_arrival')).toHaveLength(1)
    expect(firsts.filter((m) => m.kind === 'first_leaving')).toHaveLength(1)
    expect(firsts.find((m) => m.kind === 'first_arrival')?.agentIds).toEqual(['mira'])
    expect(firsts.find((m) => m.kind === 'first_leaving')?.agentIds).toEqual(['reza'])
  })

  it('and neither label names a number or a machine', () => {
    for (const m of detectFirsts([arrived, departed], { seenKinds: [] })) {
      expect(m.label).not.toMatch(/\d/)
      expect(m.label).not.toMatch(/\b(agent|id|event|model)\b/i)
    }
  })
})
