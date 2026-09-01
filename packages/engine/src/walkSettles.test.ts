import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, type SimEvent } from '@sj/shared'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { RngStreams } from './rng.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { createWorldTick } from './worldTick.js'

const CHAR: Record<string, TileId> = { '.': 0, '~': 2, p: 8 }
const ev = (seq: number, type: string, payload: unknown): SimEvent => ({
  seq,
  tick: 0,
  type,
  payload,
})

const AGENT = 'a1'

function world(rows: string[], at: { x: number; y: number }): WorldState {
  const s = genesisState(
    DEFAULT_CONFIG,
    rows.map((row) => Array.from(row).map((c) => CHAR[c]!)),
  )
  return fold(s, ev(1, 'agent_spawned', { id: AGENT, name: AGENT, x: at.x, y: at.y, ageDays: 7300 }))
}

const OPEN = ['........', '........', '........', '........']

/** The walk, run to whatever end the world gives it, and every event it emitted on the way. */
function walkOut(
  start: WorldState,
  params: Record<string, unknown>,
): { state: WorldState; types: string[] } {
  const go = submitIntent(start, DEFAULT_CONFIG, AGENT, 'walk', params)
  expect(go.ok).toBe(true)
  if (!go.ok) throw new Error(go.reason)
  let state = start
  for (const e of go.events) state = fold(state, ev(2, e.type, e.payload), DEFAULT_CONFIG)
  const worldTick = createWorldTick(DEFAULT_CONFIG, new RngStreams('walk-settles'))
  const types: string[] = []
  for (let i = 0; i < 60 && state.agents[AGENT]!.activity !== null; i++) {
    const out = worldTick({ ...state, tick: state.tick + 1 })
    state = out.state
    for (const e of out.events) if (e.payload && (e.payload as { agentId?: string }).agentId === AGENT) types.push(e.type)
  }
  return { state, types }
}

describe('★ a walk that has nowhere to go', () => {
  // ★ 63 of rehearsal 5's refusals were a mind asked to walk to the tile under its own feet,
  // mostly because faster legs got it there before its picture of itself caught up. Refusing
  // spends the turn and teaches nothing; the body is already where it was sent.
  it('★ to the tile under your own feet is a walk that is simply over', () => {
    const start = world(OPEN, { x: 3, y: 2 })
    const { state, types } = walkOut(start, { x: 3, y: 2 })
    const body = state.agents[AGENT]!
    expect({ x: body.x, y: body.y }).toEqual({ x: 3, y: 2 })
    expect(body.activity).toBe(null)
    expect(types).toContain('action_completed')
    expect(types).not.toContain('action_interrupted')
  })

  it('still stops a body the world moved a wall in front of', () => {
    const start = world(OPEN, { x: 0, y: 0 })
    const go = submitIntent(start, DEFAULT_CONFIG, AGENT, 'walk', { x: 6, y: 3 })
    expect(go.ok).toBe(true)
    if (!go.ok) return
    let state = start
    for (const e of go.events) state = fold(state, ev(2, e.type, e.payload), DEFAULT_CONFIG)
    // The route is laid; wiping the path is the one way to stand a walk on no tiles at all.
    const a = state.agents[AGENT]!
    state = {
      ...state,
      agents: { ...state.agents, [AGENT]: { ...a, activity: { ...a.activity!, path: [] } } },
    }
    const out = createWorldTick(DEFAULT_CONFIG, new RngStreams('walk-settles'))({
      ...state,
      tick: state.tick + 1,
    })
    expect(out.events.map((e) => e.type)).toContain('action_interrupted')
  })
})
