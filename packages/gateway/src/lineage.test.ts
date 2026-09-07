import { describe, expect, it } from 'vitest'
import type { SimEvent } from '@sj/shared'
import { EMPTY_LINEAGE, buildLineage, householdsOf, parentEdges, partnerEdges } from './lineage.js'

const ev = (seq: number, tick: number, type: string, payload: unknown): SimEvent => ({
  seq,
  tick,
  type,
  payload,
})

const agents = (
  list: { id: string; name?: string; alive?: boolean; insideId?: string; partnerId?: string }[],
): Record<
  string,
  { id: string; name: string; alive: boolean; insideId?: string; partnerId?: string }
> =>
  Object.fromEntries(
    list.map((a) => [
      a.id,
      {
        id: a.id,
        name: a.name ?? a.id,
        alive: a.alive ?? true,
        ...(a.insideId === undefined ? {} : { insideId: a.insideId }),
        ...(a.partnerId === undefined ? {} : { partnerId: a.partnerId }),
      },
    ]),
  )

describe('parentEdges — the payload the gateway actually folds', () => {
  // THE INTERFACE CORRECTION: bonds.ts reads `{ id, motherId, fatherId }`, not `{ parents }`.
  it('reads motherId and fatherId, and makes one edge per known parent', () => {
    const born = ev(1, 100, 'agent_born', { id: 'kid', motherId: 'amara', fatherId: 'yusuf' })
    expect(parentEdges([born])).toEqual([
      { parentId: 'amara', childId: 'kid', tick: 100 },
      { parentId: 'yusuf', childId: 'kid', tick: 100 },
    ])
  })

  it('a child with one known parent still gets an edge', () => {
    expect(parentEdges([ev(1, 5, 'agent_born', { id: 'kid', motherId: 'amara' })])).toEqual([
      { parentId: 'amara', childId: 'kid', tick: 5 },
    ])
  })

  it('★ a body the valley was founded with names the parents its card knew', () => {
    const spawned = ev(1, 1, 'agent_spawned', { id: 'tariq', parents: ['leyla', 'kamal'] })
    expect(parentEdges([spawned])).toEqual([
      { parentId: 'leyla', childId: 'tariq', tick: 1 },
      { parentId: 'kamal', childId: 'tariq', tick: 1 },
    ])
    const one = ev(1, 1, 'agent_spawned', { id: 'dilara', parents: ['halim'] })
    expect(parentEdges([one])).toEqual([{ parentId: 'halim', childId: 'dilara', tick: 1 }])
    // A founder with no family named, and a payload that lies about the shape, add nothing.
    expect(parentEdges([ev(1, 1, 'agent_spawned', { id: 'amara' })])).toEqual([])
    expect(parentEdges([ev(1, 1, 'agent_spawned', { id: 'amara', parents: 'kamal' })])).toEqual([])
  })

  it('ignores everything that is neither a birth nor a founding, and never repeats an edge', () => {
    const evts = [
      ev(1, 1, 'agent_spawned', { id: 'amara' }),
      ev(2, 9, 'agent_born', { id: 'kid', motherId: 'amara', fatherId: 'yusuf' }),
      ev(3, 9, 'agent_born', { id: 'kid', motherId: 'amara', fatherId: 'yusuf' }),
      ev(4, 9, 'agent_born', { id: '', motherId: 'amara' }),
    ]
    expect(parentEdges(evts).length).toBe(2)
  })

  it('a childless world is a typed empty, not a null', () => {
    expect(parentEdges([])).toEqual([])
    expect(buildLineage([], {})).toEqual(EMPTY_LINEAGE)
  })
})

describe('householdsOf — who is under which roof tonight', () => {
  it('groups by the roof and sorts both levels, so two reads agree', () => {
    const a = agents([
      { id: 'yusuf', insideId: 'house_y' },
      { id: 'amara', insideId: 'house_a' },
      { id: 'omar', insideId: 'house_a' },
      { id: 'nadia' },
    ])
    expect(householdsOf(a)).toEqual([
      { structureId: 'house_a', memberIds: ['amara', 'omar'] },
      { structureId: 'house_y', memberIds: ['yusuf'] },
    ])
    expect(householdsOf(a)).toEqual(householdsOf(a))
  })
})

describe('buildLineage', () => {
  it('names the living and the dead alike, sorted by id', () => {
    const l = buildLineage(
      [ev(1, 30, 'agent_born', { id: 'kid', motherId: 'amara', fatherId: 'yusuf' })],
      agents([
        { id: 'yusuf', name: 'Yusuf' },
        { id: 'amara', name: 'Amara', alive: false },
        { id: 'kid', name: 'Kid', insideId: 'house_a' },
      ]),
    )
    expect(l.people.map((p) => p.id)).toEqual(['amara', 'kid', 'yusuf'])
    expect(l.people.find((p) => p.id === 'amara')!.alive).toBe(false)
    expect(l.parentOf.length).toBe(2)
    expect(l.households).toEqual([{ structureId: 'house_a', memberIds: ['kid'] }])
  })
})

describe('★ partnerEdges — the marriages the world holds right now', () => {
  it('gives each pair one edge, lower id first, however the pair stored it', () => {
    expect(
      partnerEdges(
        agents([
          { id: 'kamal', partnerId: 'leyla' },
          { id: 'leyla', partnerId: 'kamal' },
          { id: 'bashir', partnerId: 'farida' },
          { id: 'farida', partnerId: 'bashir' },
          { id: 'amara' },
        ]),
      ),
    ).toEqual([
      { aId: 'bashir', bId: 'farida' },
      { aId: 'kamal', bId: 'leyla' },
    ])
  })

  it('drops a partner nobody in the town is, and a body married to itself', () => {
    expect(partnerEdges(agents([{ id: 'amara', partnerId: 'nobody' }]))).toEqual([])
    expect(partnerEdges(agents([{ id: 'amara', partnerId: 'amara' }]))).toEqual([])
    expect(partnerEdges(agents([]))).toEqual([])
  })

  it('rides the lineage the viewer reads, beside the parents and the roofs', () => {
    const built = buildLineage(
      [ev(1, 1, 'agent_spawned', { id: 'tariq', parents: ['leyla', 'kamal'] })],
      agents([
        { id: 'kamal', partnerId: 'leyla', insideId: 'house_1' },
        { id: 'leyla', partnerId: 'kamal', insideId: 'house_1' },
        { id: 'tariq', insideId: 'house_1' },
      ]),
    )
    expect(built.partnerOf).toEqual([{ aId: 'kamal', bId: 'leyla' }])
    expect(built.parentOf).toHaveLength(2)
    expect(built.households).toEqual([
      { structureId: 'house_1', memberIds: ['kamal', 'leyla', 'tariq'] },
    ])
  })
})
