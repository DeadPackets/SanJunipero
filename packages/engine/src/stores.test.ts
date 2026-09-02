import { describe, it, expect } from 'vitest'
import { ADULT_AGE_DAYS, DEFAULT_CONFIG, type SimEvent } from '@sj/shared'
import { genesisState, type WorldState } from './state.js'
import { fold } from './fold.js'
import { composePerception } from './perception.js'
import { spoilDeadline } from './systems/spoilage.js'
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

const dropped = (
  s: WorldState,
  id: string,
  kind: string,
  qty: number,
  at: { x: number; y: number },
  owner = 'a1',
): WorldState =>
  put(s, ev('item_spawned', { id, kind, qty, loc: { t: 'tile', x: at.x, y: at.y }, owner }))

const shelved = (
  s: WorldState,
  id: string,
  kind: string,
  qty: number,
  into: string,
  owner = 'a1',
): WorldState =>
  put(s, ev('item_spawned', { id, kind, qty, loc: { t: 'structure', id: into }, owner }))

/** A house of a1's at (2, 2), the town storehouse at (20, 2), and a2's house at (26, 2). */
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
    s = shelved(s, 'item_4', 'fish', 1, 'house_2', 'a2')
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

  // Since Task 4 a couple's house carries one partner's name and the old cottage carries
  // nobody's. Where a founder lives is told by where their kit is, which is what genesis seats.
  it('names the roof it lives under, and whose name is on it', () => {
    let s = spawn(world(), 'a1', 4, 5)
    s = spawn(s, 'a2', 8, 5)
    s = structure(s, 'house_2', 'house', { x: 10, y: 2 }, { owner: 'a2' })
    s = shelved(s, 'item_1', 'bucket', 1, 'house_2')
    const p = composePerception(s, DEFAULT_CONFIG, 'a1', [])
    expect(p.stores).toEqual([
      {
        structureId: 'house_2',
        kind: 'house',
        ownerName: 'a2',
        yours: true,
        items: [{ kind: 'bucket', qty: 1 }],
      },
    ])
  })

  it('names a roof nobody owns that its own things are in', () => {
    let s = spawn(world(), 'a1', 4, 5)
    s = structure(s, 'cottage_1', 'cottage', { x: 10, y: 2 })
    s = shelved(s, 'item_1', 'bucket', 1, 'cottage_1')
    expect(composePerception(s, DEFAULT_CONFIG, 'a1', []).stores).toEqual([
      {
        structureId: 'cottage_1',
        kind: 'cottage',
        yours: true,
        items: [{ kind: 'bucket', qty: 1 }],
      },
    ])
  })

  // Everybody's grain is in it, and it is nobody's roof: "the storehouse", never "your storehouse".
  it('never calls the town store its own, however much of its own is on the shelves', () => {
    const s = shelved(town(), 'item_1', 'wood', 60, 'store_1')
    const store = composePerception(s, DEFAULT_CONFIG, 'a1', []).stores.find(
      (st) => st.structureId === 'store_1',
    )
    expect(store).toMatchObject({ kind: 'storehouse' })
    expect(store).not.toHaveProperty('yours')
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

// Bread keeps six days, and `spoilage.groundMultiplier` is a half.
describe('the ground is no place to keep food', () => {
  const BREAD = { spawnDay: 0, days: 6 }
  const loaf = (s: WorldState, loc: unknown): WorldState =>
    put(s, ev('item_spawned', { id: 'loaf', kind: 'bread', qty: 1, loc, spoilage: BREAD }))
  const deadlineOf = (s: WorldState): number | null =>
    spoilDeadline(s, s.items.loaf!, DEFAULT_CONFIG)

  it('halves the days of a loaf set down outdoors', () => {
    expect(deadlineOf(loaf(town(), { t: 'tile', x: 4, y: 4 }))).toBe(3)
  })

  it('leaves a loaf on a shelf and a loaf in the hands exactly as they were', () => {
    expect(deadlineOf(loaf(town(), { t: 'structure', id: 'house_1' }))).toBe(6)
    expect(deadlineOf(loaf(town(), { t: 'agent', id: 'a1' }))).toBe(6)
    expect(deadlineOf(loaf(town(), { t: 'structure', id: 'store_1' }))).toBe(12)
  })
})

// house_1 stands at (2, 2) and is two tiles by two, so its doorstep runs out to (5, 5).
describe('what is piling up on your own doorstep', () => {
  it('counts three of your own things by your own wall, and not two', () => {
    let s = dropped(town(), 'item_1', 'plank', 1, { x: 4, y: 4 })
    s = dropped(s, 'item_2', 'plank', 1, { x: 5, y: 4 })
    expect(composePerception(s, DEFAULT_CONFIG, 'a1', []).self.doorstep).toBeUndefined()
    s = dropped(s, 'item_3', 'plank', 1, { x: 5, y: 5 })
    expect(composePerception(s, DEFAULT_CONFIG, 'a1', []).self.doorstep).toEqual([
      { kind: 'plank', qty: 3 },
    ])
  })

  it('counts what is in a stack, and never what lies out past the doorstep', () => {
    const s = dropped(town(), 'item_1', 'plank', 4, { x: 4, y: 4 })
    expect(composePerception(s, DEFAULT_CONFIG, 'a1', []).self.doorstep).toEqual([
      { kind: 'plank', qty: 4 },
    ])
    const far = dropped(town(), 'item_1', 'plank', 4, { x: 6, y: 6 })
    expect(composePerception(far, DEFAULT_CONFIG, 'a1', []).self.doorstep).toBeUndefined()
  })

  // house_2 is a2's, at (26, 2), and a1 lives in it: its doorstep is a1's doorstep.
  it('counts the heap by the wall of the roof it lives under, whoever owns it', () => {
    let s = shelved(town(), 'item_kit', 'bucket', 1, 'house_2')
    s = dropped(s, 'item_1', 'plank', 3, { x: 28, y: 4 })
    expect(composePerception(s, DEFAULT_CONFIG, 'a1', []).self.doorstep).toEqual([
      { kind: 'plank', qty: 3 },
    ])
  })

  it("counts nothing of another's, and nothing by another's wall", () => {
    const theirs = dropped(town(), 'item_1', 'plank', 4, { x: 4, y: 4 }, 'a2')
    expect(composePerception(theirs, DEFAULT_CONFIG, 'a1', []).self.doorstep).toBeUndefined()
    const elsewhere = dropped(town(), 'item_2', 'plank', 4, { x: 28, y: 4 })
    expect(composePerception(elsewhere, DEFAULT_CONFIG, 'a1', []).self.doorstep).toBeUndefined()
  })
})
