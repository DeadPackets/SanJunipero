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

  /**
   * ★ FIVE OF THE NINE WEIGHTS CAN NEVER FIRE, AND THE TABLE ABOVE READS LIKE THEY DO.
   *
   * The scorer needs `payload.agentId` or `payload.builderId` to file a score under somebody.
   * Checked against `events.def.ts`, five weighted payloads carry neither: `fire_ignited`
   * `{structureId, cause}`, `fire_spread` `{fromId, toId}`, `structure_completed` `{id}`,
   * `crop_harvested` `{cropId}`, `item_moved` `{id, loc}`. Their weights — 12, 10, 6, 3 and 1 —
   * are computed and dropped on every event, which is the whole of the town's fire and harvest
   * drama going unscored while the table promises it is the second-loudest thing after a death.
   *
   * The `builderId` fallback is unreachable for the same reason: `structure_planned` is the only
   * payload that carries one and it is not weighted. The test above it forges an `agent_died`
   * with a `builderId`, which `AgentDied.strict()` makes impossible — a branch protected against
   * a shape the engine cannot emit.
   *
   * This test does NOT fix it: deciding whose drama a fire is changes the director's moment list
   * and belongs to whoever owns the drama model. It refuses to let the table keep reading like
   * protection, and it FAILS THE DAY SOMEBODY FIXES ONE — which is the point.
   */
  it('★ names the five weights that score nothing, because the table above hides them', () => {
    const unattributed: ReadonlyArray<[string, Record<string, unknown>]> = [
      ['fire_ignited', { structureId: 's1', cause: 'lightning' }],
      ['fire_spread', { fromId: 's1', toId: 's2' }],
      ['structure_completed', { id: 's1' }],
      ['crop_harvested', { cropId: 'c1' }],
      ['item_moved', { id: 'i1', loc: { t: 'tile', x: 0, y: 0 } }],
    ]
    for (const [type, payload] of unattributed) {
      expect(HEAT_WEIGHTS[type], `${type} is weighted`).toBeGreaterThan(0)
      expect(heatWindows([ev(1, 0, type, payload)]), `${type} scores for nobody`).toEqual([])
    }
    // and no weighted payload in the engine carries a builderId, so the fallback is dead too
    expect(Object.keys(HEAT_WEIGHTS)).not.toContain('structure_planned')
  })

  it('returns [] for no events', () => {
    expect(heatWindows([])).toEqual([])
  })
})
