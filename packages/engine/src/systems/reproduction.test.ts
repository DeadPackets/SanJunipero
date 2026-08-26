import { describe, it, expect } from 'vitest'
import {
  DAYS_PER_YEAR,
  DEFAULT_CONFIG,
  MINUTES_PER_DAY,
  SimConfigSchema,
  type SimConfig,
  type SimEvent,
} from '@sj/shared'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { fold } from '../fold.js'
import { RngStreams } from '../rng.js'
import { createWorldTick } from '../worldTick.js'
import { ageBand } from './aging.js'
import { BIRTH_NAMES } from '../data/names.js'
import { isPartnered, pairKey, partnershipOf, sexOf } from './reproduction.js'

// Partnership is inferred, never declared: the town reads it off who sleeps where.

const CFG: SimConfig = SimConfigSchema.parse({ weather: { hourlyChangeChance: 0 } })
const OFF: SimConfig = SimConfigSchema.parse({
  weather: { hourlyChangeChance: 0 },
  reproduction: { enabled: false },
})

let seq = 50000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({
  seq: seq++,
  tick,
  type,
  payload,
})

const HOUSE = { id: 'structure_1', kind: 'house', x: 2, y: 2, w: 3, h: 3 }
const STORE = { id: 'structure_2', kind: 'storehouse', x: 8, y: 2, w: 3, h: 3 }

function room(config: SimConfig, box: typeof HOUSE): (s: WorldState) => WorldState {
  return (s) => {
    const planned = fold(
      s,
      ev('structure_planned', {
        ...box,
        maxHp: 50,
        flammable: true,
        builderId: 'a1',
      }),
      config,
    )
    return fold(planned, ev('structure_completed', { id: box.id }), config)
  }
}

// Agents indoors and (by default) asleep, which is all the midnight pass looks at.
type WorldOpts = {
  awake?: string[]
  sexes?: Record<string, 'f' | 'm'>
  ages?: Record<string, number>
}

function world(ids: string[], config = CFG, box = HOUSE, opts: WorldOpts = {}): WorldState {
  let s = genesisState(
    config,
    Array.from({ length: 16 }, () => Array.from({ length: 16 }, (): TileId => 0)),
  )
  s = room(config, box)(s)
  for (const id of ids) {
    s = fold(
      s,
      ev('agent_spawned', {
        id,
        name: id,
        x: box.x,
        y: box.y,
        ageDays: opts.ages?.[id] ?? 7300,
        ...(opts.sexes?.[id] === undefined ? {} : { sex: opts.sexes[id] }),
      }),
      config,
    )
    s = fold(s, ev('agent_entered', { agentId: id, structureId: box.id }), config)
    if (!opts.awake?.includes(id)) s = fold(s, ev('agent_slept', { agentId: id }), config)
  }
  return s
}

type Midnight = {
  state: WorldState
  events: { type: string; payload: unknown }[]
  coSlept: { type: string; payload: unknown }[]
}

function midnight(s: WorldState, day: number, config = CFG, seed = 'repro'): Midnight {
  const tick = day * MINUTES_PER_DAY
  const advanced = fold({ ...s, tick: tick - 1 }, ev('tick_advanced', {}, tick), config)
  const r = createWorldTick(config, new RngStreams(seed))(advanced)
  return {
    state: r.state,
    events: r.events,
    coSlept: r.events.filter((e) => e.type === 'co_slept'),
  }
}

// Sleep through `days` consecutive midnights, starting at day 1.
function nights(s: WorldState, days: number[], config = CFG): WorldState {
  return days.reduce((acc, day) => midnight(acc, day, config).state, s)
}

describe('the midnight co-sleeping pass', () => {
  it('records the pair asleep in one house', () => {
    const { state, coSlept } = midnight(world(['a1', 'a2']), 1)
    expect(coSlept).toEqual([{ type: 'co_slept', payload: { aId: 'a1', bId: 'a2', day: 1 } }])
    expect(partnershipOf(state, 'a1', 'a2')).toEqual({
      nights: 1,
      lastNightDay: 1,
      formedTick: null,
      dissolvedTick: null,
    })
  })

  it('ignores an occupant who is awake', () => {
    expect(midnight(world(['a1', 'a2'], CFG, HOUSE, { awake: ['a2'] }), 1).coSlept).toEqual([])
  })

  it('never counts a storehouse — a night together needs a private room', () => {
    expect(midnight(world(['a1', 'a2'], CFG, STORE), 1).coSlept).toEqual([])
  })

  it('pairs three occupants three ways, in a deterministic order', () => {
    expect(midnight(world(['a3', 'a1', 'a2']), 1).coSlept.map((e) => e.payload)).toEqual([
      { aId: 'a1', bId: 'a2', day: 1 },
      { aId: 'a1', bId: 'a3', day: 1 },
      { aId: 'a2', bId: 'a3', day: 1 },
    ])
  })

  it('goes quiet with the reproduction flag off', () => {
    expect(midnight(world(['a1', 'a2'], OFF), 1, OFF).coSlept).toEqual([])
    expect(midnight(world(['a1', 'a2'], OFF), 1, OFF).state.pairNights).toBeUndefined()
  })

  it('keys a pair the same way whichever name comes first', () => {
    expect(pairKey('a2', 'a1')).toBe('a1|a2')
    expect(pairKey('a1', 'a2')).toBe('a1|a2')
  })
})

describe('partnership is counted, not declared', () => {
  it('reaches partnership on the third consecutive night', () => {
    const s = world(['a1', 'a2'])
    const two = nights(s, [1, 2])
    expect(partnershipOf(two, 'a1', 'a2')!.nights).toBe(2)
    expect(isPartnered(two, 'a1', 'a2', CFG)).toBe(false)
    const three = midnight(two, 3).state
    expect(partnershipOf(three, 'a1', 'a2')!.nights).toBe(3)
    expect(isPartnered(three, 'a1', 'a2', CFG)).toBe(true)
  })

  it('stamps formedTick at the threshold tick and not one night before', () => {
    const two = nights(world(['a1', 'a2']), [1, 2])
    expect(partnershipOf(two, 'a1', 'a2')!.formedTick).toBeNull()
    const three = midnight(two, 3).state
    expect(partnershipOf(three, 'a1', 'a2')!.formedTick).toBe(3 * MINUTES_PER_DAY)
    // A fourth night does not re-stamp what is already true.
    expect(partnershipOf(midnight(three, 4).state, 'a1', 'a2')!.formedTick).toBe(
      3 * MINUTES_PER_DAY,
    )
  })

  it('leaves both transition fields null for a pair that never got there', () => {
    expect(partnershipOf(nights(world(['a1', 'a2']), [1, 2]), 'a1', 'a2')).toEqual({
      nights: 2,
      lastNightDay: 2,
      formedTick: null,
      dissolvedTick: null,
    })
  })

  it('resets the count to one after a gap wider than the window', () => {
    const s = nights(world(['a1', 'a2']), [1, 2, 11]) // 9-day gap
    expect(partnershipOf(s, 'a1', 'a2')).toEqual({
      nights: 1,
      lastNightDay: 11,
      formedTick: null,
      dissolvedTick: null,
    })
  })

  it('stamps dissolvedTick at the gap-reset midnight once they were partnered', () => {
    const partnered = nights(world(['a1', 'a2']), [1, 2, 3])
    expect(partnershipOf(partnered, 'a1', 'a2')!.formedTick).toBe(3 * MINUTES_PER_DAY)
    const apart = midnight(partnered, 12).state // 9-day gap
    expect(partnershipOf(apart, 'a1', 'a2')).toEqual({
      nights: 1,
      lastNightDay: 12,
      formedTick: 3 * MINUTES_PER_DAY,
      dissolvedTick: 12 * MINUTES_PER_DAY,
    })
    expect(isPartnered(apart, 'a1', 'a2', CFG)).toBe(false)
  })

  it('re-stamps formedTick and clears dissolvedTick when they find each other again', () => {
    const apart = nights(world(['a1', 'a2']), [1, 2, 3, 12])
    expect(partnershipOf(apart, 'a1', 'a2')!.dissolvedTick).toBe(12 * MINUTES_PER_DAY)
    const again = nights(apart, [13, 14])
    expect(partnershipOf(again, 'a1', 'a2')).toEqual({
      nights: 3,
      lastNightDay: 14,
      formedTick: 14 * MINUTES_PER_DAY,
      dissolvedTick: null,
    })
    expect(isPartnered(again, 'a1', 'a2', CFG)).toBe(true)
  })

  it('a night exactly at the window edge is not a gap', () => {
    const s = nights(world(['a1', 'a2']), [1, 8]) // gap of 7 = partnerWindowDays
    expect(partnershipOf(s, 'a1', 'a2')!.nights).toBe(2)
  })

  it('knows nothing about strangers', () => {
    const s = midnight(world(['a1', 'a2']), 1).state
    expect(partnershipOf(s, 'a1', 'a9')).toBeUndefined()
    expect(isPartnered(s, 'a1', 'a9', CFG)).toBe(false)
    expect(partnershipOf(genesisState(CFG), 'a1', 'a2')).toBeUndefined()
  })
})

describe('conception', () => {
  const CONCEIVES = 'r3' // first reproduction roll ≈ 0.143, under the 0.2 chance
  const REFUSES = 'r0' // ≈ 0.777
  const SEXES = { a1: 'f', a2: 'm' } as const

  // Three nights together, then the fourth midnight is the one that can conceive.
  function couple(config = CFG, opts: WorldOpts = {}): WorldState {
    return nights(
      world(['a1', 'a2'], config, HOUSE, { sexes: { ...SEXES }, ...opts }),
      [1, 2, 3],
      config,
    )
  }

  const conceptions = (s: WorldState, seed: string, config = CFG, day = 4) =>
    midnight(s, day, config, seed).events.filter((e) => e.type === 'agent_conceived')

  it('fires for a partnered, co-sleeping, fertile f/m pair when the roll lands', () => {
    const s = couple()
    expect(conceptions(s, CONCEIVES)).toEqual([
      { type: 'agent_conceived', payload: { motherId: 'a1', fatherId: 'a2', day: 4 } },
    ])
    expect(midnight(s, 4, CFG, CONCEIVES).state.agents.a1!.pregnant).toEqual({
      sinceDay: 4,
      byId: 'a2',
    })
  })

  it('does not fire when the roll misses', () => {
    expect(conceptions(couple(), REFUSES)).toEqual([])
  })

  it('does not fire before the pair is partnered — two nights in is still two nights in', () => {
    const one = nights(world(['a1', 'a2'], CFG, HOUSE, { sexes: { ...SEXES } }), [1])
    expect(conceptions(one, CONCEIVES, CFG, 2)).toEqual([])
    // The third night both partners them and can conceive, in that order.
    expect(conceptions(nights(one, [2]), CONCEIVES, CFG, 3)).toHaveLength(1)
  })

  it('does not fire on a night they slept apart', () => {
    const s = couple()
    const apart = { ...s, agents: { ...s.agents, a2: { ...s.agents.a2!, asleep: false } } }
    expect(conceptions(apart, CONCEIVES)).toEqual([])
  })

  it('does not fire for two of the same sex', () => {
    expect(conceptions(couple(CFG, { sexes: { a1: 'f', a2: 'f' } }), CONCEIVES)).toEqual([])
    expect(conceptions(couple(CFG, { sexes: { a1: 'm', a2: 'm' } }), CONCEIVES)).toEqual([])
  })

  it('does not fire outside the mother’s fertile years', () => {
    expect(conceptions(couple(CFG, { ages: { a1: 15 * 364 } }), CONCEIVES)).toEqual([])
    expect(conceptions(couple(CFG, { ages: { a1: 46 * 364 } }), CONCEIVES)).toEqual([])
    expect(conceptions(couple(CFG, { ages: { a1: 16 * 364 } }), CONCEIVES)).toHaveLength(1)
  })

  it('never stacks a second pregnancy on the first', () => {
    const carrying = fold(
      couple(),
      ev('agent_conceived', { motherId: 'a1', fatherId: 'a2', day: 4 }),
      CFG,
    )
    expect(conceptions(carrying, CONCEIVES, CFG, 5)).toEqual([])
  })

  it('goes quiet with the reproduction flag off', () => {
    expect(conceptions(couple(OFF), CONCEIVES, OFF)).toEqual([])
  })
})

describe('gestation and birth', () => {
  const TERM = DEFAULT_CONFIG.reproduction.gestationDays

  // A pregnancy backdated so the term completes exactly on the day under test.
  function carrying(sinceDay: number, config = CFG): WorldState {
    const s = world(['a1', 'a2'], config, HOUSE, { sexes: { a1: 'f', a2: 'm' } })
    return fold(s, ev('agent_conceived', { motherId: 'a1', fatherId: 'a2', day: sinceDay }), config)
  }

  const births = (s: WorldState, day: number, config = CFG, seed = 'repro') =>
    midnight(s, day, config, seed).events.filter((e) => e.type === 'agent_born')

  it('counts days, not ticks: nothing is born a day early', () => {
    expect(births(carrying(0), TERM - 1)).toEqual([])
    expect(births(carrying(0), TERM)).toHaveLength(1)
  })

  it('spawns the body at exactly twelve years of this world’s calendar', () => {
    const payload = births(carrying(0), TERM, CFG, 'r5')[0]!.payload as { id: string }
    const folded = fold(carrying(0), ev('agent_born', payload), CFG)
    expect(folded.agents[payload.id]!.ageDays).toBe(12 * DAYS_PER_YEAR)
    expect(ageBand(CFG, folded.agents[payload.id]!.ageDays)).toBe('child')
  })

  it('places the child beside its mother, aged twelve, with both parents named', () => {
    const born = midnight(carrying(0), TERM, CFG, 'r5').state
    const child = Object.values(born.agents).find((a) => a.id !== 'a1' && a.id !== 'a2')!
    expect(child.ageDays).toBe(12 * DAYS_PER_YEAR + 1) // agingSystem runs after this midnight's birth
    expect(child.parents).toEqual(['a1', 'a2'])
    expect(child.insideId).toBe(HOUSE.id)
    expect([child.x, child.y]).toEqual([born.agents.a1!.x, born.agents.a1!.y])
    expect(child.needs).toEqual({ hunger: 100, energy: 100, warmth: 100, social: 100 })
    expect(child.skills).toEqual({})
    expect(child.alive).toBe(true)
    expect(BIRTH_NAMES[sexOf(child)]).toContain(child.name)
  })

  it('empties the womb once and only once', () => {
    const born = midnight(carrying(0), TERM, CFG, 'r5').state
    expect(born.agents.a1!).not.toHaveProperty('pregnant')
    expect(births(born, TERM + 1)).toEqual([])
  })

  it('rolls the same registry name and sex for the same seed, and a different one for another', () => {
    const first = births(carrying(0), TERM, CFG, 'r5')[0]!.payload as { name: string; sex: string }
    const same = births(carrying(0), TERM, CFG, 'r5')[0]!.payload as { name: string; sex: string }
    expect(same).toEqual(first)
    const other = births(carrying(0), TERM, CFG, 'r29')[0]!.payload as { name: string; sex: string }
    expect(BIRTH_NAMES[other.sex as 'f' | 'm']).toContain(other.name)
  })

  it('keeps a birth outdoors outdoors', () => {
    const outside = carrying(0)
    const a1 = { ...outside.agents.a1!, x: 9, y: 9 }
    delete a1.insideId
    const s = { ...outside, agents: { ...outside.agents, a1 } }
    const child = Object.values(midnight(s, TERM, CFG, 'r5').state.agents).find(
      (a) => a.id !== 'a1' && a.id !== 'a2',
    )!
    expect(child).not.toHaveProperty('insideId')
    expect([child.x, child.y]).toEqual([9, 9])
  })

  it('goes quiet with the reproduction flag off', () => {
    expect(births(carrying(0, OFF), TERM, OFF)).toEqual([])
  })
})

describe('sex', () => {
  it('rides the spawn payload and defaults to f when it is omitted', () => {
    const s = world(['a1', 'a2'], CFG, HOUSE, { sexes: { a2: 'm' } })
    expect(s.agents.a1).not.toHaveProperty('sex')
    expect(sexOf(s.agents.a1!)).toBe('f')
    expect(s.agents.a2!.sex).toBe('m')
    expect(sexOf(s.agents.a2!)).toBe('m')
  })

  it('rejects a sex the world does not have', () => {
    expect(() =>
      fold(
        genesisState(CFG),
        ev('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300, sex: 'x' }),
        CFG,
      ),
    ).toThrow()
  })

  it('is left off the body entirely when reproduction is off, so old logs hash as before', () => {
    const s = fold(
      genesisState(DEFAULT_CONFIG),
      ev('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }),
      DEFAULT_CONFIG,
    )
    expect(s.agents.a1).not.toHaveProperty('sex')
  })
})
