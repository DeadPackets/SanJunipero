import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, NO_PARAMS, type SimEvent } from '@sj/shared'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { loneCandidateFor, markUnderAnotherKey } from './verbs/autofill.js'

const CHAR_TILE: Record<string, TileId> = { '.': 0, '~': 2 }
let seq = 1
const ev = (type: string, payload: unknown): SimEvent => ({ seq: seq++, tick: 0, type, payload })

const OPEN = ['........', '........', '........', '........', '........', '........']

function world(rows: string[] = OPEN): WorldState {
  return genesisState(
    DEFAULT_CONFIG,
    rows.map((row) => Array.from(row).map((c) => CHAR_TILE[c]!)),
  )
}

function withAgent(s: WorldState, x: number, y: number): WorldState {
  return fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x, y, ageDays: 7300 }))
}

function holding(s: WorldState, id: string, kind: string, charges?: number): WorldState {
  return fold(
    s,
    ev('item_spawned', {
      id,
      kind,
      qty: 1,
      ...(charges === undefined ? {} : { charges }),
      loc: { t: 'agent', id: 'a1' },
    }),
  )
}

// A complete 2x2 house whose door lands one row south of its footprint.
function withHouse(s: WorldState, id: string, x: number): WorldState {
  const planned = fold(
    s,
    ev('structure_planned', {
      id,
      kind: 'house',
      x,
      y: 1,
      w: 2,
      h: 2,
      maxHp: 50,
      flammable: true,
      builderId: 'a1',
    }),
  )
  return fold(planned, ev('structure_completed', { id }))
}

const fill = (s: WorldState, verb: string, params: Record<string, unknown> = {}) =>
  loneCandidateFor(s, DEFAULT_CONFIG, 'a1', verb, params)

describe('loneCandidateFor', () => {
  it('fills eat from the one edible thing in the satchel', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    expect(fill(s, 'eat')).toEqual({ itemId: 'item_bread_1' })
  })

  it('leaves eat alone when two things in the satchel are edible', () => {
    let s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    s = holding(s, 'item_fish_2', 'fish')
    expect(fill(s, 'eat')).toBeNull()
  })

  it('leaves eat alone when nothing held is edible, and when the food is already named', () => {
    const empty = holding(withAgent(world(), 1, 1), 'item_axe_1', 'axe')
    expect(fill(empty, 'eat')).toBeNull()
    const one = holding(empty, 'item_bread_1', 'bread')
    expect(fill(one, 'eat', { itemId: 'item_bread_1' })).toBeNull()
  })

  it('fills enter from the one door within reach, and not from two', () => {
    const one = withHouse(withAgent(world(), 2, 3), 'structure_1', 2)
    expect(fill(one, 'enter')).toEqual({ structureId: 'structure_1' })
    const two = withHouse(withHouse(withAgent(world(), 3, 3), 'structure_1', 2), 'structure_2', 4)
    expect(fill(two, 'enter')).toBeNull()
  })
})

const rekey = (s: WorldState, verb: string, params: Record<string, unknown>) =>
  markUnderAnotherKey(s, DEFAULT_CONFIG, 'a1', verb, params)

describe('markUnderAnotherKey', () => {
  it('reads the mark the act named under a word the verb does not use', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    expect(rekey(s, 'eat', { targetId: 'item_bread_1' })).toEqual({ itemId: 'item_bread_1' })
  })

  it('reads a building named under the wrong word too, not only a held thing', () => {
    const s = withHouse(withAgent(world(), 2, 3), 'structure_1', 2)
    expect(rekey(s, 'enter', { itemId: 'structure_1' })).toEqual({ structureId: 'structure_1' })
  })

  it('does not guess when two marks are named', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    expect(rekey(s, 'eat', { targetId: 'item_bread_1', nodeId: 'item_bread_1' })).toBeNull()
  })

  it('leaves an act that named its own object, and one that named nothing', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    expect(rekey(s, 'eat', { itemId: 'item_bread_1' })).toBeNull()
    expect(rekey(s, 'eat', {})).toBeNull()
  })

  it('never reads words or numbers as a mark', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    expect(rekey(s, 'eat', { text: 'item_bread_1' })).toBeNull()
    expect(rekey(s, 'walk', { x: 1 })).toBeNull()
  })

  it('leaves a mark that fits nowhere, so the world still refuses it', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    expect(rekey(s, 'eat', { targetId: 'item_nothing' })).toBeNull()
    expect(rekey(s, 'sneeze', { targetId: 'item_bread_1' })).toBeNull()
  })
})

describe('submitIntent', () => {
  it('starts the filled act as if the mind had named the loaf', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'eat', {})
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const started = r.events.find((e) => e.type === 'action_started')!
    expect(started.payload).toMatchObject({
      verb: 'eat',
      params: { itemId: 'item_bread_1' },
    })
  })

  it('reaches for the one skin only when there is no water to kneel at', () => {
    const dry = holding(withAgent(world(), 1, 1), 'item_skin_1', 'waterskin', 1)
    const started = (s: WorldState) => {
      const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'drink', {})
      expect(r.ok).toBe(true)
      return r.ok
        ? (r.events.find((e) => e.type === 'action_started')!.payload as {
            params: Record<string, unknown>
          })
        : null
    }
    expect(started(dry)!.params).toEqual({ itemId: 'item_skin_1' })
    // At the bank the paramless act is already good, so nothing is read into it.
    const bank = holding(withAgent(world(['.~......', '........']), 1, 1), 'i2', 'waterskin', 1)
    expect(started(bank)!.params).toEqual({})
  })

  it('starts the act on the mark it named, whatever word it arrived under', () => {
    let s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    s = holding(s, 'item_fish_2', 'fish')
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'eat', { targetId: 'item_fish_2' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Two edibles, so nothing could have been read in: only the mind's own naming got this act
    // started, and it got the fish it asked for rather than the loaf.
    expect(r.events.find((e) => e.type === 'action_started')!.payload).toMatchObject({
      verb: 'eat',
      params: { itemId: 'item_fish_2' },
    })
  })

  // The closed grammar answers every key it did not use with null, and a verdict handed straight
  // to the world arrives that way. A null is no mark, so the readings below are the same ones.
  it('reads a params object filled with nulls exactly as one that named nothing', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'eat', { ...NO_PARAMS })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.events.find((e) => e.type === 'action_started')!.payload).toMatchObject({
      verb: 'eat',
      params: { itemId: 'item_bread_1' },
    })
    // And the one mark it did name is still read off a body of nulls, under the wrong word.
    const named = submitIntent(s, DEFAULT_CONFIG, 'a1', 'eat', {
      ...NO_PARAMS,
      targetId: 'item_bread_1',
    })
    expect(named.ok).toBe(true)
    if (!named.ok) return
    expect(named.events.find((e) => e.type === 'action_started')!.payload).toMatchObject({
      params: { itemId: 'item_bread_1' },
    })
  })

  it('still refuses an act the world cannot read one way, and names the two readings', () => {
    let s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    s = holding(s, 'item_fish_2', 'fish')
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'eat', {})).toEqual({
      ok: false,
      reason: 'which one — the bread (item_bread_1) or the fish (item_fish_2)?',
    })
  })
})
