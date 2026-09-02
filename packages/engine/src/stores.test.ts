import { describe, it, expect } from 'vitest'
import { ADULT_AGE_DAYS, DEFAULT_CONFIG, type SimEvent } from '@sj/shared'
import { genesisState, type WorldState } from './state.js'
import { fold } from './fold.js'
import { composePerception } from './perception.js'
import { ev, grid } from './testutil/world.js'

// Where a mind's things are when they are not in its hands: the shelves it may use, and what
// each one holds. A store is known whether or not the body is standing in it.

const NOON = 720

const world = (): WorldState => ({ ...genesisState(DEFAULT_CONFIG, grid(32)), tick: NOON })

const put = (s: WorldState, e: SimEvent): WorldState => fold(s, e, DEFAULT_CONFIG)

const spawn = (s: WorldState, id: string, x: number, y: number): WorldState =>
  put(s, ev('agent_spawned', { id, name: id, x, y, ageDays: ADULT_AGE_DAYS }))

function structure(
  s: WorldState,
  id: string,
  kind: string,
  at: { x: number; y: number },
  extra: { owner?: string; name?: string } = {},
): WorldState {
  const planned = put(
    s,
    ev('structure_planned', {
      id,
      kind,
      x: at.x,
      y: at.y,
      w: 2,
      h: 2,
      maxHp: 20,
      flammable: true,
      builderId: extra.owner ?? 'a1',
      ...extra,
    }),
  )
  return put(planned, ev('structure_completed', { id }))
}

const shelved = (s: WorldState, id: string, kind: string, qty: number, into: string): WorldState =>
  put(s, ev('item_spawned', { id, kind, qty, loc: { t: 'structure', id: into }, owner: 'a1' }))

/** A house of a1's at (2, 2), the town storehouse at (20, 2), and a stranger's house at (26, 2). */
function town(): WorldState {
  let s = spawn(world(), 'a1', 4, 5)
  s = spawn(s, 'a2', 28, 5)
  s = structure(s, 'house_1', 'house', { x: 2, y: 2 }, { owner: 'a1' })
  s = structure(s, 'store_1', 'storehouse', { x: 20, y: 2 })
  s = structure(s, 'house_2', 'house', { x: 26, y: 2 }, { owner: 'a2' })
  return s
}

describe('the stores a mind may put things in', () => {
  it('names the house it owns and the town storehouse, never a house that is not its own', () => {
    let s = town()
    s = shelved(s, 'item_1', 'plank', 3, 'house_1')
    s = shelved(s, 'item_2', 'bread', 2, 'house_1')
    s = shelved(s, 'item_3', 'wood', 60, 'store_1')
    s = shelved(s, 'item_4', 'fish', 1, 'house_2')
    const p = composePerception(s, DEFAULT_CONFIG, 'a1', [])
    expect(p.stores).toEqual([
      {
        structureId: 'house_1',
        kind: 'house',
        yours: true,
        items: [
          { kind: 'plank', qty: 3 },
          { kind: 'bread', qty: 2 },
        ],
      },
      { structureId: 'store_1', kind: 'storehouse', items: [{ kind: 'wood', qty: 60 }] },
    ])
  })

  it('holds the same shelves from across the town, with the walls out of sight', () => {
    let s = shelved(town(), 'item_1', 'plank', 3, 'house_1')
    s = put(s, ev('agent_moved', { id: 'a1', x: 30, y: 30 }))
    const p = composePerception(s, DEFAULT_CONFIG, 'a1', [])
    expect(p.visible.structures).toEqual([])
    expect(p.stores.map((st) => st.structureId)).toEqual(['house_1', 'store_1'])
  })

  it('carries a name where the walls have one', () => {
    let s = spawn(world(), 'a1', 4, 5)
    s = structure(s, 'store_1', 'storehouse', { x: 20, y: 2 }, { name: 'the long barn' })
    const p = composePerception(s, DEFAULT_CONFIG, 'a1', [])
    expect(p.stores).toEqual([
      { structureId: 'store_1', kind: 'storehouse', name: 'the long barn', items: [] },
    ])
  })
})
