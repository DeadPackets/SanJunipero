import { describe, it, expect } from 'vitest'
import {
  ADULT_AGE_DAYS,
  DAYS_PER_YEAR,
  DEFAULT_CONFIG,
  MINUTES_PER_DAY,
  SimConfigSchema,
  type SimConfig,
} from '@sj/shared'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { fold } from '../fold.js'
import { RngStreams } from '../rng.js'
import { createWorldTick } from '../worldTick.js'
import { ageBand } from './aging.js'
import { BIRTH_NAMES } from '../data/names.js'
import { sexOf } from './reproduction.js'
import { ev } from '../testutil/world.js'

// A night under one roof is witnessed and nothing more; who is partnered is chosen aloud.

const CFG: SimConfig = SimConfigSchema.parse({ weather: { hourlyChangeChance: 0 } })
const OFF: SimConfig = SimConfigSchema.parse({
  weather: { hourlyChangeChance: 0 },
  reproduction: { enabled: false },
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
        ageDays: opts.ages?.[id] ?? 30 * DAYS_PER_YEAR,
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
  it('records the pair asleep in one house, and forms nothing by it', () => {
    const before = world(['a1', 'a2'])
    const { state, coSlept } = midnight(before, 1)
    expect(coSlept).toEqual([{ type: 'co_slept', payload: { aId: 'a1', bId: 'a2', day: 1 } }])
    expect(state.agents.a1).not.toHaveProperty('partnerId')
    expect(state.agents.a2).not.toHaveProperty('partnerId')
  })

  it('folds to the very same state: three nights make no pair and no child', () => {
    const s = world(['a1', 'a2'], CFG, HOUSE, { sexes: { a1: 'f', a2: 'm' } })
    const witnessed = fold(s, ev('co_slept', { aId: 'a1', bId: 'a2', day: 1 }), CFG)
    expect(witnessed).toBe(s)
    const three = nights(s, [1, 2, 3])
    expect(three.agents.a1).not.toHaveProperty('partnerId')
    for (const day of [4, 5, 6]) {
      expect(midnight(three, day).events.filter((e) => e.type === 'agent_conceived')).toEqual([])
    }
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
        ev('agent_spawned', {
          id: 'a1',
          name: 'a1',
          x: 0,
          y: 0,
          ageDays: ADULT_AGE_DAYS,
          sex: 'x',
        }),
        CFG,
      ),
    ).toThrow()
  })

  it('is left off the body entirely when reproduction is off, so old logs hash as before', () => {
    const s = fold(
      genesisState(DEFAULT_CONFIG),
      ev('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: ADULT_AGE_DAYS }),
      DEFAULT_CONFIG,
    )
    expect(s.agents.a1).not.toHaveProperty('sex')
  })
})
