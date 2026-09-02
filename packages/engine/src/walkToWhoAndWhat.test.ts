import { describe, expect, it } from 'vitest'
import { ADULT_AGE_DAYS, DEFAULT_CONFIG } from '@sj/shared'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { RngStreams } from './rng.js'
import { composePerception } from './perception.js'
import { genesisState, type WorldState } from './state.js'
import { ev, grid } from './testutil/world.js'
import { VERBS, WALK_LOST_THEM, walkDestination } from './verbs/index.js'
import { createWorldTick } from './worldTick.js'

// ★ 63 of 165 coordinate walks in the rehearsal landed on or beside another mind, and not one
// landed on a thing on the ground — against 72 refusals that said the thing was out of reach.
// A person and a thing were addressable by no key a walk read, so both were chased by number.
const ME = 'a1'
const YOU = 'a2'
const CFG = DEFAULT_CONFIG

// Noon: the light sets the sight horizon, and every mark below is one this body can see.
const NOON = 720

function world(me: { x: number; y: number }, you?: { x: number; y: number }): WorldState {
  let s = { ...genesisState(CFG, grid(24)), tick: NOON }
  s = fold(s, ev('agent_spawned', { id: ME, name: ME, ...me, ageDays: ADULT_AGE_DAYS }))
  if (you !== undefined) {
    s = fold(s, ev('agent_spawned', { id: YOU, name: YOU, ...you, ageDays: ADULT_AGE_DAYS }))
  }
  return s
}

const withItem = (s: WorldState, at: { x: number; y: number }): WorldState =>
  fold(s, ev('item_spawned', { id: 'i1', kind: 'wood', qty: 1, loc: { t: 'tile', ...at } }))

const gap = (s: WorldState): number => {
  const a = s.agents[ME]!
  const b = s.agents[YOU]!
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
}

const start = (state: WorldState, params: Record<string, unknown>): WorldState => {
  const go = submitIntent(state, CFG, ME, 'walk', params)
  expect(go.ok, go.ok ? '' : go.reason).toBe(true)
  if (!go.ok) throw new Error(go.reason)
  return go.events.reduce((s, e) => fold(s, ev(e.type, e.payload), CFG), state)
}

/** Steps the world, and after each tick that left the legs going, lets `moveYou` put the other
 *  body somewhere else. A body moved after the walk ended would be measuring the mover. */
function run(
  state: WorldState,
  ticks: number,
  moveYou?: (s: WorldState, i: number) => { x: number; y: number } | null,
): { state: WorldState; types: string[] } {
  const worldTick = createWorldTick(CFG, new RngStreams('walk-to'))
  const walking = (w: WorldState): boolean => w.agents[ME]?.activity != null
  const types: string[] = []
  let s = state
  for (let i = 0; i < ticks && walking(s); i++) {
    const out = worldTick({ ...s, tick: s.tick + 1 })
    s = out.state
    types.push(...out.events.map((e) => e.type))
    if (!walking(s)) break
    const to = moveYou?.(s, i) ?? null
    if (to !== null) s = fold(s, ev('agent_moved', { id: YOU, ...to }), CFG)
  }
  return { state: s, types }
}

describe('★ a walk that names a person', () => {
  it('ends beside them, not on a snapshot of where they stood', () => {
    const { state } = run(start(world({ x: 2, y: 2 }, { x: 10, y: 2 }), { targetId: YOU }), 40)
    expect(gap(state)).toBeLessThanOrEqual(1)
    expect(state.agents[ME]!.activity).toBe(null)
  })

  // The whole point of the key: a route laid once at the first tick is stale at the second.
  it('follows them while they move, and still ends beside them', () => {
    const { state, types } = run(
      start(world({ x: 2, y: 2 }, { x: 8, y: 2 }), { targetId: YOU }),
      40,
      (s, i) => (i < 4 ? { x: 8, y: Math.min(2 + i + 1, 12) } : null),
    )
    expect(types).toContain('walk_reaimed')
    expect(gap(state)).toBeLessThanOrEqual(1)
  })

  // Somebody outrunning you is not somebody you are catching. Five tiles a tick against this
  // body's three widens the gap every tick, and three widening ticks running ends it.
  it('gives up on someone walking away, rather than following forever', () => {
    const s0 = start(world({ x: 2, y: 12 }, { x: 5, y: 12 }), { targetId: YOU })
    const { state, types } = run(s0, 40, (s) =>
      s.agents[YOU]!.x >= 22 ? null : { x: s.agents[YOU]!.x + 5, y: 12 },
    )
    expect(types).toContain('action_interrupted')
    expect(state.agents[ME]!.activity).toBe(null)
    expect(gap(state)).toBeGreaterThan(1)
  })

  // The other half of the ruling: a body that never falls behind still stops following. Half a
  // sim-hour is one crossing of the valley and a little, and the legs are not a mind's whole day.
  it('gives up after half a sim-hour, however close it is still getting', () => {
    const s0 = start(world({ x: 2, y: 12 }, { x: 12, y: 12 }), { targetId: YOU })
    const a = s0.agents[ME]!
    const worn: WorldState = {
      ...s0,
      agents: {
        ...s0.agents,
        [ME]: { ...a, activity: { ...a.activity!, chase: { ticks: 30, grew: 0, gap: 10 } } },
      },
    }
    const { types } = run(worn, 2)
    expect(types).toContain('action_interrupted')
  })

  it('says so in words a body can feel, and never a machinery word', () => {
    const cut = { type: 'action_interrupted', payload: { agentId: ME, reason: WALK_LOST_THEM } }
    const felt = composePerception(world({ x: 2, y: 2 }), CFG, ME, [ev(cut.type, cut.payload)])
    expect(felt.feltEvents).toEqual(['you_lost_them'])
    expect(WALK_LOST_THEM).not.toMatch(/blocked|target|path|invalid/i)
  })

  it('refuses a person this body cannot see, and itself', () => {
    // Night, so the same two bodies at the same two tiles are out of each other's sight.
    const dark = { ...world({ x: 2, y: 2 }, { x: 14, y: 2 }), tick: 0 }
    expect(walkDestination(dark, CFG, ME, { targetId: YOU })).toEqual({
      refusal: 'you cannot see them from here',
    })
    expect(walkDestination(world({ x: 2, y: 2 }), CFG, ME, { targetId: ME })).toEqual({
      refusal: 'you are already where you are',
    })
    expect(walkDestination(world({ x: 2, y: 2 }), CFG, ME, { targetId: 'nobody' })).toEqual({
      refusal: 'there is no one by that name to walk to',
    })
  })
})

describe('★ a walk that names a thing on the ground', () => {
  const seeing = withItem(world({ x: 2, y: 2 }), { x: 9, y: 5 })

  // `take`'s own validate is the judge, so the walk cannot end a tile short of the taking.
  it('ends exactly where take will lift it', () => {
    const to = walkDestination(seeing, CFG, ME, { itemId: 'i1' })
    expect(to).not.toHaveProperty('refusal')
    const { state } = run(start(seeing, { itemId: 'i1' }), 40)
    expect(VERBS.take!.validate(state, CFG, ME, { itemId: 'i1' })).toBe(null)
    expect(submitIntent(state, CFG, ME, 'take', { itemId: 'i1' }).ok).toBe(true)
  })

  it('refuses a thing this body cannot see, and one already in a hand', () => {
    const far = withItem(world({ x: 2, y: 2 }), { x: 22, y: 22 })
    expect(walkDestination(far, CFG, ME, { itemId: 'i1' })).toEqual({
      refusal: 'you cannot see it from here',
    })
    expect(walkDestination(seeing, CFG, ME, { itemId: 'nothing' })).toEqual({
      refusal: 'there is no such thing to walk to',
    })
    const held = fold(seeing, ev('item_moved', { id: 'i1', loc: { t: 'agent', id: ME } }), CFG)
    expect(walkDestination(held, CFG, ME, { itemId: 'i1' })).toEqual({
      refusal: 'you are holding that',
    })
  })
})
