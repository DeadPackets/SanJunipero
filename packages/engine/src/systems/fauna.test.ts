import { describe, it, expect } from 'vitest'
import { DAYS_PER_SEASON, MINUTES_PER_DAY, SimConfigSchema, stateHash, type SimConfig, type SimEvent } from '@sj/shared'
import { fold } from '../fold.js'
import { composePerception } from '../perception.js'
import type { RngState, RngStreams } from '../rng.js'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { createWorldTick, type WorldTickResult } from '../worldTick.js'
import { FAUNA_SPAWN_CHANCE } from './fauna.js'

// Nothing else may speak at dawn or midnight: no weather turn, no rumour, no wider map.
const QUIET = { weather: { hourlyChangeChance: 0 }, mystery: { chancePerDay: 0 }, mapGrowth: { enabled: false } }
const CFG: SimConfig = SimConfigSchema.parse(QUIET)
const OFF: SimConfig = SimConfigSchema.parse({ ...QUIET, fauna: { enabled: false } })

// A forced stream: the rolls are handed in, so a spawn or a step is a fact of the test and
// not of a seed somebody has to go hunting for.
function forced(values: number[]): RngStreams {
  let i = 0
  const nextValue = (): number => values[i++ % values.length]!
  const stream = {
    next: nextValue,
    int: (max: number) => Math.floor(nextValue() * max),
    state: (): RngState => [0, 0, 0, 0],
  }
  return { get: () => stream } as unknown as RngStreams
}

// grass, forest, water — the three habitats, and dirt for a tile nothing wants.
const CHAR_TILE: Record<string, TileId> = { '.': 0, f: 3, w: 2, d: 1 }
let seq = 31000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })

function world(rows: string[], config = CFG): WorldState {
  return genesisState(config, rows.map((row) => [...row].map((c) => CHAR_TILE[c]!)))
}

const MEADOW = ['.........', '.........', '.........', '.........', '.........']

function withFauna(
  s: WorldState, scatter: Array<{ id: string; kind: string; x: number; y: number; stock?: number }>, config = CFG,
): WorldState {
  for (const f of scatter) s = fold(s, ev('fauna_spawned', f), config)
  return s
}

function withAgent(s: WorldState, x: number, y: number, config = CFG): WorldState {
  return fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x, y, ageDays: 7300 }), config)
}

// One tick of the world at `tick`, with the rolls handed in.
function beat(s: WorldState, tick: number, rng: RngStreams, config = CFG): WorldTickResult {
  const advanced = fold({ ...s, tick: tick - 1 }, ev('tick_advanced', {}, tick), config)
  return createWorldTick(config, rng)(advanced)
}

const typed = (r: WorldTickResult, type: string) => r.events.filter((e) => e.type === type)

// Dawn on day 1 (hour 6) and dawn on the first winter day, three seasons on.
const DAWN = MINUTES_PER_DAY + 6 * 60
const WINTER_DAWN = (3 * DAYS_PER_SEASON + 1) * MINUTES_PER_DAY + 6 * 60

describe('fauna: absence is the default', () => {
  it('a fresh world has no fauna key at all and hashes like a pre-C11 world', () => {
    const fresh = world(MEADOW)
    expect(fresh.fauna).toBeUndefined()
    expect('fauna' in fresh).toBe(false)
    expect(stateHash(fresh)).toBe(stateHash(genesisState(CFG, fresh.terrain)))
  })

  it('the last body taken leaves the map absent again, not empty', () => {
    const s = withFauna(world(MEADOW), [{ id: 'fauna_1', kind: 'rabbit', x: 2, y: 2 }])
    const gone = fold(s, ev('fauna_killed', { id: 'fauna_1', kind: 'rabbit', x: 2, y: 2 }), CFG)
    expect(gone.fauna).toBeUndefined()
    // Only the counter remembers: an id spent is spent, which is the counter law, not the herd.
    const never = world(MEADOW)
    expect(stateHash(gone)).toBe(stateHash({ ...never, counters: { nextEntityId: 2 } }))
  })

  it('with the law off nothing moves and nothing is born', () => {
    const s = withFauna(world(MEADOW, OFF), [{ id: 'fauna_1', kind: 'rabbit', x: 2, y: 2 }], OFF)
    const out = beat(s, DAWN, forced([0]), OFF)
    expect(out.events.filter((e) => e.type.startsWith('fauna_'))).toEqual([])
  })
})

describe('fauna: the flee and the wander', () => {
  it('a deer three tiles from a body runs, and it runs two tiles', () => {
    const s = withAgent(withFauna(world(MEADOW), [{ id: 'fauna_1', kind: 'deer', x: 5, y: 2 }]), 2, 2)
    expect(CFG.fauna.fleeRadius).toBe(4)
    const out = beat(s, 4, forced([0]))
    expect(typed(out, 'fauna_moved').map((e) => e.payload))
      .toEqual([{ moves: [{ id: 'fauna_1', x: 7, y: 2 }] }])
    expect(out.state.fauna!.fauna_1).toMatchObject({ x: 7, y: 2 })
  })

  it('a deer five tiles away has not noticed, and wanders one tile on the roll it was given', () => {
    const s = withAgent(withFauna(world(MEADOW), [{ id: 'fauna_1', kind: 'deer', x: 7, y: 2 }]), 2, 2)
    // STEPS[4] is due south: roll 0.5 of eight directions.
    const out = beat(s, 4, forced([0.5]))
    expect(typed(out, 'fauna_moved').map((e) => e.payload))
      .toEqual([{ moves: [{ id: 'fauna_1', x: 7, y: 3 }] }])
  })

  it('a body will not wander off its own ground', () => {
    // Rabbit ground is grass and dirt; the forest row to the south is no place for it.
    const s = withFauna(world(['...', '...', 'fff']), [{ id: 'fauna_1', kind: 'rabbit', x: 1, y: 1 }])
    expect(typed(beat(s, 4, forced([0.5])), 'fauna_moved')).toEqual([])
  })

  it('the payload alone reproduces the positions — the fold never touches the stream', () => {
    const s = withAgent(withFauna(world(MEADOW), [
      { id: 'fauna_1', kind: 'deer', x: 5, y: 2 }, { id: 'fauna_2', kind: 'rabbit', x: 6, y: 3 },
    ]), 2, 2)
    const out = beat(s, 4, forced([0]))
    let replayed = { ...s, tick: 4 }
    for (const e of out.events) replayed = fold(replayed, ev(e.type, e.payload, 4), CFG)
    expect(replayed.fauna).toEqual(out.state.fauna)
  })

  it('moves on the beat and on no tick between two beats', () => {
    const s = withAgent(withFauna(world(MEADOW), [{ id: 'fauna_1', kind: 'deer', x: 5, y: 2 }]), 2, 2)
    expect(CFG.fauna.movePeriodTicks).toBe(4)
    for (const tick of [4, 8, 12]) expect(typed(beat(s, tick, forced([0])), 'fauna_moved')).toHaveLength(1)
    for (const tick of [5, 6, 7]) expect(typed(beat(s, tick, forced([0])), 'fauna_moved')).toEqual([])
  })
})

describe('fauna: the dawn regen', () => {
  // Every roll succeeds and every rolled tile is (0,0), which is grass on this map.
  const ALWAYS = () => forced([0])

  it('fills each kind exactly to its cap and never past it', () => {
    const out = beat(world(MEADOW), DAWN, ALWAYS())
    const born = typed(out, 'fauna_spawned').map((e) => e.payload as { kind: string })
    const perKind = (k: string) => born.filter((b) => b.kind === k).length
    // No water on this map, so the schools have nowhere to arrive.
    expect(perKind('deer')).toBe(CFG.fauna.caps.deer)
    expect(perKind('rabbit')).toBe(CFG.fauna.caps.rabbit)
    expect(perKind('fish')).toBe(0)
    expect(typed(beat(out.state, DAWN + MINUTES_PER_DAY, ALWAYS()), 'fauna_spawned')).toEqual([])
  })

  it('a school arrives as a school; a deer arrives alone', () => {
    const out = beat(world(['ww', 'ww']), DAWN, ALWAYS())
    const born = typed(out, 'fauna_spawned').map((e) => e.payload as { kind: string; stock?: number })
    expect(born.every((b) => b.kind === 'fish')).toBe(true)
    expect(born[0]).toMatchObject({ kind: 'fish', stock: 1 })
    expect(out.state.fauna!.fauna_1!.stock).toBe(1)
  })

  it('winter gives half the chances at the same ground, from the same rolls', () => {
    const spring = typed(beat(world(MEADOW), DAWN, ALWAYS()), 'fauna_spawned').length
    const winter = typed(beat(world(MEADOW), WINTER_DAWN, ALWAYS()), 'fauna_spawned').length
    expect(spring).toBe(CFG.fauna.caps.deer + CFG.fauna.caps.rabbit)
    expect(winter).toBeLessThanOrEqual(spring / 2)
    expect(winter).toBe(Math.floor(CFG.fauna.caps.deer / 2) + Math.floor(CFG.fauna.caps.rabbit / 2))
  })

  it('a roll above the chance puts nothing back', () => {
    expect(typed(beat(world(MEADOW), DAWN, forced([FAUNA_SPAWN_CHANCE])), 'fauna_spawned')).toEqual([])
  })

  it('a rolled tile that is no habitat stays empty', () => {
    // All dirt: a deer has no ground here and a rabbit does.
    const born = typed(beat(world(['dd', 'dd']), DAWN, forced([0])), 'fauna_spawned')
      .map((e) => (e.payload as { kind: string }).kind)
    expect(born).not.toContain('deer')
    expect(born).toContain('rabbit')
  })
})

describe('fauna: what a body can see of it', () => {
  const seen = (s: WorldState) => composePerception(s, CFG, 'a1', []).visible.fauna

  it('shows what is in sight, in id order, and nothing beyond it', () => {
    const far = CFG.movement.sightRadius + 1
    const s = withAgent(withFauna(world(Array.from({ length: far + 2 }, () => '.'.repeat(far + 2))), [
      { id: 'fauna_2', kind: 'rabbit', x: 1, y: 0 },
      { id: 'fauna_1', kind: 'deer', x: 2, y: 0 },
      { id: 'fauna_3', kind: 'rabbit', x: far, y: 0 },
    ]), 0, 0)
    expect(seen(s)).toEqual([
      { id: 'fauna_1', kind: 'deer', x: 2, y: 0 },
      { id: 'fauna_2', kind: 'rabbit', x: 1, y: 0 },
    ])
  })

  it('is empty in a world with no herd, and empty again behind four walls', () => {
    expect(seen(withAgent(world(MEADOW), 2, 2))).toEqual([])
    const s = withAgent(withFauna(world(MEADOW), [{ id: 'fauna_1', kind: 'rabbit', x: 2, y: 3 }]), 2, 2)
    const roofed = fold(fold(s, ev('structure_planned', {
      id: 'structure_1', kind: 'house', x: 1, y: 1, w: 3, h: 3, maxHp: 30, flammable: true, builderId: 'a1',
    }), CFG), ev('agent_entered', { agentId: 'a1', structureId: 'structure_1' }), CFG)
    expect(seen(roofed)).toEqual([])
  })
})
