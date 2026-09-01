import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, stateHash, type SimEvent } from '@sj/shared'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { genesisState, type TileId, type WorldState } from './state.js'

const CFG = DEFAULT_CONFIG
const CHAR: Record<string, TileId> = { '.': 0, '~': 2, f: 6, r: 7 }
let seq = 1
const ev = (type: string, payload: unknown): SimEvent => ({ seq: seq++, tick: 0, type, payload })

const OPEN = ['........', '........', '........', '........', '........', '........']

function world(rows: string[] = OPEN, at = { x: 0, y: 0 }): WorldState {
  const s = genesisState(
    CFG,
    rows.map((row) => Array.from(row).map((c) => CHAR[c]!)),
  )
  return fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: at.x, y: at.y, ageDays: 7300 }))
}

const put = (s: WorldState, type: string, payload: unknown): WorldState =>
  fold(s, ev(type, payload), CFG)

// A 2x2 house at (2,1), door at (2,3) — the same one interiors.test raises.
function withHouse(s: WorldState, id = 'structure_1', x = 2): WorldState {
  const planned = put(s, 'structure_planned', {
    id,
    kind: 'house',
    x,
    y: 1,
    w: 2,
    h: 2,
    maxHp: 50,
    flammable: true,
    builderId: 'a1',
  })
  return put(planned, 'structure_completed', { id })
}

const held = (s: WorldState, id: string, kind: string): WorldState =>
  put(s, 'item_spawned', { id, kind, qty: 1, loc: { t: 'agent', id: 'a1' } })

/** An act the world lets stand for nothing: it starts, it completes, and the world it was asked
 *  to bring about is the world that was already there. */
function settles(state: WorldState, verb: string, params: Record<string, unknown> = {}): void {
  const r = submitIntent(state, CFG, 'a1', verb, params)
  expect(r.ok).toBe(true)
  if (!r.ok) return
  expect(r.events.map((e) => e.type)).toEqual(['action_started', 'action_completed'])
  expect(r.events[0]!.payload).toMatchObject({ agentId: 'a1', verb, duration: 0 })
  const after = r.events.reduce((s, e) => fold(s, ev(e.type, e.payload), CFG), state)
  expect(after.agents.a1!.activity).toBe(null)
  expect(stateHash(after)).toBe(stateHash(state))
}

function refuses(state: WorldState, verb: string, params: Record<string, unknown>): string {
  const r = submitIntent(state, CFG, 'a1', verb, params)
  expect(r.ok).toBe(false)
  return r.ok ? '' : r.reason
}

describe('★ an act whose end the world already holds is over, not refused', () => {
  // ★ 43 of rehearsal 2's 440 refusals were a body told to become what it already was: asleep
  // and sent to sleep, indoors and sent in. The turn was spent teaching nothing.
  it('★ sleep while asleep, and wake while awake', () => {
    const awake = world()
    settles(awake, 'wake')
    settles(put(awake, 'agent_slept', { agentId: 'a1' }), 'sleep')
  })

  it('★ enter the roof you are under, and exit the open sky', () => {
    const outside = withHouse(world(OPEN, { x: 2, y: 3 }))
    settles(outside, 'exit')
    const inside = put(outside, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' })
    settles(inside, 'enter', { structureId: 'structure_1' })
  })

  // Another roof is another act: the walls are still in the way, and the refusal still teaches it.
  it('a second house is not the one you are standing in', () => {
    const two = withHouse(withHouse(world(OPEN, { x: 2, y: 3 })), 'structure_2', 5)
    const inside = put(two, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' })
    expect(refuses(inside, 'enter', { structureId: 'structure_2' })).toBe('already inside')
  })

  it('★ take what is in your hands, and drop what is at your feet', () => {
    settles(held(world(), 'item_1', 'wood'), 'take', { itemId: 'item_1' })
    const down = put(world(), 'item_spawned', {
      id: 'item_1',
      kind: 'wood',
      qty: 1,
      loc: { t: 'tile', x: 0, y: 0 },
    })
    settles(down, 'drop', { itemId: 'item_1' })
  })

  // A thing on the ground two paces off is not at these feet: that drop has never been possible.
  it('a thing lying elsewhere is not already down here', () => {
    const yonder = put(world(), 'item_spawned', {
      id: 'item_1',
      kind: 'wood',
      qty: 1,
      loc: { t: 'tile', x: 4, y: 4 },
    })
    expect(refuses(yonder, 'drop', { itemId: 'item_1' })).toBe('that is already on the ground')
  })

  it('★ stow into the store it is already in', () => {
    const stored = put(withHouse(world(OPEN, { x: 2, y: 3 })), 'item_spawned', {
      id: 'item_1',
      kind: 'wood',
      qty: 1,
      loc: { t: 'structure', id: 'structure_1' },
    })
    settles(stored, 'stow', { itemId: 'item_1', structureId: 'structure_1' })
  })

  it('★ wear what is worn, and doff what is off', () => {
    const bare = held(world(), 'item_1', 'garment')
    settles(bare, 'doff')
    const worn = put(bare, 'item_equipped', { agentId: 'a1', itemId: 'item_1', slot: 'body' })
    settles(worn, 'wear', { itemId: 'item_1' })
  })

  it('★ kindle what burns, and snuff what does not', () => {
    const torch = held(world(), 'item_1', 'torch')
    settles(torch, 'snuff', { itemId: 'item_1' })
    const lit = put(torch, 'item_lit', { itemId: 'item_1', burnsUntilTick: 500 })
    settles(lit, 'kindle', { itemId: 'item_1' })
  })

  it('★ till the farmland, and pave the road', () => {
    settles(world(['ff......', '........'], { x: 0, y: 0 }), 'till', { x: 1, y: 0 })
    settles(world(['rr......', '........'], { x: 0, y: 0 }), 'pave', { x: 1, y: 0 })
  })

  // The line between a world already so and a world that never was: only the first is settled.
  it('a house that was never built is still nothing to enter', () => {
    expect(refuses(world(), 'enter', { structureId: 'structure_9' })).toBe(
      'there is nothing there to enter',
    )
  })
})
