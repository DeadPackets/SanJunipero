import { describe, it, expect } from 'vitest'
import { SimConfigSchema, type SimConfig, type SimEvent } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { VERBS } from './verbs.js'
import { RngStreams } from './rng.js'
import { createWorldTick, type WorldTickResult } from './worldTick.js'

const CFG: SimConfig = SimConfigSchema.parse({ weather: { hourlyChangeChance: 0 } })
const FAST: SimConfig = SimConfigSchema.parse({ weather: { hourlyChangeChance: 0 }, construction: { hutTicks: 3 } })

let seq = 13000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })

function makeWorld(config = CFG, wood = 10): WorldState {
  let s = genesisState(config)
  s = fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }), config)
  if (wood > 0) s = fold(s, ev('item_spawned', { id: 'item_1', kind: 'wood', qty: wood, loc: { t: 'agent', id: 'a1' } }), config)
  return s
}
function applyAll(s: WorldState, events: Array<{ type: string; payload: unknown }>, config = CFG): WorldState {
  for (const e of events) s = fold(s, ev(e.type, e.payload, s.tick), config)
  return s
}
function tickOnce(s: WorldState, config = CFG, rng = new RngStreams('t')): WorldTickResult {
  const wt = createWorldTick(config, rng)
  return wt(fold(s, ev('tick_advanced', {}, s.tick + 1), config))
}
function startBuild(s: WorldState, config = CFG): WorldState {
  const r = submitIntent(s, config, 'a1', 'build', { kind: 'hut', x: 1, y: 1 })
  if (!r.ok) throw new Error(r.reason)
  return applyAll(s, r.events, config)
}

describe('verb: build', () => {
  it('validates kind, reach, placement, and materials', () => {
    expect(submitIntent(makeWorld(CFG, 0), CFG, 'a1', 'build', { kind: 'hut', x: 1, y: 1 }).ok).toBe(false) // no wood
    expect(submitIntent(makeWorld(CFG, 9), CFG, 'a1', 'build', { kind: 'hut', x: 1, y: 1 }).ok).toBe(false) // short on wood
    expect(submitIntent(makeWorld(), CFG, 'a1', 'build', { kind: 'castle', x: 1, y: 1 }).ok).toBe(false)
    expect(submitIntent(makeWorld(), CFG, 'a1', 'build', { kind: 'hut', x: 10, y: 10 }).ok).toBe(false) // out of reach
    expect(submitIntent(makeWorld(), CFG, 'a1', 'build', { kind: 'hut', x: 0, y: 0 }).ok).toBe(false) // builder in the footprint
    expect(submitIntent(makeWorld(), CFG, 'a1', 'build', { kind: 'hut', x: 1, y: 1 }).ok).toBe(true)
  })

  it('consumes materials and plans the structure at action start', () => {
    const s = makeWorld()
    const r = submitIntent(s, CFG, 'a1', 'build', { kind: 'hut', x: 1, y: 1 })
    if (!r.ok) throw new Error(r.reason)
    expect(r.events).toContainEqual({
      type: 'action_started',
      payload: { agentId: 'a1', verb: 'build', params: { kind: 'hut', x: 1, y: 1 }, duration: CFG.construction.hutTicks },
    })
    expect(r.events).toContainEqual({ type: 'item_qty_changed', payload: { id: 'item_1', delta: -10 } })
    expect(r.events).toContainEqual({
      type: 'structure_planned',
      payload: { id: 'structure_2', kind: 'hut', x: 1, y: 1, w: 2, h: 2, maxHp: 50, flammable: true, builderId: 'a1', owner: 'a1' },
    })
    const w = applyAll(s, r.events)
    expect(w.items.item_1).toBeUndefined()
    expect(w.structures.structure_2).toMatchObject({ stage: 'construction', hp: 1, progressTicks: 0 })
  })

  it('rejects a site overlapping an existing structure', () => {
    const w = startBuild(makeWorld())
    const s = fold(w, ev('item_spawned', { id: 'item_9', kind: 'wood', qty: 10, loc: { t: 'agent', id: 'a1' } }), CFG)
    const idle = fold(s, ev('action_interrupted', { agentId: 'a1', reason: 'test' }), CFG)
    expect(submitIntent(idle, CFG, 'a1', 'build', { kind: 'hut', x: 2, y: 2 }).ok).toBe(false)
  })

  it('progresses the structure one tick per worked tick', () => {
    const r = tickOnce(startBuild(makeWorld()))
    expect(r.events).toContainEqual({ type: 'action_progressed', payload: { agentId: 'a1', ticks: 1 } })
    expect(r.events).toContainEqual({ type: 'structure_progressed', payload: { id: 'structure_2', ticks: 1 } })
    expect(r.state.structures.structure_2!.progressTicks).toBe(1)
    expect(r.state.agents.a1!.activity!.ticksRemaining).toBe(CFG.construction.hutTicks - 1)
  })

  it('interrupt preserves progress; resume needs no new materials and completes after hutTicks total', () => {
    let s = tickOnce(startBuild(makeWorld(FAST), FAST), FAST).state
    s = fold(s, ev('action_interrupted', { agentId: 'a1', reason: 'collapsed' }, s.tick), FAST)
    expect(s.agents.a1!.activity).toBeNull()
    expect(s.structures.structure_2!.progressTicks).toBe(1)

    const resume = submitIntent(s, FAST, 'a1', 'build', { kind: 'hut', x: 1, y: 1 })
    if (!resume.ok) throw new Error(resume.reason)
    const types = resume.events.map((e) => e.type)
    expect(types).not.toContain('item_qty_changed')
    expect(types).not.toContain('structure_planned')
    expect(resume.events).toContainEqual({
      type: 'action_started',
      payload: { agentId: 'a1', verb: 'build', params: { kind: 'hut', x: 1, y: 1 }, duration: 2 },
    })

    s = applyAll(s, resume.events, FAST)
    s = tickOnce(s, FAST).state
    const done = tickOnce(s, FAST)
    expect(done.events).toContainEqual({ type: 'structure_completed', payload: { id: 'structure_2' } })
    expect(done.events).toContainEqual({ type: 'skill_gained', payload: { agentId: 'a1', track: 'carpentry', xp: 1 } })
    expect(done.state.structures.structure_2).toMatchObject({ stage: 'complete', hp: 50, progressTicks: 3 })
    expect(done.state.agents.a1!.activity).toBeNull()
  })
})

describe('verb: build reads structures.recipes', () => {
  function withStone(qty: number): WorldState {
    let s = genesisState(CFG)
    s = fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }), CFG)
    return fold(s, ev('item_spawned', { id: 'item_1', kind: 'stone', qty, loc: { t: 'agent', id: 'a1' } }), CFG)
  }
  const WELL = CFG.structures.recipes.well!

  it('a well is 1x1, costs its row in stone, and does not burn', () => {
    const s = withStone(WELL.inputs.stone!)
    const r = submitIntent(s, CFG, 'a1', 'build', { kind: 'well', x: 1, y: 1 })
    if (!r.ok) throw new Error(r.reason)
    expect(r.events).toContainEqual({
      type: 'structure_planned',
      payload: {
        id: 'structure_2', kind: 'well', x: 1, y: 1, w: 1, h: 1,
        maxHp: WELL.maxHp, flammable: false, builderId: 'a1', owner: 'a1',
      },
    })
    expect(r.events).toContainEqual({ type: 'item_qty_changed', payload: { id: 'item_1', delta: -WELL.inputs.stone! } })
    expect(r.events).toContainEqual({
      type: 'action_started',
      payload: { agentId: 'a1', verb: 'build', params: { kind: 'well', x: 1, y: 1 }, duration: WELL.durationTicks },
    })

    let w = applyAll(s, r.events)
    for (let i = 0; i < WELL.durationTicks; i++) w = tickOnce(w).state
    expect(w.structures.structure_2).toMatchObject({ kind: 'well', stage: 'complete', hp: WELL.maxHp, flammable: false })
  })

  it('one stone short is one stone short, by the name of the material', () => {
    const r = submitIntent(withStone(WELL.inputs.stone! - 1), CFG, 'a1', 'build', { kind: 'well', x: 1, y: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('not enough stone')
  })

  it('refuses a grave: an empty recipe marks what the world places and nobody builds', () => {
    expect(CFG.structures.recipes.grave!.inputs).toEqual({})
    const r = submitIntent(withStone(8), CFG, 'a1', 'build', { kind: 'grave', x: 1, y: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('cannot build a grave')
  })

  it('leaves the hut byte-identical to C9: same row, same dials, same number', () => {
    const hut = CFG.structures.recipes.hut!
    expect(hut.inputs).toEqual(CFG.construction.hutMaterials)
    expect({ w: hut.w, h: hut.h }).toEqual(CFG.construction.hutSize)
    expect(hut.maxHp).toBe(CFG.construction.hutMaxHp)
    expect(hut.durationTicks).toBe(CFG.construction.hutTicks)
  })
})

describe('verb: fill', () => {
  // A pond at (1,0); the agent stands beside it at (0,0).
  function withVessel(kind: string, charges = 0, x = 0): WorldState {
    const terrain = Array.from({ length: 8 }, () => Array.from({ length: 8 }, (): TileId => 0))
    terrain[0]![1] = 2
    let s = genesisState(CFG, terrain)
    s = fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x, y: 0, ageDays: 7300 }), CFG)
    return fold(s, ev('item_spawned', {
      id: 'item_1', kind, qty: 1, loc: { t: 'agent', id: 'a1' }, charges,
    }), CFG)
  }
  const filled = (s: WorldState) => {
    const r = submitIntent(s, CFG, 'a1', 'fill', { itemId: 'item_1' })
    if (!r.ok) throw new Error(r.reason)
    return tickOnce(applyAll(s, r.events))
  }

  it('fills a waterskin to its config charge count and a bucket to exactly one', () => {
    const skin = filled(withVessel('waterskin'))
    expect(skin.events).toContainEqual({
      type: 'item_filled', payload: { itemId: 'item_1', charges: CFG.thirst.waterskinCharges },
    })
    expect(skin.state.items.item_1!.charges).toBe(CFG.thirst.waterskinCharges)

    const bucket = filled(withVessel('bucket'))
    expect(bucket.state.items.item_1!.charges).toBe(1)
  })

  it('fills at a finished well too, and refuses away from any water at all', () => {
    let s = withVessel('waterskin', 0, 5)
    s = fold(s, ev('structure_planned', {
      id: 'structure_1', kind: 'well', x: 6, y: 0, w: 1, h: 1, maxHp: 30, flammable: false, builderId: 'a1',
    }), CFG)
    const unfinished = submitIntent(s, CFG, 'a1', 'fill', { itemId: 'item_1' })
    expect(unfinished.ok).toBe(false)
    if (!unfinished.ok) expect(unfinished.reason).toBe('no water within reach')

    s = fold(s, ev('structure_completed', { id: 'structure_1' }), CFG)
    expect(filled(s).state.items.item_1!.charges).toBe(CFG.thirst.waterskinCharges)

    const dry = submitIntent(withVessel('waterskin', 0, 4), CFG, 'a1', 'fill', { itemId: 'item_1' })
    expect(dry.ok).toBe(false)
    if (!dry.ok) expect(dry.reason).toBe('no water within reach')
  })

  it('refuses to fill something that does not hold water', () => {
    const r = submitIntent(withVessel('wood'), CFG, 'a1', 'fill', { itemId: 'item_1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('that holds no water')
  })
})

describe('verb: craft', () => {
  it('is registered and validates recipe and materials', () => {
    expect(VERBS.craft!.kind).toBe('craft')
    expect(submitIntent(makeWorld(), CFG, 'a1', 'craft', {}).ok).toBe(false)
    expect(submitIntent(makeWorld(), CFG, 'a1', 'craft', { recipe: 'sword' }).ok).toBe(false)
    expect(submitIntent(makeWorld(CFG, 0), CFG, 'a1', 'craft', { recipe: 'plank' }).ok).toBe(false)
    expect(submitIntent(makeWorld(CFG, 1), CFG, 'a1', 'craft', { recipe: 'plank' }).ok).toBe(true)
  })

  it('an unknown recipe names itself and points somewhere (T18)', () => {
    const r = submitIntent(makeWorld(), CFG, 'a1', 'craft', { recipe: 'sword' })
    expect(r).toEqual({
      ok: false,
      reason: 'no such recipe: sword — perhaps someone nearby knows how, or it wants discovering.',
    })
    // A known recipe the agent simply cannot afford keeps its own material refusal.
    const poor = submitIntent(makeWorld(CFG, 0), CFG, 'a1', 'craft', { recipe: 'plank' })
    expect(poor.ok).toBe(false)
    if (!poor.ok) expect(poor.reason).not.toContain('wants discovering')
  })

  it('plank: consumes 1 wood, yields 2 planks, grants carpentry xp', () => {
    const s = makeWorld(CFG, 1)
    const r = submitIntent(s, CFG, 'a1', 'craft', { recipe: 'plank' })
    if (!r.ok) throw new Error(r.reason)
    const t = tickOnce(applyAll(s, r.events))
    expect(t.events).toContainEqual({ type: 'item_qty_changed', payload: { id: 'item_1', delta: -1 } })
    expect(t.events).toContainEqual({
      type: 'item_spawned',
      payload: { id: 'item_2', kind: 'plank', qty: 2, loc: { t: 'agent', id: 'a1' }, owner: 'a1' },
    })
    expect(t.events).toContainEqual({ type: 'skill_gained', payload: { agentId: 'a1', track: 'carpentry', xp: 1 } })
    expect(t.state.items.item_1).toBeUndefined()
    expect(t.state.items.item_2).toMatchObject({ kind: 'plank', qty: 2 })
  })
})
