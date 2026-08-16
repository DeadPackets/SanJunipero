import { describe, expect, it } from 'vitest'
import type { SimEvent } from '@sj/shared'
import { HEAT_WEIGHTS, HEAT_WINDOW_TICKS, heatWindows } from './heatStub.js'

const ev = (seq: number, tick: number, type: string, payload: Record<string, unknown>): SimEvent =>
  ({ seq, tick, type, payload }) as SimEvent

describe('heat stub', () => {
  it('exports the plan-pinned window and weights', () => {
    expect(HEAT_WINDOW_TICKS).toBe(60)
    expect(HEAT_WEIGHTS).toEqual({
      agent_died: 20, fire_ignited: 12, fire_spread: 10, agent_injured: 8,
      structure_completed: 6, agent_collapsed: 6, crop_harvested: 3, agent_spoke: 2, item_moved: 1,
    })
  })

  it('scores per-agent 60-tick windows, skipping unattributed and unlisted events', () => {
    const windows = heatWindows([
      ev(1, 2, 'agent_spoke', { agentId: 'alice', text: 'hi', x: 0, y: 0 }),   // w0 alice +2
      ev(2, 40, 'structure_completed', { id: 's1' }),                          // weight 6, no agentId/builderId → skipped
      ev(3, 50, 'agent_spoke', { agentId: 'alice', text: 'yo', x: 0, y: 0 }),  // w0 alice +2
      ev(4, 59, 'agent_injured', { agentId: 'bob', kind: 'minor' }),           // w0 bob +8 (last tick of w0)
      ev(5, 60, 'agent_spoke', { agentId: 'bob', text: 'ow', x: 0, y: 3 }),    // w1 bob +2 (first tick of w1)
      ev(6, 70, 'agent_died', { agentId: 'dan', cause: 'hunger' }),            // w1 dan +20
      ev(7, 71, 'tick_advanced', {}),                                          // unlisted → 0
      ev(8, 72, 'item_moved', { id: 'i1', loc: { t: 'tile', x: 0, y: 0 } }),   // weight 1 but unattributed → skipped
    ])
    expect(windows).toEqual([
      { fromTick: 0, toTick: 59, agentId: 'alice', score: 4 },
      { fromTick: 0, toTick: 59, agentId: 'bob', score: 8 },
      { fromTick: 60, toTick: 119, agentId: 'bob', score: 2 },
      { fromTick: 60, toTick: 119, agentId: 'dan', score: 20 },
    ])
  })

  it('attributes via payload.builderId when agentId is absent', () => {
    const windows = heatWindows([
      { seq: 1, tick: 3, type: 'agent_died', payload: { builderId: 'bob', cause: 'x' } } as unknown as SimEvent,
    ])
    expect(windows).toEqual([{ fromTick: 0, toTick: 59, agentId: 'bob', score: 20 }])
  })

  it('returns [] for no events', () => {
    expect(heatWindows([])).toEqual([])
  })
})
