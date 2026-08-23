import { describe, it, expect } from 'vitest'
import { SimConfigSchema, type SimConfig, type SimEvent } from '@sj/shared'
import { fold } from '../fold.js'
import { RngStreams } from '../rng.js'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { createScriptedLoop } from '../scripted.js'
import { openDb } from '../db.js'
import { EventStore } from '../eventStore.js'
import { createWorldTick, type WorldTickResult } from '../worldTick.js'

const MIDNIGHT = 1440
const quiet = { weather: { hourlyChangeChance: 0 }, mystery: { chancePerDay: 0 }, aging: { deathOfOldAgeEnabled: false } }
const cfg = (illness: Record<string, unknown>): SimConfig => SimConfigSchema.parse({ ...quiet, illness })
// Dials at 0 or 1 make the roll a decision, not a seed hunt: the test says what the world does.
const WORSENS = cfg({ dailyWorsenChance: 1, contagionEnabled: false })
const TURNS = cfg({ dailyWorsenChance: 0, contagionEnabled: false })
const SPREADS = cfg({ dailyWorsenChance: 0, contagionChance: 1 })
const NO_SPREAD = cfg({ dailyWorsenChance: 0, contagionChance: 1, contagionEnabled: false })
const OFF = cfg({ enabled: false, dailyWorsenChance: 1, contagionChance: 1 })

let seq = 91000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })
const map = (): TileId[][] => Array.from({ length: 16 }, () => Array.from({ length: 16 }, (): TileId => 0))

function town(config: SimConfig, at: Array<[string, number, number]>): WorldState {
  let s = genesisState(config, map())
  for (const [id, x, y] of at) {
    s = fold(s, ev('agent_spawned', { id, name: id, x, y, ageDays: 7300 }), config)
  }
  return s
}
const afflict = (s: WorldState, config: SimConfig, id: string, severity: number, tick = 0) =>
  fold(s, ev('agent_afflicted', { agentId: id, kind: 'illness', severity }, tick), config)

function midnight(s: WorldState, config: SimConfig, seed = 'ill'): WorldTickResult {
  const advanced = fold({ ...s, tick: MIDNIGHT - 1 }, ev('tick_advanced', {}, MIDNIGHT), config)
  return createWorldTick(config, new RngStreams(seed))(advanced)
}
const of = (r: WorldTickResult, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload)
const illnessOf = (s: WorldState, id: string) => s.agents[id]!.afflictions?.find((x) => x.kind === 'illness')

describe('illnessSystem: the fever turns at midnight', () => {
  it('worsens by exactly one step when the roll goes against the body', () => {
    const r = midnight(afflict(town(WORSENS, [['a1', 2, 2]]), WORSENS, 'a1', 2), WORSENS)
    expect(of(r, 'affliction_worsened')).toEqual([{ agentId: 'a1', kind: 'illness', severity: 3 }])
    expect(illnessOf(r.state, 'a1')!.severity).toBe(3)
  })

  it('steps down when the roll goes the body\'s way, and lifts at the last step', () => {
    const three = midnight(afflict(town(TURNS, [['a1', 2, 2]]), TURNS, 'a1', 3), TURNS)
    expect(of(three, 'affliction_worsened')).toEqual([{ agentId: 'a1', kind: 'illness', severity: 2 }])
    const one = midnight(afflict(town(TURNS, [['a1', 2, 2]]), TURNS, 'a1', 1), TURNS)
    expect(of(one, 'affliction_recovered')).toEqual([{ agentId: 'a1', kind: 'illness' }])
    expect(one.state.agents.a1!.afflictions).toBeUndefined()
  })

  it('turns only at midnight, and only for a body that has the fever', () => {
    const s = afflict(town(WORSENS, [['a1', 2, 2], ['a2', 9, 9]]), WORSENS, 'a1', 1)
    const noon = createWorldTick(WORSENS, new RngStreams('ill'))(fold({ ...s, tick: 719 }, ev('tick_advanced', {}, 720), WORSENS))
    expect(noon.events.map((e) => e.type)).not.toContain('affliction_worsened')
    const r = midnight(s, WORSENS)
    expect(of(r, 'affliction_worsened')).toEqual([{ agentId: 'a1', kind: 'illness', severity: 2 }])
  })

  it('says nothing at all when the world has the system switched off', () => {
    const s = afflict(afflict(town(OFF, [['a1', 2, 2], ['a2', 2, 3]]), OFF, 'a1', 2), OFF, 'a2', 1)
    const types = midnight(s, OFF).events.map((e) => e.type)
    expect(types).not.toContain('affliction_worsened')
    expect(types).not.toContain('affliction_recovered')
    expect(types).not.toContain('agent_afflicted')
  })
})

describe('illnessSystem: contagion, once a night, on the illness stream', () => {
  it('crosses a shared roof to every co-occupant and stops at the walls', () => {
    let s = town(SPREADS, [['a1', 2, 2], ['a2', 2, 3], ['a3', 3, 2], ['a4', 4, 4]])
    s = fold(s, ev('structure_planned', {
      id: 'structure_1', kind: 'house', x: 2, y: 2, w: 2, h: 2, maxHp: 50, flammable: true, builderId: 'a1',
    }), SPREADS)
    s = fold(s, ev('structure_completed', { id: 'structure_1' }), SPREADS)
    for (const id of ['a1', 'a2', 'a3']) s = fold(s, ev('agent_entered', { agentId: id, structureId: 'structure_1' }), SPREADS)
    s = afflict(s, SPREADS, 'a1', 2)
    const r = midnight(s, SPREADS)
    // a4 stands two tiles from the sick body — well inside radius 3, and outside the walls.
    expect(of(r, 'agent_afflicted')).toEqual([
      { agentId: 'a2', kind: 'illness', severity: 1, sourceId: 'a1' },
      { agentId: 'a3', kind: 'illness', severity: 1, sourceId: 'a1' },
    ])
    expect(r.state.agents.a4!.afflictions).toBeUndefined()
  })

  it('outdoors it reaches exactly contagionRadius and not one tile further', () => {
    const radius = SPREADS.illness.contagionRadius
    const s = afflict(town(SPREADS, [['a1', 6, 6], ['a2', 6 + radius, 6], ['a3', 6 + radius + 1, 6]]), SPREADS, 'a1', 2)
    expect(of(midnight(s, SPREADS), 'agent_afflicted'))
      .toEqual([{ agentId: 'a2', kind: 'illness', severity: 1, sourceId: 'a1' }])
  })

  it('spreads to nobody when contagion is switched off, and never to the already ill', () => {
    const s = afflict(town(NO_SPREAD, [['a1', 2, 2], ['a2', 2, 3]]), NO_SPREAD, 'a1', 2)
    expect(of(midnight(s, NO_SPREAD), 'agent_afflicted')).toEqual([])
    const both = afflict(afflict(town(SPREADS, [['a1', 2, 2], ['a2', 2, 3]]), SPREADS, 'a1', 2), SPREADS, 'a2', 2)
    expect(of(midnight(both, SPREADS), 'agent_afflicted')).toEqual([])
  })

  it('leaves the dead out of it, as carrier and as host', () => {
    let s = afflict(town(SPREADS, [['a1', 2, 2], ['a2', 2, 3]]), SPREADS, 'a1', 2)
    s = fold(s, ev('agent_died', { agentId: 'a2', cause: 'hunger' }), SPREADS)
    expect(of(midnight(s, SPREADS), 'agent_afflicted')).toEqual([])
  })

  it('folding the midnight events reproduces the state the tick returned', () => {
    const s = afflict(town(SPREADS, [['a1', 2, 2], ['a2', 2, 3], ['a3', 3, 3]]), SPREADS, 'a1', 2)
    const advanced = fold({ ...s, tick: MIDNIGHT - 1 }, ev('tick_advanced', {}, MIDNIGHT), SPREADS)
    const out = createWorldTick(SPREADS, new RngStreams('ill'))(advanced)
    let replayed = advanced
    for (const e of out.events) replayed = fold(replayed, ev(e.type, e.payload, MIDNIGHT), SPREADS)
    expect(replayed).toEqual(out.state)
  })
})

// Task 37, batch-2 ruling 1: the wound's own way into the fever. C9 set a boolean nothing
// could lift; the same roll now mints the affliction the midnight turn above can worsen or lift.
describe('illnessSystem: a wound turns septic at dawn', () => {
  const DAWN = 360
  const wound = (config: SimConfig, tick = 0): WorldState =>
    fold(town(config, [['a1', 2, 2]]), ev('agent_injured', { agentId: 'a1', kind: 'minor' }, tick), config)

  function dawn(s: WorldState, config: SimConfig, seed: string, day = 0): WorldTickResult {
    const at = day * MIDNIGHT + DAWN
    const advanced = fold({ ...s, tick: at - 1 }, ev('tick_advanced', {}, at), config)
    return createWorldTick(config, new RngStreams(seed))(advanced)
  }

  it('mints an illness affliction on the seed that infects, and nothing on the seed that does not', () => {
    const r = dawn(wound(TURNS), TURNS, 'h3')
    expect(of(r, 'agent_afflicted')).toEqual([{ agentId: 'a1', kind: 'illness', severity: 1 }])
    expect(illnessOf(r.state, 'a1')!.severity).toBe(1)
    expect(r.events.map((e) => e.type)).not.toContain('agent_infected')

    const clean = dawn(wound(TURNS), TURNS, 'h1')
    expect(of(clean, 'agent_afflicted')).toEqual([])
    expect(clean.state.agents.a1!.afflictions).toBeUndefined()
  })

  it('rolls only at dawn, only while the wound is open, and never twice onto the same fever', () => {
    const noon = createWorldTick(TURNS, new RngStreams('h3'))(
      fold({ ...wound(TURNS), tick: 719 }, ev('tick_advanced', {}, 720), TURNS))
    expect(noon.events.map((e) => e.type)).not.toContain('agent_afflicted')

    // Day 0's wound has healed by day 3's dawn, so there is nothing left to roll for.
    expect(of(dawn(wound(TURNS), TURNS, 'h3', 3), 'agent_afflicted')).toEqual([])
    expect(of(dawn(afflict(wound(TURNS), TURNS, 'a1', 2), TURNS, 'h3'), 'agent_afflicted')).toEqual([])
  })

  it('mints nothing when the system is off — an affliction no midnight can lift is a life sentence', () => {
    const r = dawn(wound(OFF), OFF, 'h3')
    expect(r.events.map((e) => e.type)).not.toContain('agent_afflicted')
    expect(r.state.agents.a1!.afflictions).toBeUndefined()
  })
})

describe('C9 per-tick contagion is retired', () => {
  it('no agent_fell_ill is emitted anywhere in three scripted days', () => {
    const store = new EventStore(openDb(':memory:'))
    // Illness and contagion stay at their genesis dials; only the scenery is held still.
    const loop = createScriptedLoop(SimConfigSchema.parse(quiet), 'illness-retired', store)
    for (let i = 0; i < 3 * MIDNIGHT; i++) loop.step()
    const types = new Set(store.readFrom(0).map((e) => e.type))
    expect(types.size).toBeGreaterThan(5)
    expect(types.has('agent_fell_ill')).toBe(false)
  })
})
