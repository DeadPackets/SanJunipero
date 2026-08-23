import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, type SimEvent } from '@sj/shared'
import { genesisState } from './state.js'
import { fold } from './fold.js'

const ev = (seq: number, type: string, payload: unknown, tick = 0): SimEvent => ({ seq, tick, type, payload })
const spawnItem = (id: string, qty = 5) => ev(1, 'item_spawned', { id, kind: 'wood', qty, loc: { t: 'tile', x: 1, y: 1 } })
const plan = (id: string, x = 0, y = 0, w = 2, h = 2) =>
  ev(1, 'structure_planned', { id, kind: 'house', x, y, w, h, maxHp: 50, flammable: true, builderId: 'a1' })

describe('fold items', () => {
  it('spawns an item', () => {
    const s = fold(genesisState(DEFAULT_CONFIG), spawnItem('item_1', 3))
    expect(s.items.item_1).toEqual({ id: 'item_1', kind: 'wood', qty: 3, loc: { t: 'tile', x: 1, y: 1 } })
    expect(s.counters.nextEntityId).toBe(2)
  })
  it('moves an item across loc kinds', () => {
    let s = fold(genesisState(DEFAULT_CONFIG), spawnItem('item_1'))
    s = fold(s, ev(2, 'item_moved', { id: 'item_1', loc: { t: 'agent', id: 'a1' } }))
    expect(s.items.item_1!.loc).toEqual({ t: 'agent', id: 'a1' })
    s = fold(s, ev(3, 'item_moved', { id: 'item_1', loc: { t: 'structure', id: 'structure_1' } }))
    expect(s.items.item_1!.loc).toEqual({ t: 'structure', id: 'structure_1' })
  })
  it('changes qty and auto-removes at qty <= 0', () => {
    let s = fold(genesisState(DEFAULT_CONFIG), spawnItem('item_1', 5))
    s = fold(s, ev(2, 'item_qty_changed', { id: 'item_1', delta: -2 }))
    expect(s.items.item_1!.qty).toBe(3)
    s = fold(s, ev(3, 'item_qty_changed', { id: 'item_1', delta: -3 }))
    expect(s.items.item_1).toBeUndefined()
  })
  it('throws on item events for unknown items', () => {
    const s = genesisState(DEFAULT_CONFIG)
    expect(() => fold(s, ev(1, 'item_moved', { id: 'nope', loc: { t: 'tile', x: 0, y: 0 } }))).toThrow(/unknown item/i)
    expect(() => fold(s, ev(1, 'item_qty_changed', { id: 'nope', delta: -1 }))).toThrow(/unknown item/i)
    expect(() => fold(s, ev(1, 'item_worn', { id: 'nope', delta: -1 }))).toThrow(/unknown item/i)
    expect(() => fold(s, ev(1, 'item_broke', { id: 'nope' }))).toThrow(/unknown item/i)
    expect(() => fold(s, ev(1, 'item_spoiled', { id: 'nope' }))).toThrow(/unknown item/i)
  })
  it('wears a tool down and breaks it, leaving the durability-free alone', () => {
    const rod = ev(1, 'item_spawned', { id: 'item_1', kind: 'rod', qty: 1, loc: { t: 'agent', id: 'a1' }, durability: 3 })
    let s = fold(genesisState(DEFAULT_CONFIG), rod)
    expect(s.items.item_1!.durability).toBe(3)
    s = fold(s, ev(2, 'item_worn', { id: 'item_1', delta: -2 }))
    expect(s.items.item_1!.durability).toBe(1)
    s = fold(s, ev(3, 'item_broke', { id: 'item_1' }))
    expect(s.items.item_1).toBeUndefined()

    const plain = fold(genesisState(DEFAULT_CONFIG), spawnItem('item_2'))
    expect(plain.items.item_2).not.toHaveProperty('durability')
    expect(() => fold(plain, ev(2, 'item_worn', { id: 'item_2', delta: -1 }))).toThrow(/no durability/i)
  })
  it('strict payloads reject extra keys on item events', () => {
    const s = fold(genesisState(DEFAULT_CONFIG), spawnItem('item_1'))
    expect(() => fold(s, ev(2, 'item_spawned', { id: 'item_2', kind: 'wood', qty: 1, loc: { t: 'tile', x: 0, y: 0 }, extra: 1 }))).toThrow()
    expect(() => fold(s, ev(2, 'item_moved', { id: 'item_1', loc: { t: 'tile', x: 0, y: 0, extra: 1 } }))).toThrow()
    expect(() => fold(s, ev(2, 'item_qty_changed', { id: 'item_1', delta: -1, extra: 1 }))).toThrow()
  })
})

describe('fold structures', () => {
  it('plans a structure at stage construction with hp 1', () => {
    const s = fold(genesisState(DEFAULT_CONFIG), plan('structure_1'))
    expect(s.structures.structure_1).toEqual({
      id: 'structure_1', kind: 'house', x: 0, y: 0, w: 2, h: 2,
      hp: 1, maxHp: 50, flammable: true, stage: 'construction',
      progressTicks: 0, builtBy: 'a1', burning: false, burnTicks: 0,
    })
    expect(s.counters.nextEntityId).toBe(2)
  })
  it('progresses then completes: hp goes to maxHp, stage complete', () => {
    let s = fold(genesisState(DEFAULT_CONFIG), plan('structure_1'))
    s = fold(s, ev(2, 'structure_progressed', { id: 'structure_1', ticks: 4 }))
    s = fold(s, ev(3, 'structure_progressed', { id: 'structure_1', ticks: 3 }))
    expect(s.structures.structure_1!.progressTicks).toBe(7)
    s = fold(s, ev(4, 'structure_completed', { id: 'structure_1' }))
    expect(s.structures.structure_1).toMatchObject({ stage: 'complete', hp: 50 })
  })
  it('damage reduces hp; at 0 the structure is removed', () => {
    let s = fold(genesisState(DEFAULT_CONFIG), plan('structure_1'))
    s = fold(s, ev(2, 'structure_completed', { id: 'structure_1' }))
    s = fold(s, ev(3, 'structure_damaged', { id: 'structure_1', amount: 20 }))
    expect(s.structures.structure_1!.hp).toBe(30)
    s = fold(s, ev(4, 'structure_damaged', { id: 'structure_1', amount: 30 }))
    expect(s.structures.structure_1).toBeUndefined()
  })
  it('structure_destroyed removes the structure', () => {
    let s = fold(genesisState(DEFAULT_CONFIG), plan('structure_1'))
    s = fold(s, ev(2, 'structure_destroyed', { id: 'structure_1' }))
    expect(s.structures.structure_1).toBeUndefined()
  })
  it('rejects a plan whose footprint overlaps an existing structure', () => {
    const s = fold(genesisState(DEFAULT_CONFIG), plan('structure_1', 2, 2, 3, 3))
    expect(() => fold(s, plan('structure_2', 4, 4, 2, 2))).toThrow(/overlap/i)
    expect(() => fold(s, plan('structure_2', 0, 0, 3, 3))).toThrow(/overlap/i)
  })
  it('accepts a plan that only touches edges (no overlap)', () => {
    let s = fold(genesisState(DEFAULT_CONFIG), plan('structure_1', 2, 2, 3, 3))
    s = fold(s, plan('structure_2', 5, 2, 2, 2))
    s = fold(s, plan('structure_3', 2, 5, 3, 2))
    expect(Object.keys(s.structures)).toHaveLength(3)
  })
  it('throws on structure events for unknown structures', () => {
    const s = genesisState(DEFAULT_CONFIG)
    expect(() => fold(s, ev(1, 'structure_progressed', { id: 'nope', ticks: 1 }))).toThrow(/unknown structure/i)
    expect(() => fold(s, ev(1, 'structure_completed', { id: 'nope' }))).toThrow(/unknown structure/i)
    expect(() => fold(s, ev(1, 'structure_damaged', { id: 'nope', amount: 1 }))).toThrow(/unknown structure/i)
    expect(() => fold(s, ev(1, 'structure_destroyed', { id: 'nope' }))).toThrow(/unknown structure/i)
  })
  it('strict payloads reject extra keys on structure events', () => {
    const s = fold(genesisState(DEFAULT_CONFIG), plan('structure_1'))
    expect(() => fold(s, ev(2, 'structure_planned', { id: 'structure_2', kind: 'house', x: 9, y: 9, w: 1, h: 1, maxHp: 10, flammable: false, builderId: 'a1', extra: 1 }))).toThrow()
    expect(() => fold(s, ev(2, 'structure_progressed', { id: 'structure_1', ticks: 1, extra: 1 }))).toThrow()
    expect(() => fold(s, ev(2, 'structure_completed', { id: 'structure_1', extra: 1 }))).toThrow()
    expect(() => fold(s, ev(2, 'structure_damaged', { id: 'structure_1', amount: 1, extra: 1 }))).toThrow()
    expect(() => fold(s, ev(2, 'structure_destroyed', { id: 'structure_1', extra: 1 }))).toThrow()
  })
  it('does not mutate input state', () => {
    const s0 = fold(genesisState(DEFAULT_CONFIG), spawnItem('item_1', 1))
    fold(s0, ev(2, 'item_qty_changed', { id: 'item_1', delta: -1 }))
    expect(s0.items.item_1!.qty).toBe(1)
    const s1 = fold(s0, plan('structure_1'))
    fold(s1, ev(3, 'structure_destroyed', { id: 'structure_1' }))
    expect(s1.structures.structure_1).toBeDefined()
  })
})
