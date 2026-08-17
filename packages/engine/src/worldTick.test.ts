import { describe, it, expect } from 'vitest'
import { SimConfigSchema, type SimConfig, type SimEvent } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { FOOD_KINDS, VERBS } from './verbs.js'
import { RngStreams } from './rng.js'
import { createWorldTick, type WorldTickResult } from './worldTick.js'

const FAST: SimConfig = SimConfigSchema.parse({
  needs: {
    hungerDecayPerTick: 5, energyDecayAwakePerTick: 4, energyRegenAsleepPerTick: 10,
    socialDecayPerTick: 2, warmthEqualizeFactorPerTick: 0.5,
    collapseThreshold: 5, deathAfterZeroHungerTicks: 3, eatRestoreHunger: 60,
  },
  // Bare 8x4 worlds with no hut: the bed law (C9 T2b) is not what these rows test.
  structures: { sleepIndoorsOnly: false },
})

const CHAR_TILE: Record<string, TileId> = { '.': 0, '~': 2 }
let seq = 1000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })

function makeWorld(config = FAST, rows: string[] = ['........', '........', '........', '........']): WorldState {
  const s = genesisState(config, rows.map((row) => [...row].map((c) => CHAR_TILE[c]!)))
  return fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }), config)
}
function patchAgent(s: WorldState, id: string, patch: Partial<WorldState['agents'][string]>): WorldState {
  return { ...s, agents: { ...s.agents, [id]: { ...s.agents[id]!, ...patch } } }
}
function applyAll(s: WorldState, events: Array<{ type: string; payload: unknown }>, config = FAST, tick = s.tick): WorldState {
  for (const e of events) s = fold(s, ev(e.type, e.payload, tick), config)
  return s
}

// Advance one tick the way TickLoop would: tick_advanced, then the world tick pipeline.
function tickOnce(s: WorldState, config = FAST, rng = new RngStreams('t')): WorldTickResult {
  const wt = createWorldTick(config, rng)
  return wt(fold(s, ev('tick_advanced', {}, s.tick + 1), config))
}

describe('fold: sleep / collapse / death events', () => {
  it('agent_slept sets asleep; unknown agent throws', () => {
    let s = makeWorld()
    s = fold(s, ev('agent_slept', { agentId: 'a1' }), FAST)
    expect(s.agents.a1!.asleep).toBe(true)
    expect(() => fold(s, ev('agent_slept', { agentId: 'ghost' }), FAST)).toThrow(/unknown agent/i)
  })

  it('agent_collapsed stamps collapsedSinceTick with the event tick', () => {
    let s = makeWorld()
    s = fold(s, ev('agent_collapsed', { agentId: 'a1' }, 42), FAST)
    expect(s.agents.a1!.collapsedSinceTick).toBe(42)
    expect(() => fold(s, ev('agent_collapsed', { agentId: 'ghost' }), FAST)).toThrow(/unknown agent/i)
  })

  it('agent_died: alive=false, activity cleared, body remains, no item spawned', () => {
    let s = makeWorld()
    s = patchAgent(s, 'a1', { activity: { verb: 'idle', ticksRemaining: 3, params: {} }, asleep: true })
    s = fold(s, ev('agent_died', { agentId: 'a1', cause: 'starvation' }), FAST)
    expect(s.agents.a1!.alive).toBe(false)
    expect(s.agents.a1!.activity).toBeNull()
    expect(s.agents.a1).toBeDefined()
    expect(Object.keys(s.items)).toHaveLength(0)
    expect(() => fold(s, ev('agent_died', { agentId: 'ghost', cause: 'x' }), FAST)).toThrow(/unknown agent/i)
  })

  it('need_changed tracks zeroHungerSinceTick: set when hunger hits 0, cleared when it rises', () => {
    let s = makeWorld()
    s = fold(s, ev('need_changed', { id: 'a1', need: 'hunger', delta: -100 }, 7), FAST)
    expect(s.agents.a1!.zeroHungerSinceTick).toBe(7)
    s = fold(s, ev('need_changed', { id: 'a1', need: 'hunger', delta: -5 }, 9), FAST)
    expect(s.agents.a1!.zeroHungerSinceTick).toBe(7) // already zero: first tick stands
    s = fold(s, ev('need_changed', { id: 'a1', need: 'hunger', delta: 60 }, 10), FAST)
    expect(s.agents.a1!.zeroHungerSinceTick).toBeNull()
  })

  it('need_changed clears collapsedSinceTick only when hunger AND energy are back at threshold', () => {
    let s = makeWorld()
    s = patchAgent(s, 'a1', { collapsedSinceTick: 3, needs: { hunger: 0, energy: 0, warmth: 50, social: 50 } })
    s = fold(s, ev('need_changed', { id: 'a1', need: 'hunger', delta: 60 }, 5), FAST)
    expect(s.agents.a1!.collapsedSinceTick).toBe(3) // energy still below
    s = fold(s, ev('need_changed', { id: 'a1', need: 'energy', delta: 60 }, 6), FAST)
    expect(s.agents.a1!.collapsedSinceTick).toBeNull()
  })
})

describe('verbs: sleep / wake / eat', () => {
  it('sleep, wake, eat are registered', () => {
    expect(VERBS.sleep!.kind).toBe('sleep')
    expect(VERBS.wake!.kind).toBe('wake')
    expect(VERBS.eat!.kind).toBe('eat')
  })

  it('eat validates a held food item', () => {
    let s = makeWorld()
    expect(submitIntent(s, FAST, 'a1', 'eat', {}).ok).toBe(false)
    expect(submitIntent(s, FAST, 'a1', 'eat', { itemId: 'item_9' }).ok).toBe(false)
    s = fold(s, ev('item_spawned', { id: 'item_1', kind: 'wood', qty: 1, loc: { t: 'agent', id: 'a1' } }), FAST)
    expect(submitIntent(s, FAST, 'a1', 'eat', { itemId: 'item_1' }).ok).toBe(false) // wood is not food
    s = fold(s, ev('item_spawned', { id: 'item_2', kind: 'berries', qty: 1, loc: { t: 'tile', x: 3, y: 3 } }), FAST)
    expect(submitIntent(s, FAST, 'a1', 'eat', { itemId: 'item_2' }).ok).toBe(false) // not held
    s = fold(s, ev('item_moved', { id: 'item_2', loc: { t: 'agent', id: 'a1' } }), FAST)
    expect(submitIntent(s, FAST, 'a1', 'eat', { itemId: 'item_2' }).ok).toBe(true)
    expect(FOOD_KINDS.has('berries')).toBe(true)
  })

  it('sleep rejects when already asleep; wake rejects when awake', () => {
    const awake = makeWorld()
    expect(submitIntent(awake, FAST, 'a1', 'wake', {}).ok).toBe(false)
    const asleep = patchAgent(awake, 'a1', { asleep: true })
    expect(submitIntent(asleep, FAST, 'a1', 'sleep', {}).ok).toBe(false)
    expect(submitIntent(asleep, FAST, 'a1', 'wake', {}).ok).toBe(true)
  })
})

// Noon, so the equalization is what runs: a spring midnight is cold enough to be exposure,
// and from C11 Task 22 the cold owns warmth whenever it has the body (warmthSystem).
// Off the hour as well as off the night, so the weather roll leaves the sky as the row set it.
const atNoon = (s: WorldState): WorldState => ({ ...s, tick: 700 })

describe('worldTick: needs system', () => {
  it('one tick of awake decay: hunger, energy, social fall by config; warmth equalizes', () => {
    const r = tickOnce(atNoon(makeWorld()))
    const n = r.state.agents.a1!.needs
    expect(n.hunger).toBe(95)
    expect(n.energy).toBe(96)
    expect(n.social).toBe(98)
    // spring 14°C: target = clamp(0,100, 50 + 2×(14−10)) = 58; 100 + (58−100)×0.5 = 79
    expect(n.warmth).toBe(79)
  })

  it('warmth target clamps to 100 in extreme heat', () => {
    let s = atNoon(makeWorld())
    s = { ...s, weather: { kind: 'sunny', temperatureC: 40 } } // raw target 110 → 100
    s = patchAgent(s, 'a1', { needs: { hunger: 100, energy: 100, warmth: 60, social: 100 } })
    const r = tickOnce(s)
    expect(r.state.agents.a1!.needs.warmth).toBe(80) // 60 + (100−60)×0.5
  })

  it('asleep: energy regens instead of decaying; hunger still decays', () => {
    const s = patchAgent(makeWorld(), 'a1', { asleep: true, needs: { hunger: 50, energy: 40, warmth: 100, social: 100 } })
    const r = tickOnce(s)
    expect(r.state.agents.a1!.needs.energy).toBe(50)
    expect(r.state.agents.a1!.needs.hunger).toBe(45)
  })

  it('dead agents are ignored entirely: no events emitted', () => {
    const s = patchAgent(makeWorld(), 'a1', { alive: false })
    const r = tickOnce(s)
    expect(r.events).toEqual([])
  })
})

describe('worldTick: sleep and eat flows', () => {
  it('sleep intent completes into agent_slept; walk intent later wakes the sleeper', () => {
    let s = makeWorld()
    const r = submitIntent(s, FAST, 'a1', 'sleep', {})
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    const t1 = tickOnce(s)
    expect(t1.events.map((e) => e.type)).toContain('agent_slept')
    expect(t1.state.agents.a1!.asleep).toBe(true)
    expect(t1.state.agents.a1!.activity).toBeNull()

    const w = submitIntent(t1.state, FAST, 'a1', 'walk', { x: 2, y: 0 })
    if (!w.ok) throw new Error(w.reason)
    expect(w.events[0]!.type).toBe('agent_woke')
  })

  it('eat restores eatRestoreHunger and consumes qty 1; item removed at qty 0', () => {
    let s = makeWorld()
    s = fold(s, ev('item_spawned', { id: 'item_1', kind: 'berries', qty: 2, loc: { t: 'agent', id: 'a1' } }), FAST)
    s = patchAgent(s, 'a1', { needs: { hunger: 20, energy: 100, warmth: 100, social: 100 } })
    const r = submitIntent(s, FAST, 'a1', 'eat', { itemId: 'item_1' })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    const t1 = tickOnce(s)
    // decay first (20−5), then eat completes (+60)
    expect(t1.state.agents.a1!.needs.hunger).toBe(75)
    expect(t1.state.items.item_1!.qty).toBe(1)
    expect(t1.state.agents.a1!.activity).toBeNull()

    const r2 = submitIntent(t1.state, FAST, 'a1', 'eat', { itemId: 'item_1' })
    if (!r2.ok) throw new Error(r2.reason)
    const t2 = tickOnce(applyAll(t1.state, r2.events))
    expect(t2.state.items.item_1).toBeUndefined()
  })
})

describe('worldTick: collapse', () => {
  it('collapse interrupts an in-progress walk and stamps collapsedSinceTick', () => {
    let s = makeWorld()
    const r = submitIntent(s, FAST, 'a1', 'walk', { x: 4, y: 0 })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    s = patchAgent(s, 'a1', { needs: { hunger: 100, energy: 4, warmth: 100, social: 100 } })
    const t1 = tickOnce(s)
    const types = t1.events.map((e) => e.type)
    expect(types).toContain('action_interrupted')
    expect(types).toContain('agent_collapsed')
    const a = t1.state.agents.a1!
    expect(a.activity).toBeNull()
    expect(a.collapsedSinceTick).toBe(t1.state.tick)
    expect(submitIntent(t1.state, FAST, 'a1', 'walk', { x: 5, y: 0 }).ok).toBe(false)
  })

  it('a mismatched walk duration (no tiles left) interrupts instead of throwing', () => {
    let s = makeWorld()
    const r = submitIntent(s, FAST, 'a1', 'walk', { x: 2, y: 0 })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    s = patchAgent(s, 'a1', { x: 2, y: 0 }) // already at destination, ticksRemaining still 2
    const t1 = tickOnce(s)
    expect(t1.events).toContainEqual({ type: 'action_interrupted', payload: { agentId: 'a1', reason: 'blocked' } })
    expect(t1.state.agents.a1!.activity).toBeNull()
  })

  it('needs decay and collapse see the same tick sequentially: decay below threshold collapses same tick', () => {
    const s = patchAgent(makeWorld(), 'a1', { needs: { hunger: 100, energy: 8, warmth: 100, social: 100 } })
    const t1 = tickOnce(s) // energy 8−4 = 4 < 5, folded before collapse system runs
    expect(t1.events.map((e) => e.type)).toContain('agent_collapsed')
  })
})

describe('worldTick: collapse recovery through sleep', () => {
  it('a collapsed agent may sleep; energy regen clears the collapse and it can act again', () => {
    let s = patchAgent(makeWorld(), 'a1', { needs: { hunger: 100, energy: 4, warmth: 100, social: 100 } })
    let t = tickOnce(s) // energy 4−4 = 0 < 5: collapses
    expect(t.events.map((e) => e.type)).toContain('agent_collapsed')
    expect(submitIntent(t.state, FAST, 'a1', 'walk', { x: 1, y: 0 }).ok).toBe(false)
    const r = submitIntent(t.state, FAST, 'a1', 'sleep', {})
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(t.state, r.events)
    t = tickOnce(s) // sleep completes: asleep
    expect(t.state.agents.a1!.asleep).toBe(true)
    expect(t.state.agents.a1!.collapsedSinceTick).not.toBeNull()
    t = tickOnce(t.state) // asleep: energy regens past collapseThreshold
    expect(t.state.agents.a1!.collapsedSinceTick).toBeNull()
    expect(submitIntent(t.state, FAST, 'a1', 'walk', { x: 1, y: 0 }).ok).toBe(true)
  })
})

describe('worldTick: death', () => {
  it('starvation death lands on the exact tick: zeroHungerSinceTick + deathAfterZeroHungerTicks + 1', () => {
    let s = patchAgent(makeWorld(), 'a1', { needs: { hunger: 10, energy: 100, warmth: 100, social: 100 } })
    const rng = new RngStreams('t')
    const deaths: number[] = []
    for (let t = 1; t <= 8; t++) {
      const r = tickOnce(s, FAST, rng)
      s = r.state
      if (r.events.some((e) => e.type === 'agent_died')) deaths.push(s.tick)
    }
    // hunger: 10 → 5 (t1) → 0 (t2, zeroHungerSinceTick=2); dies when tick−2 > 3 → tick 6
    expect(deaths).toEqual([6])
    expect(s.agents.a1!.alive).toBe(false)
    expect(submitIntent(s, FAST, 'a1', 'walk', { x: 1, y: 0 }).ok).toBe(false)
  })

  it('death drops every held item onto the death tile, before the death event', () => {
    let s = patchAgent(makeWorld(), 'a1', {
      x: 3, y: 2,
      needs: { hunger: 0, energy: 100, warmth: 100, social: 100 }, zeroHungerSinceTick: 0, collapsedSinceTick: 0,
    })
    s = fold(s, ev('item_spawned', { id: 'item_1', kind: 'berries', qty: 2, loc: { t: 'agent', id: 'a1' } }), FAST)
    s = fold(s, ev('item_spawned', { id: 'item_2', kind: 'wood', qty: 1, loc: { t: 'agent', id: 'a1' } }), FAST)
    s = { ...s, tick: 10 }
    const r = createWorldTick(FAST, new RngStreams('t'))(s)
    const types = r.events.map((e) => e.type)
    const diedAt = types.indexOf('agent_died')
    expect(diedAt).toBeGreaterThan(-1)
    expect(r.events).toContainEqual({ type: 'item_moved', payload: { id: 'item_1', loc: { t: 'tile', x: 3, y: 2 } } })
    expect(r.events).toContainEqual({ type: 'item_moved', payload: { id: 'item_2', loc: { t: 'tile', x: 3, y: 2 } } })
    expect(types.indexOf('item_moved')).toBeLessThan(diedAt)
    expect(r.state.items.item_1!.loc).toEqual({ t: 'tile', x: 3, y: 2 })
    expect(r.state.items.item_2!.loc).toEqual({ t: 'tile', x: 3, y: 2 })
  })

  it('agent_died carries the cause', () => {
    let s = patchAgent(makeWorld(), 'a1', { needs: { hunger: 0, energy: 100, warmth: 100, social: 100 }, zeroHungerSinceTick: 0, collapsedSinceTick: 0 })
    s = { ...s, tick: 10 }
    const r = createWorldTick(FAST, new RngStreams('t'))(s)
    const died = r.events.find((e) => e.type === 'agent_died')
    expect(died?.payload).toEqual({ agentId: 'a1', cause: 'hunger' })
  })
})

describe('worldTick: replay safety', () => {
  it('folding the returned events over the input state reproduces the returned state exactly', () => {
    let s = makeWorld()
    s = fold(s, ev('item_spawned', { id: 'item_1', kind: 'berries', qty: 1, loc: { t: 'agent', id: 'a1' } }), FAST)
    const r = submitIntent(s, FAST, 'a1', 'walk', { x: 3, y: 2 })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    s = fold(s, ev('tick_advanced', {}, s.tick + 1), FAST)
    const out = createWorldTick(FAST, new RngStreams('t'))(s)
    expect(out.events.length).toBeGreaterThan(0)
    expect(applyAll(s, out.events, FAST, s.tick)).toEqual(out.state)
  })
})
