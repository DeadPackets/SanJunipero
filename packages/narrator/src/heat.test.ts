import { describe, expect, it } from 'vitest'
import type { SimEvent } from '@sj/shared'
import type { HeatCtx, SceneSegment } from './types.js'
import { CONFLICT_WEIGHT, STAKES_WEIGHT, rankScenesForDirector, scoreHeat } from './heat.js'

const ev = (seq: number, tick: number, type: string, payload: unknown = {}): SimEvent => ({
  seq,
  tick,
  type,
  payload,
})

const scene = (eventIds: number[], over: Partial<SceneSegment> = {}): SceneSegment => ({
  day: 0,
  startTick: 0,
  endTick: 10,
  eventIds,
  cast: [],
  location: null,
  ...over,
})

describe('scoreHeat', () => {
  it('scores the argument fixture per the weight tables', () => {
    const events = [
      ev(1, 0, 'agent_spoke', { agentId: 'a', text: 'x', x: 0, y: 0 }),
      ev(2, 1, 'agent_spoke', { agentId: 'b', text: 'y', x: 0, y: 0 }),
      ev(3, 2, 'agent_spoke', { agentId: 'a', text: 'z', x: 0, y: 0 }),
      ev(4, 3, 'agent_injured', { agentId: 'b', kind: 'minor' }),
    ]
    const ctx: HeatCtx = {
      priorTypeCounts: { agent_spoke: 5, agent_injured: 0 },
      firstsInScene: 1,
      privateThoughts: 1,
      publicSpeech: 3,
    }
    const s = scoreHeat(scene([1, 2, 3, 4]), ctx, events)
    expect(s.conflict).toBeCloseTo(1.25, 10) // 1 injury + 0.25 for the third speech
    expect(s.novelty).toBeCloseTo(1 / 6 + 1, 10)
    expect(s.firsts).toBe(3)
    expect(s.stakes).toBe(1)
    expect(s.dramaticIrony).toBe(1.5)
    expect(s.total).toBeCloseTo(7.917, 3) // rounded to 3 decimals
  })

  it('an idle scene with all-zero ctx scores zero total', () => {
    const events = [
      ev(1, 0, 'agent_moved', { id: 'a', x: 1, y: 1 }),
      ev(2, 1, 'crop_grew', { cropId: 'c', stage: 1 }),
    ]
    const ctx: HeatCtx = {
      priorTypeCounts: {},
      firstsInScene: 0,
      privateThoughts: 0,
      publicSpeech: 0,
    }
    const s = scoreHeat(scene([1, 2]), ctx, events)
    expect(s.total).toBe(0)
  })

  it('only events belonging to the scene are scored', () => {
    const events = [
      ev(1, 0, 'agent_died', { agentId: 'a', cause: 'age' }),
      ev(2, 1, 'agent_moved', { id: 'b', x: 1, y: 1 }),
    ]
    const ctx: HeatCtx = {
      priorTypeCounts: {},
      firstsInScene: 0,
      privateThoughts: 0,
      publicSpeech: 0,
    }
    const s = scoreHeat(scene([2]), ctx, events) // the death is outside this scene
    expect(s.conflict).toBe(0)
    expect(s.stakes).toBe(0)
  })

  it('weight tables carry the ratified values', () => {
    expect(CONFLICT_WEIGHT.agent_died).toBe(3)
    expect(CONFLICT_WEIGHT.fire_ignited).toBe(1.5)
    expect(STAKES_WEIGHT.crop_harvested).toBe(0.5)
    expect(STAKES_WEIGHT.agent_recovered).toBe(0.5)
  })
})

describe('rankScenesForDirector', () => {
  it('ranks the argument over the idle, ties broken by lower sceneIndex', () => {
    const idle = scene([1, 2])
    const argument = scene([3, 4, 5, 6])
    const zero = { conflict: 0, novelty: 0, firsts: 0, stakes: 0, dramaticIrony: 0, total: 0 }
    const hot = { ...zero, conflict: 1.25, total: 7.917 }
    const ranked = rankScenesForDirector([idle, argument], [zero, hot])
    expect(ranked).toEqual([
      { sceneIndex: 1, total: 7.917 },
      { sceneIndex: 0, total: 0 },
    ])
    const tied = rankScenesForDirector([idle, argument], [hot, hot])
    expect(tied.map((r) => r.sceneIndex)).toEqual([0, 1]) // stable: lower sceneIndex first on ties
  })
})

// A day the town nearly lost somebody must not score as a day of nothing. `agent_fell_ill` and
// `agent_infected` have had no emitter since the affliction model landed.
describe('scoreHeat: the C11 sickness plane is visible to the director', () => {
  const quiet: SimEvent[] = [
    ev(1, 0, 'agent_moved', { id: 'a', x: 1, y: 1 }),
    ev(2, 1, 'crop_grew', { cropId: 'c1' }),
    ev(3, 2, 'agent_moved', { id: 'b', x: 2, y: 1 }),
  ]
  // A poisoning, three nights of it worsening, two tendings and a burial.
  const grim: SimEvent[] = [
    ev(11, 0, 'agent_afflicted', { agentId: 'a', kind: 'poison', severity: 1 }),
    ev(12, 1, 'affliction_worsened', { agentId: 'a', kind: 'poison', severity: 2 }),
    ev(13, 2, 'affliction_worsened', { agentId: 'a', kind: 'poison', severity: 3 }),
    ev(14, 3, 'agent_tended', { agentId: 'a', tenderId: 'b' }),
    ev(15, 4, 'agent_tended', { agentId: 'a', tenderId: 'c' }),
    ev(16, 5, 'grave_placed', { id: 's1', agentId: 'a', name: 'A', x: 1, y: 1 }),
  ]
  const flat: HeatCtx = {
    priorTypeCounts: {},
    firstsInScene: 0,
    privateThoughts: 0,
    publicSpeech: 0,
  }

  it('a day that nearly lost somebody outscores a day of nothing', () => {
    const dull = scoreHeat(scene([1, 2, 3]), flat, quiet)
    const bad = scoreHeat(scene([11, 12, 13, 14, 15, 16]), flat, grim)
    expect(dull.total).toBe(0)
    expect(bad.conflict).toBe(3) // the poisoning and both worsenings
    expect(bad.stakes).toBe(6) // the same three, plus two hands and a stone
    expect(bad.total).toBeGreaterThan(dull.total)
  })

  it('a blow that names the hand is the heaviest single act of conflict short of a death', () => {
    expect(CONFLICT_WEIGHT.agent_harmed).toBe(1.5)
    expect(CONFLICT_WEIGHT.agent_harmed!).toBeLessThan(CONFLICT_WEIGHT.agent_died!)
  })

  it('hp_changed is weighted by neither table: it fires every tick a body is dying', () => {
    expect(CONFLICT_WEIGHT.hp_changed).toBeUndefined()
    expect(STAKES_WEIGHT.hp_changed).toBeUndefined()
    const bleeding = Array.from({ length: 40 }, (_, i) =>
      ev(100 + i, i, 'hp_changed', { agentId: 'a', delta: -0.05 }),
    )
    expect(scoreHeat(scene(bleeding.map((e) => e.seq)), flat, bleeding).total).toBe(0)
  })

  it('every weighted type but the two legacy rows is one the world still emits', () => {
    // Kept because recorded C1-C10 logs carry them; nothing emits either any more.
    const legacy = new Set(['agent_fell_ill', 'agent_infected'])
    const weighted = new Set([...Object.keys(CONFLICT_WEIGHT), ...Object.keys(STAKES_WEIGHT)])
    for (const kind of [
      'agent_afflicted',
      'affliction_worsened',
      'affliction_recovered',
      'agent_tended',
      'grave_placed',
      'agent_harmed',
    ]) {
      expect(weighted.has(kind)).toBe(true)
    }
    expect([...weighted].filter((k) => legacy.has(k)).sort()).toEqual([
      'agent_fell_ill',
      'agent_infected',
    ])
  })
})
