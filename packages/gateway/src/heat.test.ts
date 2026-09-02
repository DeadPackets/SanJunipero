import { describe, expect, it } from 'vitest'
import type { HeatWindow, SimEvent } from '@sj/shared'
import { FOLD_TYPES } from './api.js'
import {
  HEAT_WEIGHTS,
  HEAT_WINDOW_TICKS,
  SCENE_BONUS,
  SCENE_EARSHOT_TILES,
  heatContext,
  heatFromScores,
  scoreEvent,
  type HeatScores,
} from './heat.js'

const ev = (
  seq: number,
  tick: number,
  type: string,
  payload: Record<string, unknown>,
): SimEvent => ({ seq, tick, type, payload })

// The read path's own fold; see `readFold` in api.ts — there is no second scorer to drift.
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
      discovery_made: 12,
      fire_ignited: 12,
      law_ratified: 12,
      fire_spread: 10,
      law_broken: 9,
      agent_injured: 8,
      co_slept: 8,
      structure_completed: 6,
      agent_collapsed: 6,
      agent_spoke: 6,
      agent_expressed: 4,
      crop_harvested: 3,
      item_moved: 1,
    })
  })

  it('scores per-agent 60-tick windows, skipping unlisted events', () => {
    const windows = score([
      ev(1, 2, 'agent_spoke', { agentId: 'alice', text: 'hi', x: 0, y: 0 }), // w0 alice +6
      ev(3, 50, 'agent_spoke', { agentId: 'alice', text: 'yo', x: 0, y: 0 }), // w0 alice +6
      ev(4, 59, 'agent_injured', { agentId: 'bob', kind: 'minor' }), // w0 bob +8 (last tick of w0)
      ev(5, 60, 'agent_spoke', { agentId: 'bob', text: 'ow', x: 0, y: 3 }), // w1 bob +6 (first tick of w1)
      ev(6, 70, 'agent_died', { agentId: 'dan', cause: 'hunger' }), // w1 dan +20
      ev(7, 71, 'tick_advanced', {}), // unlisted → 0
    ])
    expect(windows).toEqual([
      { fromTick: 0, toTick: 59, agentId: 'alice', score: 12 },
      { fromTick: 0, toTick: 59, agentId: 'bob', score: 8 },
      { fromTick: 60, toTick: 119, agentId: 'bob', score: 6 },
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

  /** `api.ts` reads a log narrowed to the 12 types it consumes, so the rows that used to end the
   *  actor's run are no longer read at all — the gap in `seq` is what says they were there. */
  it('★ a gap in seq ends the actor’s run, so a narrowed log answers what the whole log did', () => {
    expect(
      score([
        ev(1, 5, 'action_completed', { agentId: 'ana', verb: 'walk' }),
        // seq 2 was an `agent_moved` the SELECT skipped
        ev(3, 6, 'crop_harvested', { cropId: 'c1' }), // not Ana's — nobody's
      ]),
    ).toEqual([])
  })

  it('★ scoring the narrowed log is scoring the whole log', () => {
    // One of every weighted type, a completion, its result, and the rows api.ts's SELECT drops.
    const log: SimEvent[] = [
      ev(1, 1, 'structure_planned', { id: 's1', kind: 'house', builderId: 'omar' }),
      ev(2, 2, 'needs_changed', { id: 'ana', changes: [{ need: 'hunger', delta: -1 }] }),
      ev(3, 3, 'action_completed', { agentId: 'ana', verb: 'harvest' }),
      ev(4, 3, 'crop_harvested', { cropId: 'c1' }),
      ev(5, 4, 'agent_moved', { id: 'ana', x: 1, y: 1 }),
      ev(6, 5, 'crop_harvested', { cropId: 'c2' }),
      ev(7, 6, 'action_completed', { agentId: 'omar', verb: 'build' }),
      ev(8, 6, 'needs_changed', { id: 'omar', changes: [{ need: 'energy', delta: -1 }] }),
      ev(9, 7, 'structure_completed', { id: 's1' }),
      ev(10, 8, 'agent_spoke', { agentId: 'ana', text: 'hi', x: 0, y: 0 }),
      ev(11, 9, 'agent_died', { agentId: 'dan', cause: 'hunger' }),
    ]
    const narrowed = log.filter((e) => FOLD_TYPES.includes(e.type))
    expect(narrowed.length, 'the filter must actually drop rows').toBeLessThan(log.length)
    expect(score(narrowed)).toEqual(score(log))
  })

  it('names every weighted type, or the fold reads a row its SELECT never fetched', () => {
    for (const type of Object.keys(HEAT_WEIGHTS)) expect(FOLD_TYPES).toContain(type)
  })

  it('returns [] for no events', () => {
    expect(score([])).toEqual([])
  })

  /** ★ The scorer optimised for catastrophe: a death, a fire and an injury outranked everything
   *  a person could say, so in a healthy town the heat was flat and the camera fell back to a
   *  carousel that held one face for two real minutes. */
  describe('★ the cut lands on talk and change, not on disaster', () => {
    const spoke = (seq: number, tick: number, agentId: string, x: number, y: number): SimEvent =>
      ev(seq, tick, 'agent_spoke', { agentId, text: 'hm', x, y })
    const best = (windows: HeatWindow[], agentId: string): number =>
      Math.max(0, ...windows.filter((w) => w.agentId === agentId).map((w) => w.score))

    it('★ a two-person exchange outranks a lone harvester', () => {
      const windows = score([
        spoke(1, 1, 'amara', 0, 0),
        spoke(2, 3, 'yusuf', 1, 0),
        spoke(3, 5, 'amara', 0, 0),
        ev(4, 6, 'action_completed', { agentId: 'omar', verb: 'harvest' }),
        ev(5, 6, 'crop_harvested', { cropId: 'c1' }),
        ev(6, 7, 'action_completed', { agentId: 'omar', verb: 'harvest' }),
        ev(7, 7, 'crop_harvested', { cropId: 'c2' }),
        ev(8, 8, 'action_completed', { agentId: 'omar', verb: 'harvest' }),
        ev(9, 8, 'crop_harvested', { cropId: 'c3' }),
      ])
      expect(best(windows, 'amara')).toBe(6 + 6 + SCENE_BONUS)
      expect(best(windows, 'yusuf')).toBe(6 + SCENE_BONUS)
      expect(best(windows, 'omar')).toBe(9)
      expect(best(windows, 'yusuf')).toBeGreaterThan(best(windows, 'omar'))
    })

    it('★ a storm no longer outranks a talk: one fire is not two voices', () => {
      const windows = score([
        plan(1, 0, 's1', 'omar'),
        ev(2, 4, 'fire_ignited', { structureId: 's1', cause: 'lightning' }), // omar +12
        spoke(3, 5, 'amara', 4, 4),
        spoke(4, 6, 'yusuf', 5, 4),
      ])
      expect(best(windows, 'amara')).toBeGreaterThan(best(windows, 'omar'))
      expect(best(windows, 'yusuf')).toBeGreaterThan(best(windows, 'omar'))
    })

    it('pays the bonus ONCE a window to each voice, however long the exchange runs', () => {
      const windows = score([
        spoke(1, 1, 'amara', 0, 0),
        spoke(2, 2, 'yusuf', 1, 0),
        spoke(3, 3, 'amara', 0, 0),
        spoke(4, 4, 'yusuf', 1, 0),
        spoke(5, 5, 'amara', 0, 0),
      ])
      expect(best(windows, 'amara')).toBe(3 * 6 + SCENE_BONUS)
      expect(best(windows, 'yusuf')).toBe(2 * 6 + SCENE_BONUS)
    })

    it('pays nobody for talking to themselves, or for shouting out of earshot', () => {
      expect(
        score([spoke(1, 1, 'amara', 0, 0), spoke(2, 2, 'amara', 0, 0)]).map((w) => w.score),
      ).toEqual([12])
      expect(
        score([
          spoke(1, 1, 'amara', 0, 0),
          spoke(2, 2, 'yusuf', SCENE_EARSHOT_TILES + 1, 0),
        ]).map((w) => w.score),
      ).toEqual([6, 6])
    })

    it('★ a scene belongs to its own window: two voices either side of the seam are two solos', () => {
      const windows = score([spoke(1, 59, 'amara', 0, 0), spoke(2, 60, 'yusuf', 0, 0)])
      expect(windows).toEqual([
        { fromTick: 0, toTick: 59, agentId: 'amara', score: 6 },
        { fromTick: 60, toTick: 119, agentId: 'yusuf', score: 6 },
      ])
    })

    it('names the person behind each of the five new weights the log calls something else', () => {
      expect(
        score([
          ev(1, 1, 'discovery_made', {
            recipeId: 'r1',
            name: 'smoked fish',
            kind: 'craft',
            byId: 'ana',
            intent: 'keep the catch',
            makes: ['smoked_fish'],
          }),
          ev(2, 2, 'agent_expressed', { agentId: 'ana', verb: 'toast', x: 0, y: 0 }),
          ev(3, 3, 'co_slept', { aId: 'ana', bId: 'omar', day: 1 }),
          ev(4, 4, 'law_ratified', { agentId: 'ana', lawId: 'l1' }),
          ev(5, 5, 'law_broken', { agentId: 'ana', lawId: 'l1', verb: 'take' }),
        ]),
      ).toEqual([{ fromTick: 0, toTick: 59, agentId: 'ana', score: 12 + 4 + 8 + 12 + 9 }])
    })
  })
})
