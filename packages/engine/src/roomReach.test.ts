import { describe, expect, it } from 'vitest'
import { ADULT_AGE_DAYS, DEFAULT_CONFIG } from '@sj/shared'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { RngStream } from './rng.js'
import { genesisState, type WorldState } from './state.js'
import { ev, grid, roundTrips } from './testutil/world.js'
import { VERBS } from './verbs/index.js'

const RNG = RngStream.seed('room-reach', 'actions')

function world(kind = 'house'): WorldState {
  let state = genesisState(DEFAULT_CONFIG, grid(8))
  state = fold(
    state,
    ev('structure_planned', {
      id: 'room',
      kind,
      x: 2,
      y: 2,
      w: 2,
      h: 2,
      maxHp: 20,
      flammable: true,
      builderId: 'a1',
    }),
  )
  state = fold(state, ev('structure_completed', { id: 'room' }))
  for (const [id, x, y] of [
    ['a1', 2, 4],
    ['a2', 3, 4],
  ] as const) {
    state = fold(state, ev('agent_spawned', { id, name: id, x, y, ageDays: ADULT_AGE_DAYS }))
  }
  return state
}

function item(
  state: WorldState,
  loc: WorldState['items'][string]['loc'],
  owner?: string,
): WorldState {
  return fold(
    state,
    ev('item_spawned', {
      id: 'loaf',
      kind: 'bread',
      qty: 1,
      loc,
      ...(owner === undefined ? {} : { owner }),
    }),
  )
}

const complete = (state: WorldState, verb: string, params: Record<string, unknown>) =>
  VERBS[verb]!.onComplete(state, DEFAULT_CONFIG, 'a1', params, RNG)

describe('room-aware reach and completion', () => {
  it('refuses a doorway handoff across a wall and a recipient who moves away before completion', () => {
    let state = item(world(), { t: 'agent', id: 'a1' })
    state = fold(state, ev('agent_entered', { agentId: 'a1', structureId: 'room' }))
    const params = { itemId: 'loaf', targetId: 'a2' }
    expect(VERBS.give!.validate(state, DEFAULT_CONFIG, 'a1', params)).toBe('a wall is in the way')
    expect(submitIntent(state, DEFAULT_CONFIG, 'a1', 'give', params)).toMatchObject({
      ok: true,
      events: [
        { type: 'action_started', payload: { verb: 'exit', then: { verb: 'give', params } } },
      ],
    })
    expect(complete(state, 'give', params)).toEqual([])

    state = fold(state, ev('agent_entered', { agentId: 'a2', structureId: 'room' }))
    expect(submitIntent(state, DEFAULT_CONFIG, 'a1', 'give', params).ok).toBe(true)
    expect(complete(state, 'give', params)).toContainEqual({
      type: 'item_moved',
      payload: { id: 'loaf', loc: { t: 'agent', id: 'a2' } },
    })
    const moved = fold(state, ev('agent_exited', { agentId: 'a2', structureId: 'room' }))
    expect(complete(moved, 'give', params)).toEqual([])
    const far = fold(state, ev('agent_moved', { id: 'a2', x: 7, y: 7 }))
    expect(complete(far, 'give', params)).toEqual([])
  })

  it('requires entry to take or eat a loaf in a roofed room, including at completion', () => {
    let state = item(world(), { t: 'structure', id: 'room' }, 'a2')
    state = fold(state, ev('agent_moved', { id: 'a1', x: 4, y: 2 }))
    const params = { itemId: 'loaf' }
    expect(submitIntent(state, DEFAULT_CONFIG, 'a1', 'take', params).ok).toBe(false)
    expect(submitIntent(state, DEFAULT_CONFIG, 'a1', 'eat', params).ok).toBe(false)
    expect(complete(state, 'take', params)).toEqual([])
    expect(complete(state, 'eat', params)).toEqual([])

    state = fold(state, ev('agent_moved', { id: 'a1', x: 2, y: 4 }))
    state = fold(state, ev('agent_entered', { agentId: 'a1', structureId: 'room' }))
    expect(submitIntent(state, DEFAULT_CONFIG, 'a1', 'take', params).ok).toBe(true)
    expect(submitIntent(state, DEFAULT_CONFIG, 'a1', 'eat', params).ok).toBe(true)
    expect(complete(state, 'take', params).map((e) => e.type)).toEqual(['item_moved', 'item_taken'])
    const outside = fold(state, ev('agent_exited', { agentId: 'a1', structureId: 'room' }))
    expect(complete(outside, 'take', params)).toEqual([])
  })

  it('does not let a remembered item ID bypass a wall after the item moves', () => {
    let state = item(world(), { t: 'tile', x: 2, y: 4 })
    expect(submitIntent(state, DEFAULT_CONFIG, 'a1', 'take', { itemId: 'loaf' }).ok).toBe(true)
    state = fold(state, ev('item_moved', { id: 'loaf', loc: { t: 'structure', id: 'room' } }))
    expect(complete(state, 'take', { itemId: 'loaf' })).toEqual([])
    expect(complete(state, 'eat', { itemId: 'loaf' })).toEqual([])
  })

  it('requires entry to stow in a roofed room and rechecks the room at completion', () => {
    let state = item(world(), { t: 'agent', id: 'a1' })
    const params = { itemId: 'loaf', structureId: 'room' }
    expect(submitIntent(state, DEFAULT_CONFIG, 'a1', 'stow', params).ok).toBe(false)
    expect(complete(state, 'stow', params)).toEqual([])
    state = fold(state, ev('agent_entered', { agentId: 'a1', structureId: 'room' }))
    expect(submitIntent(state, DEFAULT_CONFIG, 'a1', 'stow', params).ok).toBe(true)
    expect(complete(state, 'stow', params)).toEqual([
      { type: 'item_moved', payload: { id: 'loaf', loc: { t: 'structure', id: 'room' } } },
    ])
    const outside = fold(state, ev('agent_exited', { agentId: 'a1', structureId: 'room' }))
    expect(complete(outside, 'stow', params)).toEqual([])
  })

  it('keeps open-air storage reachable and outdoor handoffs possible', () => {
    let state = item(world('standing_stone'), { t: 'structure', id: 'room' })
    expect(submitIntent(state, DEFAULT_CONFIG, 'a1', 'take', { itemId: 'loaf' }).ok).toBe(true)
    state = fold(state, ev('item_moved', { id: 'loaf', loc: { t: 'agent', id: 'a1' } }))
    expect(
      submitIntent(state, DEFAULT_CONFIG, 'a1', 'stow', {
        itemId: 'loaf',
        structureId: 'room',
      }).ok,
    ).toBe(true)
    expect(
      submitIntent(state, DEFAULT_CONFIG, 'a1', 'give', {
        itemId: 'loaf',
        targetId: 'a2',
      }).ok,
    ).toBe(true)
  })

  it('replays a reachable take with the same item and owner', () => {
    const state = item(world(), { t: 'tile', x: 2, y: 4 }, 'a2')
    const go = submitIntent(state, DEFAULT_CONFIG, 'a1', 'take', { itemId: 'loaf' })
    expect(go.ok).toBe(true)
    if (!go.ok) return
    const started = go.events.reduce((s, e) => fold(s, ev(e.type, e.payload)), state)
    const first = roundTrips(started, DEFAULT_CONFIG, 'room-reach-replay')
    expect(first.replayed).toEqual(first.out.state)
    const { replayed, out } = roundTrips(first.out.state, DEFAULT_CONFIG, 'room-reach-replay')
    expect(replayed).toEqual(out.state)
    expect(out.state.items.loaf).toMatchObject({
      loc: { t: 'agent', id: 'a1' },
      owner: 'a2',
    })
    expect(out.events.some((e) => e.type === 'item_taken')).toBe(true)
  })
})
