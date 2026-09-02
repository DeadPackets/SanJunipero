import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { RngStreams } from './rng.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { ev } from './testutil/world.js'
import { composePerception } from './perception.js'
import { walkDestination, WALK_NO_ROAD } from './verbs/index.js'
import { createWorldTick } from './worldTick.js'

const CHAR: Record<string, TileId> = { '.': 0, '~': 2 }
const AGENT = 'a1'

function world(rows: string[], at: { x: number; y: number }): WorldState {
  const s = genesisState(
    DEFAULT_CONFIG,
    rows.map((row) => Array.from(row).map((c) => CHAR[c]!)),
  )
  return fold(s, ev('agent_spawned', { id: AGENT, name: AGENT, x: at.x, y: at.y, ageDays: 7300 }))
}

const OPEN = ['........', '........', '........', '........']
const SPLIT = ['..~..', '..~..', '..~..']
// Wide enough that the far side is nowhere near the near bank: a search that only looked in a
// box around the mark would find nothing but far-bank tiles and refuse.
const WIDE = Array.from({ length: 3 }, () => '.'.repeat(20) + '~' + '.'.repeat(19))

const start = (state: WorldState, params: Record<string, unknown>): WorldState => {
  const go = submitIntent(state, DEFAULT_CONFIG, AGENT, 'walk', params)
  expect(go.ok).toBe(true)
  if (!go.ok) throw new Error(go.reason)
  return go.events.reduce((s, e) => fold(s, ev(e.type, e.payload), DEFAULT_CONFIG), state)
}

describe('★ a walk that has nowhere to go', () => {
  // ★ 63 of rehearsal 5's refusals were a mind asked to walk to the tile under its own feet,
  // mostly because faster legs got it there before its picture of itself caught up. Refusing
  // spends the turn and teaches nothing; the body is already where it was sent.
  it('★ to the tile under your own feet is a walk that is simply over', () => {
    let state = start(world(OPEN, { x: 3, y: 2 }), { x: 3, y: 2 })
    const worldTick = createWorldTick(DEFAULT_CONFIG, new RngStreams('walk-settles'))
    const types: string[] = []
    for (let i = 0; i < 60 && state.agents[AGENT]!.activity !== null; i++) {
      const out = worldTick({ ...state, tick: state.tick + 1 })
      state = out.state
      types.push(...out.events.map((e) => e.type))
    }
    const body = state.agents[AGENT]!
    expect({ x: body.x, y: body.y }).toEqual({ x: 3, y: 2 })
    expect(body.activity).toBe(null)
    expect(types).toContain('action_completed')
    expect(types).not.toContain('action_interrupted')
  })

  // ★ World A's Nadia ended on array column 75, the last one the map has, and spent 36 of her
  // 41 refusals re-issuing a walk east into open space. World three's Nadia went one worse: her
  // four walks to that column all TOOK, and standing there told her nothing, so she chased east
  // bushes until a refusal finally named the rim. The legs go as far as there is ground, and the
  // body is told, on every turn it stands there, that it is standing on the last of it.
  it('★ walks to the edge of the world, and the body standing there is told so', () => {
    expect(
      walkDestination(world(OPEN, { x: 4, y: 2 }), DEFAULT_CONFIG, AGENT, { x: 40, y: 2 }),
    ).toEqual({ x: 7, y: 2 })

    const atEdge = start(world(OPEN, { x: 4, y: 2 }), { x: 40, y: 2 })
    expect(composePerception(atEdge, DEFAULT_CONFIG, AGENT, []).atRim).toBeUndefined()
    expect(composePerception(world(OPEN, { x: 7, y: 2 }), DEFAULT_CONFIG, AGENT, []).atRim).toBe(
      true,
    )
  })

  // ★ The rim is where a mark with no footing under it is answered with ground rather than a
  // refusal: there is nothing further out to name instead, so the last dry tile is the answer.
  it('★ settles onto the last dry tile when the rim itself is water', () => {
    expect(
      walkDestination(world(['....~', '....~', '....~'], { x: 0, y: 1 }), DEFAULT_CONFIG, AGENT, {
        x: 4,
        y: 1,
      }),
    ).toEqual({ x: 3, y: 1 })
  })

  // A far bank with no crossing: the legs reach the near one, and the second ask — made from
  // the bank, where it is finally true — is what says the water cannot be got past.
  it('★ walks to the near bank, then says there is no way through', () => {
    expect(
      walkDestination(world(SPLIT, { x: 0, y: 1 }), DEFAULT_CONFIG, AGENT, { x: 4, y: 1 }),
    ).toEqual({ x: 1, y: 1 })

    const onBank = world(SPLIT, { x: 1, y: 1 })
    expect(walkDestination(onBank, DEFAULT_CONFIG, AGENT, { x: 4, y: 1 })).toEqual({
      refusal: WALK_NO_ROAD,
    })
  })

  // ★ The bank is the answer however far off it is. Twenty tiles is further than any box a
  // search could afford to draw around the mark itself.
  it('★ finds the bank from twenty tiles away, not just from beside it', () => {
    expect(
      walkDestination(world(WIDE, { x: 0, y: 1 }), DEFAULT_CONFIG, AGENT, { x: 39, y: 1 }),
    ).toEqual({ x: 19, y: 1 })
  })

  // A mark with no footing under it is still a mark named wrong, and the affordance block
  // already tells a mind that wall and water take no walk of theirs.
  it('still names water as no footing rather than walking around it', () => {
    const r = submitIntent(world(SPLIT, { x: 0, y: 1 }), DEFAULT_CONFIG, AGENT, 'walk', {
      x: 2,
      y: 1,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no path to that spot')
  })

  it('still stops a body whose route was taken out from under it', () => {
    let state = start(world(OPEN, { x: 0, y: 0 }), { x: 6, y: 3 })
    // Wiping the path is the one way to stand a walk on no tiles with its clock still running.
    const a = state.agents[AGENT]!
    state = {
      ...state,
      agents: { ...state.agents, [AGENT]: { ...a, activity: { ...a.activity!, path: [] } } },
    }
    const out = createWorldTick(
      DEFAULT_CONFIG,
      new RngStreams('walk-settles'),
    )({
      ...state,
      tick: state.tick + 1,
    })
    expect(out.events.map((e) => e.type)).toContain('action_interrupted')
  })
})
