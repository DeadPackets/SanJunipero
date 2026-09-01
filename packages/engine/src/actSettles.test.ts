import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, stateHash, type SimEvent } from '@sj/shared'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { RngStreams } from './rng.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { createWorldTick } from './worldTick.js'

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

describe('★ an act refused only for the distance is a walk with the act on its end', () => {
  // ★ A mind that names a thing it can see is not asking for a lecture on how far away it is.
  it('★ walk-then-take crosses the clearing and lifts the thing', () => {
    const start = put(world(), 'item_spawned', {
      id: 'item_1',
      kind: 'wood',
      qty: 1,
      loc: { t: 'tile', x: 5, y: 3 },
    })
    const go = submitIntent(start, CFG, 'a1', 'take', { itemId: 'item_1' })
    expect(go.ok).toBe(true)
    if (!go.ok) return
    expect(go.events[0]!.payload).toMatchObject({
      verb: 'walk',
      then: { verb: 'take', params: { itemId: 'item_1' } },
    })

    let state = go.events.reduce((s, e) => fold(s, ev(e.type, e.payload), CFG), start)
    const worldTick = createWorldTick(CFG, new RngStreams('walk-then-take'))
    const types: string[] = []
    for (let i = 0; i < 40 && state.items.item_1!.loc.t !== 'agent'; i++) {
      const out = worldTick({ ...state, tick: state.tick + 1 })
      state = out.state
      types.push(...out.events.map((e) => e.type))
    }
    // The legs are seen to go, and the taking is its own act on the ledger after them.
    expect(state.items.item_1!.loc).toEqual({ t: 'agent', id: 'a1' })
    expect(types).toContain('agent_moved')
    expect(types.filter((t) => t === 'action_started')).toHaveLength(1)
    expect(types.filter((t) => t === 'action_completed')).toHaveLength(2)
    expect(state.agents.a1!.activity).toBe(null)
  })

  it('★ a thing across water with no crossing is still too far to take', () => {
    const split = put(world(['..~..', '..~..', '..~..'], { x: 0, y: 1 }), 'item_spawned', {
      id: 'item_1',
      kind: 'wood',
      qty: 1,
      loc: { t: 'tile', x: 4, y: 1 },
    })
    expect(refuses(split, 'take', { itemId: 'item_1' })).toBe('not close enough to take')
  })

  // What the world holds against the act itself is not a distance, and no walk answers it.
  it('a thing in another pair of hands is refused wherever the feet are', () => {
    let two = put(world(), 'agent_spawned', { id: 'a2', name: 'a2', x: 5, y: 3, ageDays: 7300 })
    two = put(two, 'item_spawned', {
      id: 'item_1',
      kind: 'wood',
      qty: 1,
      loc: { t: 'agent', id: 'a2' },
    })
    expect(refuses(two, 'take', { itemId: 'item_1' })).toBe('someone is holding that')
  })
})

/** The act the world read out of what the mind wrote. */
function reads(state: WorldState, verb: string, params: Record<string, unknown>): unknown {
  const r = submitIntent(state, CFG, 'a1', verb, params)
  expect(r.ok).toBe(true)
  if (!r.ok) return null
  const started = r.events.find((e) => e.type === 'action_started')!.payload as {
    verb: string
    params: Record<string, unknown>
    then?: { verb: string; params: Record<string, unknown> }
  }
  return started.then?.params ?? started.params
}

const wood = (s: WorldState, id: string, x: number, y: number): WorldState =>
  put(s, 'item_spawned', { id, kind: 'wood', qty: 1, loc: { t: 'tile', x, y } })

describe('★ a mark is read the way a person would read it', () => {
  // ★ 25 of rehearsal 2's refusals were `no such item` for a mind that wrote what the thing was
  // instead of which one it was. A kind names a thing: the one in the hands, else the nearest.
  it('★ a kind word is the nearest one of that kind, and the same one every time', () => {
    const two = wood(wood(world(), 'item_1', 6, 3), 'item_2', 2, 1)
    expect(reads(two, 'take', { itemId: 'wood' })).toMatchObject({ itemId: 'item_2' })
  })

  it('★ and the one already in the hands outranks the one on the ground', () => {
    const both = wood(held(world(), 'item_1', 'wood'), 'item_2', 1, 0)
    expect(reads(both, 'drop', { itemId: 'wood' })).toMatchObject({ itemId: 'item_1' })
  })

  // Two things the act fits equally is a question, not a coin toss.
  it('★ a mark left blank with two readings names them both and asks', () => {
    let s = held(world(), 'item_1', 'bread')
    s = held(s, 'item_2', 'fish')
    expect(refuses(s, 'eat', {})).toBe('which one — the bread (item_1) or the fish (item_2)?')
  })

  it('and one reading only is simply read in', () => {
    expect(reads(held(world(), 'item_1', 'bread'), 'eat', {})).toMatchObject({ itemId: 'item_1' })
  })

  // ★ ~20 refusals were a cast at water the mind had guessed the coordinates of.
  it('★ water guessed wrong is the nearest water there is', () => {
    const river = world(['....~...', '....~...', '....~...', '....~...'], { x: 0, y: 0 })
    expect(reads(river, 'fish', { x: 1, y: 1 })).toMatchObject({ x: 4, y: 0 })
  })

  it('a mark written as an empty word is no mark at all', () => {
    expect(reads(held(world(), 'item_1', 'garment'), 'wear', { itemId: '' })).toMatchObject({
      itemId: 'item_1',
    })
  })
})

describe('★ four walls are the first thing in the way, and the door answers that one', () => {
  // ★ Seven of rehearsal 2's refusals were a mind under a roof told to step outside first, which
  // it had no turn left to do. The way out is an act, and the act it was for rides on its end.
  it('★ a thing outside is fetched by a body indoors: out, over, and lifted', () => {
    let start = withHouse(world(OPEN, { x: 2, y: 3 }))
    start = put(start, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' })
    start = put(start, 'item_spawned', {
      id: 'item_1',
      kind: 'wood',
      qty: 1,
      loc: { t: 'tile', x: 6, y: 5 },
    })
    const go = submitIntent(start, CFG, 'a1', 'take', { itemId: 'item_1' })
    expect(go.ok).toBe(true)
    if (!go.ok) return
    expect(go.events[0]!.payload).toMatchObject({
      verb: 'exit',
      then: { verb: 'take', params: { itemId: 'item_1' } },
    })

    let state = go.events.reduce((s, e) => fold(s, ev(e.type, e.payload), CFG), start)
    const worldTick = createWorldTick(CFG, new RngStreams('out-over-lifted'))
    const verbs: string[] = []
    for (let i = 0; i < 40 && state.items.item_1!.loc.t !== 'agent'; i++) {
      const out = worldTick({ ...state, tick: state.tick + 1 })
      state = out.state
      for (const e of out.events) {
        if (e.type === 'action_started') verbs.push((e.payload as { verb: string }).verb)
      }
    }
    // One ask, three acts, each of them its own on the ledger.
    expect(verbs).toEqual(['walk', 'take'])
    expect(state.agents.a1!.insideId).toBeUndefined()
    expect(state.items.item_1!.loc).toEqual({ t: 'agent', id: 'a1' })
  })
})
