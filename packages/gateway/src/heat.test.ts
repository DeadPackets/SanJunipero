import { describe, expect, it } from 'vitest'
import type { SimEvent } from '@sj/shared'
import {
  HEAT_WEIGHTS,
  HEAT_WINDOW_TICKS,
  heatContext,
  heatFromScores,
  scoreEvent,
  type HeatScores,
  type HeatWindow,
} from './heat.js'

const ev = (seq: number, tick: number, type: string, payload: Record<string, unknown>): SimEvent =>
  ({ seq, tick, type, payload }) as SimEvent

// The read path's own fold, assembled from the pieces it uses — one score map, one context, and
// the plan map it keeps as it goes. See `readFold` in api.ts; there is no second scorer to drift.
const score = (events: readonly SimEvent[]): HeatWindow[] => {
  const scores: HeatScores = new Map()
  const plans = new Map<string, string>()
  const ctx = heatContext((id) => plans.get(id) ?? null)
  for (const e of events) {
    scoreEvent(scores, e, ctx)
    if (e.type !== 'structure_planned') continue
    const p = e.payload as { id: string; builderId: string }
    plans.set(p.id, p.builderId)
  }
  return heatFromScores(scores)
}

const plan = (seq: number, tick: number, id: string, builderId: string): SimEvent =>
  ev(seq, tick, 'structure_planned', { id, kind: 'house', builderId })

describe('heat stub', () => {
  it('exports the plan-pinned window and weights', () => {
    expect(HEAT_WINDOW_TICKS).toBe(60)
    expect(HEAT_WEIGHTS).toEqual({
      agent_died: 20,
      fire_ignited: 12,
      fire_spread: 10,
      agent_injured: 8,
      structure_completed: 6,
      agent_collapsed: 6,
      crop_harvested: 3,
      agent_spoke: 2,
      item_moved: 1,
    })
  })

  it('scores per-agent 60-tick windows, skipping unlisted events', () => {
    const windows = score([
      ev(1, 2, 'agent_spoke', { agentId: 'alice', text: 'hi', x: 0, y: 0 }), // w0 alice +2
      ev(3, 50, 'agent_spoke', { agentId: 'alice', text: 'yo', x: 0, y: 0 }), // w0 alice +2
      ev(4, 59, 'agent_injured', { agentId: 'bob', kind: 'minor' }), // w0 bob +8 (last tick of w0)
      ev(5, 60, 'agent_spoke', { agentId: 'bob', text: 'ow', x: 0, y: 3 }), // w1 bob +2 (first tick of w1)
      ev(6, 70, 'agent_died', { agentId: 'dan', cause: 'hunger' }), // w1 dan +20
      ev(7, 71, 'tick_advanced', {}), // unlisted → 0
    ])
    expect(windows).toEqual([
      { fromTick: 0, toTick: 59, agentId: 'alice', score: 4 },
      { fromTick: 0, toTick: 59, agentId: 'bob', score: 8 },
      { fromTick: 60, toTick: 119, agentId: 'bob', score: 2 },
      { fromTick: 60, toTick: 119, agentId: 'dan', score: 20 },
    ])
  })

  /** MUTATION-PROVED: put the `payload.agentId ?? payload.builderId ?? null` scorer back and all
   *  five expectations below go to `[]`. */
  describe('★ the five weights that used to score nothing', () => {
    it('a fire is scored to the person who raised the place it is burning', () => {
      expect(
        score([
          plan(1, 0, 's1', 'omar'),
          ev(2, 10, 'structure_completed', { id: 's1' }), // omar +6
          ev(3, 20, 'fire_ignited', { structureId: 's1', cause: 'lightning' }), // omar +12
        ]),
      ).toEqual([{ fromTick: 0, toTick: 59, agentId: 'omar', score: 18 }])
    })

    it('a spreading fire pays the place it REACHES, so one fire cannot pay one person twice', () => {
      const windows = score([
        plan(1, 0, 's1', 'omar'),
        plan(2, 0, 's2', 'ana'),
        ev(3, 10, 'fire_ignited', { structureId: 's1', cause: 'lightning' }), // omar +12
        ev(4, 12, 'fire_spread', { fromId: 's1', toId: 's2' }), // ana  +10, omar +0
      ])
      expect(windows).toEqual([
        { fromTick: 0, toTick: 59, agentId: 'ana', score: 10 },
        { fromTick: 0, toTick: 59, agentId: 'omar', score: 12 },
      ])
    })

    it('a harvest is scored to the harvester, from the completion it is the result of', () => {
      // worldTick emits `action_completed` and then, with nothing in between, the verb's own
      // results — so the adjacency below is a fact about the emitter, not a guess.
      expect(
        score([
          ev(1, 5, 'action_completed', { agentId: 'ana', verb: 'harvest' }),
          ev(2, 5, 'crop_harvested', { cropId: 'c1' }), // ana +3
          ev(3, 5, 'item_spawned', {
            id: 'i1',
            kind: 'wheat',
            qty: 3,
            loc: { t: 'agent', id: 'ana' },
          }),
        ]),
      ).toEqual([{ fromTick: 0, toTick: 59, agentId: 'ana', score: 3 }])
    })

    it('an item moving into somebody’s hands is theirs; one scattered onto a tile is nobody’s', () => {
      expect(
        score([
          ev(1, 5, 'item_moved', { id: 'i1', loc: { t: 'agent', id: 'ana' } }), // ana +1
          ev(2, 6, 'item_moved', { id: 'i2', loc: { t: 'tile', x: 3, y: 4 } }), // the fire's, not a person's
          ev(3, 7, 'item_moved', { id: 'i3', loc: { t: 'structure', id: 's1' } }),
        ]),
      ).toEqual([{ fromTick: 0, toTick: 59, agentId: 'ana', score: 1 }])
    })

    it('scores nobody rather than guessing when the log names nobody at all', () => {
      // no plan, no completion in front of them — the honest answer is silence
      expect(
        score([
          ev(1, 0, 'fire_ignited', { structureId: 'ghost', cause: 'lightning' }),
          ev(2, 1, 'fire_spread', { fromId: 'ghost', toId: 'ghost2' }),
          ev(3, 2, 'structure_completed', { id: 'ghost' }),
          ev(4, 3, 'crop_harvested', { cropId: 'c1' }),
        ]),
      ).toEqual([])
    })
  })

  /** Nothing is emitted between `action_completed` and its verb's first result, so the one-event
   *  memory is exact — but it must not survive past those results. */
  it('the actor does not survive an event that is not its verb’s result', () => {
    expect(
      score([
        ev(1, 5, 'action_completed', { agentId: 'ana', verb: 'walk' }),
        ev(2, 5, 'agent_moved', { id: 'ana', x: 1, y: 1 }),
        ev(3, 6, 'crop_harvested', { cropId: 'c1' }), // not Ana's — nobody's
      ]),
    ).toEqual([])
  })

  it('returns [] for no events', () => {
    expect(score([])).toEqual([])
  })
})
