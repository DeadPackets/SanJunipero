import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, MINUTES_PER_DAY, SimConfigSchema, type SimConfig, type SimEvent } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { fold } from '../fold.js'
import { RngStreams } from '../rng.js'
import { createWorldTick } from '../worldTick.js'
import { isPartnered, pairKey, partnershipOf, sexOf } from './reproduction.js'

// Partnership is inferred, never declared: the town reads it off who sleeps where.

const CFG: SimConfig = SimConfigSchema.parse({ weather: { hourlyChangeChance: 0 } })
const OFF: SimConfig = SimConfigSchema.parse({ weather: { hourlyChangeChance: 0 }, reproduction: { enabled: false } })

let seq = 50000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })

const HUT = { id: 'structure_1', kind: 'hut', x: 2, y: 2, w: 3, h: 3 }
const STORE = { id: 'structure_2', kind: 'storehouse', x: 8, y: 2, w: 3, h: 3 }

function room(config: SimConfig, box: typeof HUT): (s: WorldState) => WorldState {
  return (s) => {
    const planned = fold(s, ev('structure_planned', {
      ...box, maxHp: 50, flammable: true, builderId: 'a1',
    }), config)
    return fold(planned, ev('structure_completed', { id: box.id }), config)
  }
}

// Agents indoors and (by default) asleep, which is all the midnight pass looks at.
function world(
  ids: string[], config = CFG, box = HUT, opts: { awake?: string[]; sexes?: Record<string, 'f' | 'm'> } = {},
): WorldState {
  let s = genesisState(config, Array.from({ length: 16 }, () => Array.from({ length: 16 }, (): TileId => 0)))
  s = room(config, box)(s)
  for (const id of ids) {
    s = fold(s, ev('agent_spawned', {
      id, name: id, x: box.x, y: box.y, ageDays: 7300,
      ...(opts.sexes?.[id] === undefined ? {} : { sex: opts.sexes[id] }),
    }), config)
    s = fold(s, ev('agent_entered', { agentId: id, structureId: box.id }), config)
    if (!opts.awake?.includes(id)) s = fold(s, ev('agent_slept', { agentId: id }), config)
  }
  return s
}

function midnight(s: WorldState, day: number, config = CFG): { state: WorldState; coSlept: Array<{ type: string; payload: unknown }> } {
  const tick = day * MINUTES_PER_DAY
  const advanced = fold({ ...s, tick: tick - 1 }, ev('tick_advanced', {}, tick), config)
  const r = createWorldTick(config, new RngStreams('repro'))(advanced)
  return { state: r.state, coSlept: r.events.filter(e => e.type === 'co_slept') }
}

// Sleep through `days` consecutive midnights, starting at day 1.
function nights(s: WorldState, days: number[], config = CFG): WorldState {
  return days.reduce((acc, day) => midnight(acc, day, config).state, s)
}

describe('the midnight co-sleeping pass', () => {
  it('records the pair asleep in one hut', () => {
    const { state, coSlept } = midnight(world(['a1', 'a2']), 1)
    expect(coSlept).toEqual([{ type: 'co_slept', payload: { aId: 'a1', bId: 'a2', day: 1 } }])
    expect(partnershipOf(state, 'a1', 'a2')).toEqual({ nights: 1, lastNightDay: 1, formedTick: null, dissolvedTick: null })
  })

  it('ignores an occupant who is awake', () => {
    expect(midnight(world(['a1', 'a2'], CFG, HUT, { awake: ['a2'] }), 1).coSlept).toEqual([])
  })

  it('never counts a storehouse — a night together needs a private room', () => {
    expect(midnight(world(['a1', 'a2'], CFG, STORE), 1).coSlept).toEqual([])
  })

  it('pairs three occupants three ways, in a deterministic order', () => {
    expect(midnight(world(['a3', 'a1', 'a2']), 1).coSlept.map(e => e.payload)).toEqual([
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
    expect(partnershipOf(midnight(three, 4).state, 'a1', 'a2')!.formedTick).toBe(3 * MINUTES_PER_DAY)
  })

  it('leaves both transition fields null for a pair that never got there', () => {
    expect(partnershipOf(nights(world(['a1', 'a2']), [1, 2]), 'a1', 'a2'))
      .toEqual({ nights: 2, lastNightDay: 2, formedTick: null, dissolvedTick: null })
  })

  it('resets the count to one after a gap wider than the window', () => {
    const s = nights(world(['a1', 'a2']), [1, 2, 11]) // 9-day gap
    expect(partnershipOf(s, 'a1', 'a2')).toEqual({ nights: 1, lastNightDay: 11, formedTick: null, dissolvedTick: null })
  })

  it('stamps dissolvedTick at the gap-reset midnight once they were partnered', () => {
    const partnered = nights(world(['a1', 'a2']), [1, 2, 3])
    expect(partnershipOf(partnered, 'a1', 'a2')!.formedTick).toBe(3 * MINUTES_PER_DAY)
    const apart = midnight(partnered, 12).state // 9-day gap
    expect(partnershipOf(apart, 'a1', 'a2')).toEqual({
      nights: 1, lastNightDay: 12, formedTick: 3 * MINUTES_PER_DAY, dissolvedTick: 12 * MINUTES_PER_DAY,
    })
    expect(isPartnered(apart, 'a1', 'a2', CFG)).toBe(false)
  })

  it('re-stamps formedTick and clears dissolvedTick when they find each other again', () => {
    const apart = nights(world(['a1', 'a2']), [1, 2, 3, 12])
    expect(partnershipOf(apart, 'a1', 'a2')!.dissolvedTick).toBe(12 * MINUTES_PER_DAY)
    const again = nights(apart, [13, 14])
    expect(partnershipOf(again, 'a1', 'a2')).toEqual({
      nights: 3, lastNightDay: 14, formedTick: 14 * MINUTES_PER_DAY, dissolvedTick: null,
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

describe('sex', () => {
  it('rides the spawn payload and defaults to f when it is omitted', () => {
    const s = world(['a1', 'a2'], CFG, HUT, { sexes: { a2: 'm' } })
    expect(s.agents.a1).not.toHaveProperty('sex')
    expect(sexOf(s.agents.a1!)).toBe('f')
    expect(s.agents.a2!.sex).toBe('m')
    expect(sexOf(s.agents.a2!)).toBe('m')
  })

  it('rejects a sex the world does not have', () => {
    expect(() => fold(genesisState(CFG), ev('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300, sex: 'x' }), CFG))
      .toThrow()
  })

  it('is left off the body entirely when reproduction is off, so old logs hash as before', () => {
    const s = fold(genesisState(DEFAULT_CONFIG), ev('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }), DEFAULT_CONFIG)
    expect(s.agents.a1).not.toHaveProperty('sex')
  })
})
