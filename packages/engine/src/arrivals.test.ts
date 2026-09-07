import { describe, expect, it } from 'vitest'
import {
  ADULT_AGE_DAYS,
  DEFAULT_CONFIG,
  MINUTES_PER_DAY,
  SimConfigSchema,
  TOWN_SQUARE,
  stateHash,
  type SimConfig,
} from '@sj/shared'
import { fold } from './fold.js'
import { makeGenesisWorld } from './genesis/world.js'
import { genesisState, type WorldState } from './state.js'
import { headcount, roadRimOf } from './town.js'
import { motherAndFather } from './systems/reproduction.js'
import { submitIntent } from './intent.js'
import { isMapRim } from './verbs/index.js'
import { ev, grid, runAct } from './testutil/world.js'
import { RngStreams } from './rng.js'
import { createWorldTick } from './worldTick.js'

const CFG: SimConfig = SimConfigSchema.parse({ weather: { hourlyChangeChance: 0 } })

const flat = (): WorldState => genesisState(CFG, grid(24))

const spawned = (state: WorldState, id: string, x: number, y: number): WorldState =>
  fold(state, ev('agent_spawned', { id, name: id, x, y, ageDays: ADULT_AGE_DAYS }), CFG)

function genesisWorld(): WorldState {
  const { terrain, events } = makeGenesisWorld(DEFAULT_CONFIG)
  let state = genesisState(DEFAULT_CONFIG, terrain)
  let seq = 0
  for (const e of events)
    state = fold(state, { seq: ++seq, tick: 0, type: e.type, payload: e.payload }, DEFAULT_CONFIG)
  return state
}

const MIRA = { id: 'mira', name: 'Mira', sex: 'f' as const, ageDays: 868, x: 3, y: 23 }

describe('★ the fold of an arrival', () => {
  it('makes a body that knows the day it came, and bumps the counter behind it', () => {
    const at = 3 * MINUTES_PER_DAY + 540
    const s = fold(flat(), ev('agent_arrived', { ...MIRA, id: 'agent_9' }, at), CFG)
    const body = s.agents.agent_9!
    expect(body.alive).toBe(true)
    expect(body.sex).toBe('f')
    expect(body.ageDays).toBe(868)
    expect(body.arrived).toEqual({ day: 3 })
    expect(body.departed).toBeUndefined()
    expect(s.counters.nextEntityId).toBe(10)
  })

  it('refuses a second body under the same name', () => {
    const s = fold(flat(), ev('agent_arrived', MIRA), CFG)
    expect(() => fold(s, ev('agent_arrived', MIRA), CFG)).toThrow(/already here/)
  })

  // The road is new; every log written before it must fold to the state it always did.
  it('leaves a town nobody has come to hashing exactly as it did', () => {
    const before = spawned(flat(), 'a1', 4, 4)
    expect(before.agents.a1!.arrived).toBeUndefined()
    expect(stateHash(before.agents.a1!)).toBe(
      stateHash({
        id: 'a1',
        name: 'a1',
        x: 4,
        y: 4,
        alive: true,
        asleep: false,
        lastMealTick: 0,
        needs: { hunger: 100, energy: 100, warmth: 100, social: 100 },
        hp: CFG.health.maxHp,
        injuries: [],
        ill: false,
        ageDays: ADULT_AGE_DAYS,
        skills: {},
        activity: null,
        collapsedSinceTick: null,
        zeroHungerSinceTick: null,
      }),
    )
  })
})

describe('★ the fold of a departure', () => {
  const withKit = (): WorldState => {
    let s = fold(flat(), ev('agent_arrived', MIRA), CFG)
    s = spawned(s, 'a1', 4, 4)
    s = fold(
      s,
      ev('item_spawned', { id: 'item_1', kind: 'bread', qty: 3, loc: { t: 'agent', id: 'mira' } }),
      CFG,
    )
    s = fold(
      s,
      ev('item_spawned', { id: 'item_2', kind: 'bread', qty: 1, loc: { t: 'agent', id: 'a1' } }),
      CFG,
    )
    return s
  }

  it('keeps the body and the name, and takes what they were carrying with them', () => {
    const at = 5 * MINUTES_PER_DAY
    const s = fold(withKit(), ev('agent_departed', { agentId: 'mira' }, at), CFG)
    const body = s.agents.mira!
    expect(body.alive).toBe(false)
    expect(body.asleep).toBe(false)
    expect(body.activity).toBeNull()
    expect(body.insideId).toBeUndefined()
    expect(body.departed).toEqual({ day: 5 })
    expect(body.name).toBe('Mira')
    expect(s.items.item_1).toBeUndefined()
    expect(s.items.item_2).toBeDefined()
  })

  it('refuses a body that is not here, and one that is already gone', () => {
    const s = fold(withKit(), ev('agent_departed', { agentId: 'mira' }), CFG)
    expect(() => fold(s, ev('agent_departed', { agentId: 'mira' }), CFG)).toThrow(/already gone/)
    expect(() => fold(s, ev('agent_departed', { agentId: 'nobody' }), CFG)).toThrow(/unknown/)
  })

  // The replay law: the same log, folded again from genesis, is the same town.
  it('replays from genesis to the state the live run left', () => {
    const log = [
      ev('agent_arrived', MIRA, 10),
      ev('item_spawned', {
        id: 'item_1',
        kind: 'bread',
        qty: 3,
        loc: { t: 'agent', id: 'mira' },
      }),
      ev('agent_departed', { agentId: 'mira' }, 20),
    ]
    const live = log.reduce((s, e) => fold(s, e, CFG), flat())
    const replayed = log.reduce((s, e) => fold(s, e, CFG), flat())
    expect(stateHash(replayed)).toBe(stateHash(live))
  })
})

describe('★ how many people the valley is holding', () => {
  it('counts the child on the way, and neither the dead nor the departed', () => {
    let s = spawned(flat(), 'a1', 4, 4)
    s = spawned(s, 'a2', 5, 4)
    s = spawned(s, 'a3', 6, 4)
    expect(headcount(s)).toBe(3)
    s = fold(s, ev('agent_conceived', { motherId: 'a1', fatherId: 'a2', day: 0 }), CFG)
    expect(headcount(s)).toBe(4)
    s = fold(s, ev('agent_died', { agentId: 'a3', cause: 'hunger' }), CFG)
    expect(headcount(s)).toBe(3)
    s = fold(s, ev('agent_departed', { agentId: 'a2' }), CFG)
    expect(headcount(s)).toBe(2)
  })
})

describe('★ the ceiling on conception', () => {
  const pair = (): WorldState => {
    let s = fold(
      flat(),
      ev('agent_spawned', { id: 'a1', name: 'a1', x: 4, y: 4, ageDays: 700, sex: 'f' }),
      CFG,
    )
    s = fold(
      s,
      ev('agent_spawned', { id: 'a2', name: 'a2', x: 5, y: 4, ageDays: 700, sex: 'm' }),
      CFG,
    )
    return s
  }

  it('finds a mother and a father in a town with room', () => {
    expect(motherAndFather(pair(), CFG, 'a1', 'a2')).toEqual({ motherId: 'a1', fatherId: 'a2' })
  })

  it('refuses at the ceiling', () => {
    const full = SimConfigSchema.parse({ population: { maxMinds: 2 } })
    expect(motherAndFather(pair(), full, 'a1', 'a2')).toBeNull()
  })

  // The silent-pregnancy bug: `reproductionSystem` returns early when the law is off, so a
  // pregnancy conceived under it could never be delivered. Now none is conceived.
  it('refuses when the town has no law for children, so no pregnancy can stand for ever', () => {
    const off = SimConfigSchema.parse({ reproduction: { enabled: false } })
    expect(motherAndFather(pair(), off, 'a1', 'a2')).toBeNull()
    const s = fold(pair(), ev('agent_conceived', { motherId: 'a1', fatherId: 'a2', day: 0 }), off)
    // A pregnancy already on the books still delivers; the fold is untouched.
    expect(s.agents.a1!.pregnant).toBeDefined()
  })
})

describe('★ where the road leaves the valley', () => {
  it('is a reachable tile of the bottom row, on the square’s own column if it can be', () => {
    const s = genesisWorld()
    const rim = roadRimOf(s, DEFAULT_CONFIG)
    expect(rim).not.toBeNull()
    expect(rim!.y).toBe(s.terrain.length - 1)
    expect(isMapRim(s, rim!.x, rim!.y)).toBe(true)
    expect(Math.abs(rim!.x - TOWN_SQUARE.x)).toBeLessThan(8)
  })

  it('follows the array when the world grows out from under it', () => {
    const s = genesisWorld()
    const before = roadRimOf(s, DEFAULT_CONFIG)!
    const depth = 4
    const width = s.terrain[0]!.length
    const grown = fold(
      s,
      ev('world_grown', {
        edge: 'n',
        depth,
        tiles: Array.from({ length: depth }, () => new Array<number>(width).fill(1)),
      }),
      DEFAULT_CONFIG,
    )
    const after = roadRimOf(grown, DEFAULT_CONFIG)!
    expect(after.y).toBe(grown.terrain.length - 1)
    expect(after.y).toBe(before.y + depth)
  })

  it('has no answer for a world with no town', () => {
    expect(roadRimOf(flat(), CFG)).toBeNull()
  })
})

describe('★ leave_town, the road out', () => {
  const rimWorld = (): { state: WorldState; rim: { x: number; y: number } } => {
    const s = genesisWorld()
    return { state: s, rim: roadRimOf(s, DEFAULT_CONFIG)! }
  }

  it('aims the legs at the road when the body is standing anywhere else', () => {
    const { state, rim } = rimWorld()
    const s = spawned(state, 'a1', TOWN_SQUARE.x, TOWN_SQUARE.y)
    const out = submitIntent(s, DEFAULT_CONFIG, 'a1', 'leave_town', {})
    expect(out.ok).toBe(true)
    const started = out.ok ? out.events.find((e) => e.type === 'action_started') : undefined
    const p = started!.payload as { verb: string; params: { x: number; y: number } }
    expect(p.verb).toBe('walk')
    expect({ x: p.params.x, y: p.params.y }).toEqual(rim)
  })

  it('starts a ten-tick act at the road, and ends it with a departure', () => {
    const { state, rim } = rimWorld()
    const s = spawned(state, 'a1', rim.x, rim.y)
    const out = submitIntent(s, DEFAULT_CONFIG, 'a1', 'leave_town', {})
    expect(out.ok).toBe(true)
    const started = out.ok ? out.events.find((e) => e.type === 'action_started') : undefined
    expect((started!.payload as { verb: string; duration: number }).verb).toBe('leave_town')
    expect((started!.payload as { duration: number }).duration).toBe(10)
    const going = out.ok
      ? out.events.reduce((w, e) => fold(w, ev(e.type, e.payload, w.tick), DEFAULT_CONFIG), s)
      : s
    const done = runAct(going, DEFAULT_CONFIG, 'a1')
    expect(done.events.map((e) => e.type)).toContain('agent_departed')
    expect(done.state.agents.a1!.alive).toBe(false)
  })

  it('dissolves the partnership before it goes, and in that order', () => {
    const { state, rim } = rimWorld()
    let s = spawned(state, 'a1', rim.x, rim.y)
    s = spawned(s, 'a2', rim.x, rim.y - 1)
    s = fold(s, ev('partnership_formed', { aId: 'a1', bId: 'a2' }), DEFAULT_CONFIG)
    const out = submitIntent(s, DEFAULT_CONFIG, 'a1', 'leave_town', {})
    const going = out.ok
      ? out.events.reduce((w, e) => fold(w, ev(e.type, e.payload, w.tick), DEFAULT_CONFIG), s)
      : s
    const done = runAct(going, DEFAULT_CONFIG, 'a1')
    const types = done.events.map((e) => e.type)
    expect(types.indexOf('partnership_dissolved')).toBeGreaterThanOrEqual(0)
    expect(types.indexOf('partnership_dissolved')).toBeLessThan(types.indexOf('agent_departed'))
    expect(done.state.agents.a2!.partnerId).toBeUndefined()
  })

  it('refuses a body on the ground', () => {
    const { state, rim } = rimWorld()
    let s = spawned(state, 'a1', rim.x, rim.y)
    s = {
      ...s,
      agents: { ...s.agents, a1: { ...s.agents.a1!, collapsedSinceTick: 0, hp: 4 } },
    }
    const out = submitIntent(s, DEFAULT_CONFIG, 'a1', 'leave_town', {})
    expect(out).toEqual({ ok: false, reason: 'collapsed and unable to act' })
  })

  it('steps out of doors first', () => {
    const { state, rim } = rimWorld()
    const house = Object.values(state.structures).find((st) => st.kind === 'house')!
    let s = spawned(state, 'a1', house.x, house.y)
    s = fold(s, ev('agent_entered', { agentId: 'a1', structureId: house.id }), DEFAULT_CONFIG)
    expect(s.agents.a1!.insideId).toBe(house.id)
    const out = submitIntent(s, DEFAULT_CONFIG, 'a1', 'leave_town', {})
    expect(out.ok).toBe(true)
    const started = out.ok ? out.events.find((e) => e.type === 'action_started') : undefined
    expect((started!.payload as { verb: string }).verb).toBe('exit')
    expect(rim).toBeDefined()
  })
})

describe('★ a world that folds a departure keeps folding', () => {
  it('runs a tick over a departed body without a throw', () => {
    let s = fold(flat(), ev('agent_arrived', MIRA), CFG)
    s = fold(s, ev('agent_departed', { agentId: 'mira' }, 1), CFG)
    const out = createWorldTick(
      CFG,
      new RngStreams('t'),
    )(fold(s, ev('tick_advanced', {}, s.tick + 1), CFG))
    expect(out.state.agents.mira!.alive).toBe(false)
  })
})
