import { describe, expect, it } from 'vitest'
import type { SimEvent } from '@sj/shared'
import { EMPTY_LINEAGE, buildLineage, householdsOf, parentEdges } from './lineage.js'

const ev = (seq: number, tick: number, type: string, payload: unknown): SimEvent =>
  ({ seq, tick, type, payload }) as SimEvent

const agents = (
  list: Array<{ id: string; name?: string; alive?: boolean; insideId?: string }>,
): Record<string, { id: string; name: string; alive: boolean; insideId?: string }> =>
  Object.fromEntries(list.map((a) => [a.id, {
    id: a.id, name: a.name ?? a.id, alive: a.alive ?? true,
    ...(a.insideId === undefined ? {} : { insideId: a.insideId }),
  }]))

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
    expect(parentEdges([ev(1, 5, 'agent_born', { id: 'kid', motherId: 'amara' })]))
      .toEqual([{ parentId: 'amara', childId: 'kid', tick: 5 }])
  })

  it('ignores everything that is not a birth, and never repeats an edge', () => {
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
      { id: 'yusuf', insideId: 'hut_y' },
      { id: 'amara', insideId: 'hut_a' },
      { id: 'omar', insideId: 'hut_a' },
      { id: 'nadia' },
    ])
    expect(householdsOf(a)).toEqual([
      { structureId: 'hut_a', memberIds: ['amara', 'omar'] },
      { structureId: 'hut_y', memberIds: ['yusuf'] },
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
        { id: 'kid', name: 'Kid', insideId: 'hut_a' },
      ]),
    )
    expect(l.people.map((p) => p.id)).toEqual(['amara', 'kid', 'yusuf'])
    expect(l.people.find((p) => p.id === 'amara')!.alive).toBe(false)
    expect(l.parentOf.length).toBe(2)
    expect(l.households).toEqual([{ structureId: 'hut_a', memberIds: ['kid'] }])
  })
})
