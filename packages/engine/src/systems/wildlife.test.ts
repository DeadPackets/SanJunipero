import { describe, it, expect } from 'vitest'
import { SimConfigSchema, type SimConfig, type SimEvent } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { fold } from '../fold.js'
import { submitIntent } from '../intent.js'
import { FOOD_KINDS, VERBS } from '../verbs.js'
import { RngStreams } from '../rng.js'
import { createWorldTick, type WorldTickResult } from '../worldTick.js'

const CFG: SimConfig = SimConfigSchema.parse({})
const DAWN = 360 // hour 6, minute 0
const WINTER = 273 * 1440 // first winter day
const CHAR_TILE: Record<string, TileId> = { '.': 0, '~': 2, 'f': 3 }

let seq = 11000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })

function makeWorld(rows: string[] = ['.~', '..'], config = CFG): WorldState {
  const s = genesisState(config, rows.map((row) => [...row].map((c) => CHAR_TILE[c]!)))
  return fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }), config)
}
function atTick(s: WorldState, tick: number): WorldState {
  return { ...s, tick }
}
function withWildlife(s: WorldState, wildlife: WorldState['wildlife']): WorldState {
  return { ...s, wildlife }
}
function applyAll(s: WorldState, events: Array<{ type: string; payload: unknown }>, config = CFG, tick = s.tick): WorldState {
  for (const e of events) s = fold(s, ev(e.type, e.payload, tick), config)
  return s
}
function tickOnce(s: WorldState, config = CFG, rng = new RngStreams('t')): WorldTickResult {
  const wt = createWorldTick(config, rng)
  return wt(fold(s, ev('tick_advanced', {}, s.tick + 1), config))
}
// seed 'w1' first wildlife roll ≈ 0.1445 (< fishCatchBase 0.4); 'w2' ≈ 0.9644 (miss)
function castLine(s: WorldState, seed: string, config = CFG): WorldTickResult {
  const r = submitIntent(s, config, 'a1', 'fish', { x: 1, y: 0 })
  if (!r.ok) throw new Error(r.reason)
  return tickOnce(applyAll(s, r.events, config), config, new RngStreams(seed))
}

describe('fold: wildlife_changed', () => {
  it('updates only the counts present in the payload', () => {
    let s = makeWorld()
    s = fold(s, ev('wildlife_changed', { fish: 42 }), CFG)
    expect(s.wildlife).toEqual({ fish: 42, deer: 20 })
    s = fold(s, ev('wildlife_changed', { deer: 7 }), CFG)
    expect(s.wildlife).toEqual({ fish: 42, deer: 7 })
  })
})

describe('verb: fish', () => {
  it('is registered with the fishing skill and food kinds cover the catch', () => {
    expect(VERBS.fish!.kind).toBe('fish')
    expect(VERBS.fish!.skill).toEqual({ track: 'fishing', xp: 1 })
    expect(FOOD_KINDS.has('fish')).toBe(true)
    expect(FOOD_KINDS.has('berries')).toBe(true)
    expect(FOOD_KINDS.has('wheat')).toBe(true)
  })

  it('requires an adjacent water tile', () => {
    const s = makeWorld(['.~.~', '....'])
    expect(submitIntent(s, CFG, 'a1', 'fish', {}).ok).toBe(false)
    expect(submitIntent(s, CFG, 'a1', 'fish', { x: 0, y: 1 }).ok).toBe(false) // land
    expect(submitIntent(s, CFG, 'a1', 'fish', { x: 3, y: 0 }).ok).toBe(false) // water, too far
    expect(submitIntent(s, CFG, 'a1', 'fish', { x: 1, y: 0 }).ok).toBe(true)
  })

  it('catch on seed w1: decrements the stock and lands one fish', () => {
    const r = castLine(makeWorld(), 'w1')
    expect(r.events).toContainEqual({ type: 'wildlife_changed', payload: { fish: 99 } })
    expect(r.events).toContainEqual({
      type: 'item_spawned',
      payload: { id: 'item_1', kind: 'fish', qty: 1, loc: { t: 'agent', id: 'a1' }, owner: 'a1', spoilage: { spawnDay: 0, days: 2 } },
    })
    expect(r.events).toContainEqual({ type: 'skill_gained', payload: { agentId: 'a1', track: 'fishing', xp: 1 } })
    expect(r.state.wildlife.fish).toBe(99)
    expect(r.state.items.item_1!.kind).toBe('fish')
  })

  // Seed 'w9' rolls ≈ 0.290: under the spring chance of 0.4, over the winter 0.2.
  it('halves the catch chance through winter — the same cast that lands in spring comes up empty', () => {
    const spring = castLine(atTick(makeWorld(), 1440), 'w9')
    expect(spring.events.map((e) => e.type)).toContain('item_spawned')
    const winter = castLine(atTick(makeWorld(), WINTER), 'w9')
    expect(winter.events.map((e) => e.type)).not.toContain('item_spawned')
    expect(winter.state.wildlife.fish).toBe(100)
    expect(CFG.seasons.winter.fishCatchMultiplier).toBe(0.5)
  })

  it('still lands the easy winter cast — the dial narrows the water, it does not freeze it', () => {
    const winter = castLine(atTick(makeWorld(), WINTER), 'w1') // roll ≈ 0.145 < 0.2
    expect(winter.events.map((e) => e.type)).toContain('item_spawned')
  })

  it('miss on seed w2: no catch, no stock change', () => {
    const r = castLine(makeWorld(), 'w2')
    const types = r.events.map((e) => e.type)
    expect(types).not.toContain('item_spawned')
    expect(types).not.toContain('wildlife_changed')
    expect(r.state.wildlife.fish).toBe(100)
  })

  it('empty stock: no catch even on a catching seed, count stays at 0', () => {
    const s = withWildlife(makeWorld(), { fish: 0, deer: 20 })
    const r = castLine(s, 'w1')
    const types = r.events.map((e) => e.type)
    expect(types).not.toContain('item_spawned')
    expect(types).not.toContain('wildlife_changed')
    expect(r.state.wildlife.fish).toBe(0)
  })

  it('catch chance comes from config: fishCatchBase 0 never catches', () => {
    const zero = SimConfigSchema.parse({ wildlife: { fishCatchBase: 0 } })
    const r = castLine(makeWorld(['.~', '..'], zero), 'w1', zero)
    expect(r.events.map((e) => e.type)).not.toContain('item_spawned')
  })
})

describe('verb: forage', () => {
  it('is registered with the foraging skill and requires a nearby forest tile', () => {
    expect(VERBS.forage!.kind).toBe('forage')
    expect(VERBS.forage!.skill).toEqual({ track: 'foraging', xp: 1 })
    expect(submitIntent(makeWorld(['..', '..']), CFG, 'a1', 'forage', {}).ok).toBe(false)
    expect(submitIntent(makeWorld(['.f', '..']), CFG, 'a1', 'forage', {}).ok).toBe(true)
  })

  it('yields the seasonal amount of berries in spring', () => {
    let s = makeWorld(['.f', '..'])
    const r = submitIntent(s, CFG, 'a1', 'forage', {})
    if (!r.ok) throw new Error(r.reason)
    const t = tickOnce(applyAll(s, r.events))
    expect(t.events).toContainEqual({
      type: 'item_spawned',
      payload: { id: 'item_1', kind: 'berries', qty: 2, loc: { t: 'agent', id: 'a1' }, owner: 'a1', spoilage: { spawnDay: 0, days: 3 } },
    })
    expect(t.events).toContainEqual({ type: 'skill_gained', payload: { agentId: 'a1', track: 'foraging', xp: 1 } })
  })

  it('yields nothing in winter', () => {
    let s = atTick(makeWorld(['.f', '..']), WINTER + 5)
    const r = submitIntent(s, CFG, 'a1', 'forage', {})
    if (!r.ok) throw new Error(r.reason)
    const t = tickOnce(applyAll(s, r.events))
    expect(t.events.map((e) => e.type)).not.toContain('item_spawned')
    expect(Object.keys(t.state.items)).toHaveLength(0)
  })
})

describe('worldTick: wildlife regen at dawn', () => {
  it('regenerates fish and deer by their daily rates, capped at max', () => {
    const s = withWildlife(makeWorld(), { fish: 90, deer: 19 })
    const r = tickOnce(atTick(s, DAWN - 1))
    expect(r.events).toContainEqual({ type: 'wildlife_changed', payload: { fish: 95, deer: 20 } })
    expect(r.state.wildlife).toEqual({ fish: 95, deer: 20 })
    const capped = tickOnce(atTick(withWildlife(makeWorld(), { fish: 98, deer: 20 }), DAWN - 1))
    expect(capped.events).toContainEqual({ type: 'wildlife_changed', payload: { fish: 100 } })
  })

  it('emits nothing at full stocks or outside dawn', () => {
    const full = tickOnce(atTick(makeWorld(), DAWN - 1))
    expect(full.events.map((e) => e.type)).not.toContain('wildlife_changed')
    const offDawn = tickOnce(atTick(withWildlife(makeWorld(), { fish: 90, deer: 19 }), 999))
    expect(offDawn.events.map((e) => e.type)).not.toContain('wildlife_changed')
  })
})
