import { describe, it, expect } from 'vitest'
import { SimConfigSchema, stateHash, type SimConfig, type SimEvent } from '@sj/shared'
import { fold } from '../fold.js'
import { composePerception } from '../perception.js'
import { RngStreams } from '../rng.js'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { createWorldTick } from '../worldTick.js'

const CFG: SimConfig = SimConfigSchema.parse({ weather: { hourlyChangeChance: 0 }, mystery: { chancePerDay: 0 } })
const OFF: SimConfig = SimConfigSchema.parse({
  weather: { hourlyChangeChance: 0 }, mystery: { chancePerDay: 0 }, mortality: { enabled: false },
})

let seq = 80000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })
const map = (): TileId[][] => Array.from({ length: 16 }, () => Array.from({ length: 16 }, (): TileId => 0))

function body(config = CFG): WorldState {
  return fold(genesisState(config, map()), ev('agent_spawned', { id: 'a1', name: 'a1', x: 2, y: 2, ageDays: 7300 }), config)
}
const afflict = (s: WorldState, kind: string, severity: number, tick = 0, extra: Record<string, unknown> = {}) =>
  fold(s, ev('agent_afflicted', { agentId: 'a1', kind, severity, ...extra }, tick), CFG)

function tickOnce(s: WorldState, config = CFG) {
  const advanced = fold({ ...s, tick: s.tick }, ev('tick_advanced', {}, s.tick + 1), config)
  return createWorldTick(config, new RngStreams('m'))(advanced)
}
const hpDeltas = (r: { events: Array<{ type: string; payload: unknown }> }) =>
  r.events.filter((e) => e.type === 'hp_changed').map((e) => (e.payload as { delta: number }).delta)

describe('fold: the afflicted body', () => {
  it('is absent until the first affliction, and absent again after the last one lifts', () => {
    const clean = body()
    expect(clean.agents.a1!.afflictions).toBeUndefined()
    const ill = afflict(clean, 'illness', 2, 40)
    expect(ill.agents.a1!.afflictions).toEqual([{ kind: 'illness', severity: 2, sinceTick: 40 }])
    const well = fold(ill, ev('affliction_recovered', { agentId: 'a1', kind: 'illness' }, 90), CFG)
    expect(well.agents.a1!.afflictions).toBeUndefined()
    expect(Object.keys(well.agents.a1!)).not.toContain('afflictions')
    expect(stateHash(well)).toBe(stateHash(clean))
  })

  it('merges a second affliction of the same kind, summing severity and keeping the earlier onset', () => {
    let s = afflict(body(), 'poison', 1, 30)
    s = afflict(s, 'poison', 2, 900)
    expect(s.agents.a1!.afflictions).toEqual([{ kind: 'poison', severity: 3, sinceTick: 30 }])
  })

  it('keeps the list in a canonical order, so two bodies with the same afflictions hash alike', () => {
    const a = afflict(afflict(body(), 'poison', 1, 10), 'illness', 1, 10)
    const b = afflict(afflict(body(), 'illness', 1, 10), 'poison', 1, 10)
    expect(a.agents.a1!.afflictions!.map((x) => x.kind)).toEqual(['illness', 'poison'])
    expect(stateHash(a)).toBe(stateHash(b))
  })

  it('worsens and recovers by kind, leaving the others alone', () => {
    let s = afflict(afflict(body(), 'illness', 2, 10), 'injury', 1, 10)
    s = fold(s, ev('affliction_worsened', { agentId: 'a1', kind: 'illness', severity: 4 }), CFG)
    expect(s.agents.a1!.afflictions).toEqual([
      { kind: 'illness', severity: 4, sinceTick: 10 }, { kind: 'injury', severity: 1, sinceTick: 10 },
    ])
    s = fold(s, ev('affliction_recovered', { agentId: 'a1', kind: 'illness' }), CFG)
    expect(s.agents.a1!.afflictions).toEqual([{ kind: 'injury', severity: 1, sinceTick: 10 }])
  })

  it('refuses to worsen or lift something the body does not have, or to name a kind that is not one', () => {
    const s = body()
    expect(() => fold(s, ev('affliction_worsened', { agentId: 'a1', kind: 'illness', severity: 2 }), CFG))
      .toThrow(/no illness/)
    expect(() => fold(s, ev('affliction_recovered', { agentId: 'a1', kind: 'poison' }), CFG)).toThrow(/no poison/)
    expect(() => fold(s, ev('agent_afflicted', { agentId: 'a1', kind: 'sadness', severity: 1 }), CFG)).toThrow()
    expect(() => fold(s, ev('agent_afflicted', { agentId: 'ghost', kind: 'illness', severity: 1 }), CFG))
      .toThrow(/unknown agent/i)
  })

  it('agent_harmed takes the hp it names and never takes a body below zero', () => {
    let s = fold(body(), ev('agent_harmed', { agentId: 'a1', amount: 30, source: 'attack', byId: 'a2' }), CFG)
    expect(s.agents.a1!.hp).toBe(70)
    s = fold(s, ev('agent_harmed', { agentId: 'a1', amount: 500, source: 'fire' }), CFG)
    expect(s.agents.a1!.hp).toBe(0)
    expect(() => fold(s, ev('agent_harmed', { agentId: 'a1', amount: 1, source: 'meteor' }), CFG)).toThrow()
  })

  it('records who and what the affliction came from without letting it into the body', () => {
    const s = afflict(body(), 'poison', 1, 5, { sourceId: 'a2', itemId: 'item_9' })
    expect(s.agents.a1!.afflictions).toEqual([{ kind: 'poison', severity: 1, sinceTick: 5 }])
  })
})

describe('mortalitySystem: the drain is arithmetic, never a roll', () => {
  it('drains drainPerTick x severity, to the digit', () => {
    const r = tickOnce(afflict(body(), 'illness', 2, 0))
    expect(hpDeltas(r)).toEqual([-0.16])
  })

  it('sums every affliction into one hp_changed', () => {
    const s = afflict(afflict(body(), 'illness', 2, 0), 'poison', 1, 0)
    expect(hpDeltas(tickOnce(s))).toEqual([-(0.08 * 2 + 0.12)])
  })

  it('adds the hunger drain when the belly is empty, and not before', () => {
    const fed = fold(body(), ev('need_changed', { id: 'a1', need: 'hunger', delta: -99 }), CFG)
    expect(hpDeltas(tickOnce(fed))).toEqual([])
    const starving = fold(body(), ev('need_changed', { id: 'a1', need: 'hunger', delta: -100 }), CFG)
    expect(hpDeltas(tickOnce(starving))).toEqual([-0.1])
  })

  it('says nothing about a body with nothing wrong with it', () => {
    expect(hpDeltas(tickOnce(body()))).toEqual([])
  })

  it('leaves the dead alone and obeys its flag', () => {
    let dead = afflict(body(), 'illness', 2, 0)
    dead = fold(dead, ev('agent_died', { agentId: 'a1', cause: 'health' }), CFG)
    expect(hpDeltas(tickOnce(dead))).toEqual([])
    expect(hpDeltas(tickOnce(afflict(body(OFF), 'illness', 2, 0), OFF))).toEqual([])
  })

  it('spends no randomness at all: the same tick on two seeds is the same tick', () => {
    const s = afflict(body(), 'fatigue', 3, 0)
    const rngA = new RngStreams('one'), rngB = new RngStreams('two')
    const a = createWorldTick(CFG, rngA)(fold(s, ev('tick_advanced', {}, 1), CFG))
    const b = createWorldTick(CFG, rngB)(fold(s, ev('tick_advanced', {}, 1), CFG))
    expect(hpDeltas(a)).toEqual([-0.12])
    expect(hpDeltas(a)).toEqual(hpDeltas(b))
  })

  it('folding the tick\'s own events reproduces the state it returned', () => {
    const s = afflict(afflict(body(), 'illness', 1, 0), 'injury', 2, 0)
    const advanced = fold(s, ev('tick_advanced', {}, 1), CFG)
    const out = createWorldTick(CFG, new RngStreams('m'))(advanced)
    let replayed = advanced
    for (const e of out.events) replayed = fold(replayed, ev(e.type, e.payload, 1), CFG)
    expect(stateHash(replayed)).toBe(stateHash(out.state))
  })
})

describe('perception: a body knows what ails it, not when it started', () => {
  it('carries kind and severity, and no tick', () => {
    const s = afflict(afflict(body(), 'poison', 1, 33), 'illness', 2, 33)
    const p = composePerception(s, CFG, 'a1', [])
    expect(p.self.body.afflictions).toEqual([{ kind: 'illness', severity: 2 }, { kind: 'poison', severity: 1 }])
    for (const a of p.self.body.afflictions) expect(Object.keys(a)).not.toContain('sinceTick')
  })

  it('is an empty list on a body with nothing wrong with it', () => {
    expect(composePerception(body(), CFG, 'a1', []).self.body.afflictions).toEqual([])
  })
})
