import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { DEATH_CAUSES, fold, genesisState, type TileId, type WorldState } from '@sj/engine'
import { DEFAULT_CONFIG, MINUTES_PER_DAY, type SimEvent } from '@sj/shared'
import { detectFirsts } from '../firsts.js'
import { CONSTRUCT_VOCABULARY, scanPromptForGlassLeak } from '../glass.js'
import { migrateNarratorTables } from '../schema.js'
import { NarratorStore } from '../store.js'
import { DEATH_CAUSE_LABELS, TIER1_DEFS } from './tier1.js'
import { detectTier2 } from './tier2.js'

let seq = 1
const ev = (tick: number, type: string, payload: unknown = {}): SimEvent => ({ seq: seq++, tick, type, payload })
const day = (n: number): number => n * MINUTES_PER_DAY

const memDb = (): Database.Database => {
  const db = new Database(':memory:')
  migrateNarratorTables(db)
  return db
}

const ctx = (seen: string[] = []): { seenKinds: Set<string>; rulebookCount: number } =>
  ({ seenKinds: new Set(seen), rulebookCount: 0 })

describe('the migration', () => {
  it('runs twice without complaint and backfills every existing row as a tier-1 engine first', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
      event_seq INTEGER NOT NULL, day INTEGER NOT NULL, tick INTEGER NOT NULL)`)
    db.prepare('INSERT INTO milestones (kind, label, event_seq, day, tick) VALUES (?, ?, ?, ?, ?)')
      .run('first_speech', 'the first word spoken', 1, 0, 10)
    migrateNarratorTables(db)
    migrateNarratorTables(db)
    const [row] = new NarratorStore(db).milestones()
    expect(row).toEqual({
      kind: 'first_speech', tier: 1, domain: 'engine', label: 'the first word spoken',
      eventSeq: 1, day: 0, tick: 10, agentIds: [],
    })
  })

  it('round-trips a tier-2 row with the bodies it belongs to', () => {
    const store = new NarratorStore(memDb())
    store.insertMilestone({
      kind: 'first_breakup', tier: 2, domain: 'social', label: 'the first parting',
      eventSeq: 9, day: 4, tick: day(4), agentIds: ['ada', 'bex'],
    })
    expect(store.milestones()[0]).toEqual({
      kind: 'first_breakup', tier: 2, domain: 'social', label: 'the first parting',
      eventSeq: 9, day: 4, tick: day(4), agentIds: ['ada', 'bex'],
    })
  })
})

describe('tier 1 — the engine firsts', () => {
  it('fires each predicate exactly once over a stream that triggers it three times', () => {
    const streams: Record<string, SimEvent[]> = {
      first_speech: [ev(1, 'agent_spoke', { agentId: 'a', text: 'oi', x: 0, y: 0 })],
      first_structure: [ev(1, 'structure_completed', { id: 's1' })],
      first_hut: [ev(0, 'structure_planned', { id: 's1', kind: 'hut' }), ev(1, 'structure_completed', { id: 's1' })],
      first_bridge: [ev(0, 'structure_planned', { id: 's2', kind: 'bridge' }), ev(1, 'structure_completed', { id: 's2' })],
      first_meal: [ev(1, 'action_completed', { agentId: 'a', verb: 'eat' })],
      first_fish: [ev(1, 'action_completed', { agentId: 'a', verb: 'fish' })],
      first_hunt: [ev(1, 'fauna_killed', { id: 'f1', kind: 'deer', x: 1, y: 1, byId: 'a' })],
      first_tool: [ev(1, 'item_spawned', { id: 'i1', kind: 'knife', qty: 1, loc: { t: 'agent', id: 'a' }, durability: 20 })],
      first_expert_craft: [ev(1, 'item_spawned', { id: 'i2', kind: 'chair', qty: 1, loc: { t: 'agent', id: 'a' }, crafterMark: 'a' })],
      first_trade: [ev(1, 'action_completed', { agentId: 'a', verb: 'give' })],
      first_theft: [ev(1, 'item_taken', { itemId: 'i1', kind: 'knife', takerId: 'b', ownerId: 'a', x: 1, y: 1 })],
      first_road: [ev(1, 'tile_changed', { x: 1, y: 1, from: 0, to: 7, reason: 'paved', byId: 'a' })],
      first_channel: [ev(1, 'tile_changed', { x: 1, y: 1, from: 0, to: 2, reason: 'channel', byId: 'a' })],
      first_fire: [ev(1, 'fire_ignited', { structureId: 's1', cause: 'hearth' })],
      first_fire_out: [ev(1, 'fire_extinguished', { structureId: 's1', cause: 'doused', agentId: 'a' })],
      first_inscription: [ev(1, 'structure_inscribed', { structureId: 's1', text: 'ours', agentId: 'a' })],
      first_invention: [ev(1, 'action_completed', { agentId: 'a', verb: 'recipe:basket' })],
      first_expression: [ev(1, 'agent_expressed', { agentId: 'a', verb: 'dance', x: 0, y: 0 })],
      first_injury: [ev(1, 'agent_injured', { agentId: 'a', kind: 'minor' })],
      first_infection: [ev(1, 'agent_afflicted', { agentId: 'a', kind: 'illness', severity: 1 })],
      first_recovery: [ev(1, 'agent_recovered', { agentId: 'a' })],
      first_pregnancy: [ev(1, 'agent_conceived', { motherId: 'a', fatherId: 'b', day: 0 })],
      first_birth: [ev(1, 'agent_born', { id: 'c', name: 'Mira', sex: 'f', motherId: 'a', fatherId: 'b', x: 1, y: 1 })],
      first_grave: [ev(1, 'grave_placed', { id: 'g1', agentId: 'a', name: 'Ada', x: 1, y: 1 })],
      first_harvest: [ev(1, 'crop_harvested', { cropId: 'c1' })],
      first_world_grown: [ev(1, 'world_grown', { edge: 'n', depth: 4, tiles: [[0]] })],
      first_death: [ev(1, 'agent_died', { agentId: 'a', cause: 'hunger' })],
    }
    for (const [kind, stream] of Object.entries(streams)) {
      const thrice = [...stream, ...stream, ...stream]
      const fired = detectFirsts(thrice, ctx()).filter((m) => m.kind === kind)
      expect(fired, kind).toHaveLength(1)
      expect(fired[0]!.tier, kind).toBe(1)
      expect(fired[0]!.domain, kind).toBe('engine')
    }
  })

  it('counts the first sickness however the engine of the day recorded it', () => {
    const old = detectFirsts([ev(1, 'agent_infected', { agentId: 'a' })], ctx())
    expect(old.map((m) => m.kind)).toContain('first_infection')
    // A poisoning is an affliction too, and it is not a sickness.
    const poison = detectFirsts([ev(1, 'agent_afflicted', { agentId: 'a', kind: 'poison', severity: 1 })], ctx())
    expect(poison.map((m) => m.kind)).not.toContain('first_infection')
  })

  it('gives every way of dying its own first, and each fires independently', () => {
    const stream = DEATH_CAUSES.map((cause, i) => ev(i + 1, 'agent_died', { agentId: `a${i}`, cause }))
    const fired = detectFirsts(stream, ctx()).filter((m) => m.kind.startsWith('first_death_'))
    expect(fired.map((m) => m.kind)).toEqual(DEATH_CAUSES.map((c) => `first_death_${c}`))
    for (const m of fired) expect(m.agentIds).toHaveLength(1)
  })

  it('has a sentence for every way of dying the engine can name', () => {
    expect(Object.keys(DEATH_CAUSE_LABELS).sort()).toEqual([...DEATH_CAUSES].sort())
  })

  it('counts the town up to each round number, once', () => {
    const born = Array.from({ length: 12 }, (_, i) => ev(i + 1, 'agent_spawned', { id: `a${i}`, name: `A${i}`, x: 0, y: 0, ageDays: 7300 }))
    const fired = detectFirsts([...born, ...born], ctx()).filter((m) => m.kind.endsWith('_souls'))
    expect(fired.map((m) => m.kind)).toEqual(['first_ten_souls'])
  })

  it('marks the turn of the year and the winter come through, once each', () => {
    const spring = [ev(day(364) + 60, 'agent_spoke', { agentId: 'a', text: 'warm again', x: 0, y: 0 })]
    const kinds = detectFirsts(spring, ctx()).map((m) => m.kind)
    expect(kinds).toContain('first_winter_survived')
    expect(kinds).toContain('first_year')
    expect(detectFirsts([ev(60, 'agent_spoke', { agentId: 'a', text: 'day one', x: 0, y: 0 })], ctx()).map((m) => m.kind))
      .not.toContain('first_year')
  })

  it('says nothing a mind could ever read as a label', () => {
    for (const def of TIER1_DEFS) {
      expect(scanPromptForGlassLeak(def.label), def.label).toEqual([])
      expect(def.label, def.kind).not.toMatch(/\b(hp|severity|affliction|config|tier|roll)\b/i)
      expect(CONSTRUCT_VOCABULARY.some((w) => def.kind.startsWith(w))).toBe(false)
      expect(scanPromptForGlassLeak(def.kind), def.kind).toEqual([def.kind])
    }
  })
})

// A world with two bodies and the pair rows the engine keeps for them.
function pairWorld(rows: Record<string, { nights: number; lastNightDay: number; formedTick: number | null; dissolvedTick: number | null }>): WorldState {
  const flat = Array.from({ length: 32 }, () => Array.from({ length: 32 }, (): TileId => 0))
  let s = genesisState(DEFAULT_CONFIG, flat)
  for (const [id, name] of [['ada', 'Ada'], ['bex', 'Bex']]) {
    s = fold(s, { seq: 0, tick: 0, type: 'agent_spawned', payload: { id, name, x: 4, y: 4, ageDays: 7300 } }, DEFAULT_CONFIG)
  }
  return { ...s, pairNights: rows }
}

describe('tier 2 — the patterns, and the parting that needs more than a gap', () => {
  const t2 = (events: SimEvent[], state?: WorldState) =>
    detectTier2(events, { seenKinds: new Set(), config: DEFAULT_CONFIG, state })

  it('hears the first conversation, and does not mistake two shouts across the valley for one', () => {
    const close = [
      ev(100, 'agent_spoke', { agentId: 'ada', text: 'you came', x: 4, y: 4 }),
      ev(105, 'agent_spoke', { agentId: 'bex', text: 'i did', x: 5, y: 4 }),
    ]
    expect(t2(close).map((m) => m.kind)).toContain('first_conversation')
    const apart = [
      ev(100, 'agent_spoke', { agentId: 'ada', text: 'you came', x: 4, y: 4 }),
      ev(105, 'agent_spoke', { agentId: 'bex', text: 'i did', x: 40, y: 4 }),
    ]
    expect(t2(apart).map((m) => m.kind)).not.toContain('first_conversation')
  })

  it('a long partnership does not break on a gap they talked across', () => {
    const dissolved = day(9)
    const state = pairWorld({ 'ada|bex': { nights: 5, lastNightDay: 4, formedTick: day(3), dissolvedTick: dissolved } })
    const spokeOnDayFive = [
      ...Array.from({ length: 5 }, (_, i) => ev(day(i) + 1, 'co_slept', { aId: 'ada', bId: 'bex', day: i })),
      ev(day(5) + 60, 'agent_spoke', { agentId: 'ada', text: 'still here', x: 4, y: 4 }),
      ev(day(9) + 60, 'agent_spoke', { agentId: 'ada', text: 'and again', x: 4, y: 4 }),
    ]
    expect(t2(spokeOnDayFive, state).map((m) => m.kind)).not.toContain('first_breakup')
  })

  it('a pair who separate and never speak again do part', () => {
    const state = pairWorld({ 'ada|bex': { nights: 5, lastNightDay: 4, formedTick: day(3), dissolvedTick: day(12) } })
    const silence = [
      ...Array.from({ length: 5 }, (_, i) => ev(day(i) + 1, 'co_slept', { aId: 'ada', bId: 'bex', day: i })),
      ev(day(12) + 60, 'agent_moved', { id: 'ada', x: 9, y: 9 }),
    ]
    const found = t2(silence, state).find((m) => m.kind === 'first_breakup')
    expect(found?.agentIds).toEqual(['ada', 'bex'])
    expect(found?.tier).toBe(2)
    expect(found?.domain).toBe('social')
  })

  it('a pair still partnered part from nobody', () => {
    const state = pairWorld({ 'ada|bex': { nights: 5, lastNightDay: 4, formedTick: day(3), dissolvedTick: null } })
    const sixDayGap = [ev(day(6) + 60, 'agent_moved', { id: 'ada', x: 9, y: 9 })]
    expect(t2(sixDayGap, state).map((m) => m.kind)).not.toContain('first_breakup')
  })

  it('finds a grandparent by reading three generations of births', () => {
    const births = [
      ev(day(1), 'agent_born', { id: 'kid', name: 'Kid', sex: 'f', motherId: 'ada', fatherId: 'bex', x: 1, y: 1 }),
      ev(day(2), 'agent_born', { id: 'grandkid', name: 'Gran', sex: 'm', motherId: 'kid', fatherId: 'cass', x: 1, y: 1 }),
    ]
    const found = t2(births).find((m) => m.kind === 'first_grandparent')
    expect(found?.agentIds).toEqual(['ada', 'bex'])
  })

  it('an already-seen kind is never a first twice', () => {
    const births = [ev(day(1), 'agent_born', { id: 'kid', name: 'Kid', sex: 'f', motherId: 'ada', fatherId: 'bex', x: 1, y: 1 })]
    expect(detectTier2(births, { seenKinds: new Set(['first_conversation']), config: DEFAULT_CONFIG })
      .map((m) => m.kind)).not.toContain('first_conversation')
  })
})
