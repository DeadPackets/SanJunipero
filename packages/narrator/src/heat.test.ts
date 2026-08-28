import { describe, expect, it } from 'vitest'
import type { SimEvent } from '@sj/shared'
import type { HeatCtx, SceneSegment } from './types.js'
import { CONFLICT_WEIGHT, STAKES_WEIGHT, scoreHeat } from './heat.js'

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
