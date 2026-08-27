import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CONFIG,
  MINUTES_PER_DAY,
  SimConfigSchema,
  stateHash,
  type SimConfig,
  type SimEvent,
} from '@sj/shared'
import { openDb } from './db.js'
import { EventStore } from './eventStore.js'
import { fold } from './fold.js'
import { applyLaw, effectiveConfig, TOGGLABLE_PATHS, type LawQueue } from './laws.js'
import { replayFromGenesis, replayLatest } from './replay.js'
import { RngStreams } from './rng.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { TickLoop } from './tickLoop.js'
import { createWorldTick } from './worldTick.js'

// A law is a fact about the world, so it travels the only road facts travel:
// one event, folded, hashed, snapshotted, replayed.

const CFG: SimConfig = SimConfigSchema.parse({
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
})

let seq = 70000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({
  seq: seq++,
  tick,
  type,
  payload,
})

const MAP = (): TileId[][] =>
  Array.from({ length: 16 }, () => Array.from({ length: 16 }, (): TileId => 0))

function world(): WorldState {
  const s = genesisState(CFG, MAP())
  return fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 2, y: 2, ageDays: 7300 }), CFG)
}

describe('effectiveConfig', () => {
  it('with no laws it hands back the very same object — no clone, no drift', () => {
    expect(effectiveConfig(CFG)).toBe(CFG)
    expect(effectiveConfig(CFG, {})).toBe(CFG)
  })

  it('overrides exactly the flipped path and nothing beside it', () => {
    const out = effectiveConfig(CFG, { 'spoilage.enabled': false })
    expect(out.spoilage.enabled).toBe(false)
    expect(out.spoilage.days).toEqual(CFG.spoilage.days)
    expect(out.reproduction).toEqual(CFG.reproduction)
    expect(CFG.spoilage.enabled).toBe(true) // the base is never mutated
  })

  it('reaches a nested dial two levels down', () => {
    const out = effectiveConfig(CFG, { 'seasons.winter.fishCatchMultiplier': 0.1 })
    expect(out.seasons.winter.fishCatchMultiplier).toBe(0.1)
    expect(out.seasons.winter.hungerDecayMultiplier).toBe(CFG.seasons.winter.hungerDecayMultiplier)
  })

  it('is memoized on the laws object, so a settled world derives once', () => {
    const laws = { 'ownership.enabled': false }
    expect(effectiveConfig(CFG, laws)).toBe(effectiveConfig(CFG, laws))
  })

  it('every whitelisted path names a field the config actually has', () => {
    for (const path of Object.keys(TOGGLABLE_PATHS)) {
      let node: unknown = DEFAULT_CONFIG
      for (const key of path.split('.')) {
        expect(node).toBeTypeOf('object')
        node = (node as Record<string, unknown>)[key]
      }
      expect(node).toBeDefined()
    }
  })

  // Driven from an explicit array, not from the table itself: a missing whitelist entry has to
  // fail loudly, and a table-derived loop would happily agree with its own omission.
  const C9_LAW_PATHS = [
    'reproduction.enabled',
    'aging.deathOfOldAgeEnabled',
    'spoilage.enabled',
    'tools.wearEnabled',
    'mystery.enabled',
    'occlusion.enabled',
    'ownership.enabled',
    'inscription.enabled',
  ]
  const C11_LAW_PATHS = [
    'mortality.enabled',
    'illness.enabled',
    'thirst.enabled',
    'fertility.enabled',
    'roads.enabled',
    'desirePaths.enabled',
    'fauna.enabled',
    'warmth.enabled',
    'light.enabled',
    'nightWitness.enabled',
    'foodVariety.enabled',
    'regrowth.enabled',
    'mapGrowth.enabled',
    'constructs.enabled',
    'constructs.minParticipants',
    'mortality.poisonChanceSpoiled',
    'illness.dailyWorsenChance',
    'illness.contagionEnabled',
    'illness.contagionChance',
    'thirst.decayFactorOfHunger',
    'desirePaths.wearThreshold',
    'light.nightWorkPenalty',
    'light.fireRiskPerTick',
    'nightWitness.nightFactor',
    'regrowth.saplingChancePerDay',
  ]

  it('every C9 and C11 flag and starred dial is a world law with a value schema', () => {
    for (const path of [...C9_LAW_PATHS, ...C11_LAW_PATHS])
      expect(TOGGLABLE_PATHS[path]).toBeDefined()
  })

  it('the C11 value schemas reject the wrong shape and the out-of-range value', () => {
    expect(TOGGLABLE_PATHS['mortality.enabled']!.safeParse(true).success).toBe(true)
    expect(TOGGLABLE_PATHS['mortality.enabled']!.safeParse('yes').success).toBe(false)
    expect(TOGGLABLE_PATHS['illness.contagionChance']!.safeParse(0.4).success).toBe(true)
    expect(TOGGLABLE_PATHS['illness.contagionChance']!.safeParse(1.4).success).toBe(false)
    expect(TOGGLABLE_PATHS['desirePaths.wearThreshold']!.safeParse(60).success).toBe(true)
    expect(TOGGLABLE_PATHS['desirePaths.wearThreshold']!.safeParse(-1).success).toBe(false)
    expect(TOGGLABLE_PATHS['light.nightWorkPenalty']!.safeParse(2).success).toBe(true)
    expect(TOGGLABLE_PATHS['light.nightWorkPenalty']!.safeParse(0).success).toBe(false)
  })

  // world.size is a genesis input, not a dial: growing the map mid-run is world_grown's job.
  it('world.size is not toggleable', () => {
    expect(TOGGLABLE_PATHS['world.size']).toBeUndefined()
  })
})

describe('fold: config_changed', () => {
  it('sets the law and, because laws are hashed, moves the state hash', () => {
    const before = world()
    const after = fold(
      before,
      ev('config_changed', { path: 'spoilage.enabled', value: false }),
      CFG,
    )
    expect(after.laws).toEqual({ 'spoilage.enabled': false })
    expect(stateHash(after)).not.toBe(stateHash(before))
  })

  it('a world that never legislates carries no laws key at all', () => {
    expect(world().laws).toBeUndefined()
  })

  it('rejects a path that is not on the whitelist', () => {
    expect(() =>
      fold(world(), ev('config_changed', { path: 'movement.sightRadius', value: 40 }), CFG),
    ).toThrow(/not a world law/)
  })

  it('rejects a string where the law wants a boolean', () => {
    expect(() =>
      fold(world(), ev('config_changed', { path: 'spoilage.enabled', value: 'off' }), CFG),
    ).toThrow(/rejected/)
    expect(() =>
      fold(world(), ev('config_changed', { path: 'mystery.chancePerDay', value: 4 }), CFG),
    ).toThrow(/rejected/)
  })

  it('the latest flip of a path wins and the others stay put', () => {
    let s = fold(world(), ev('config_changed', { path: 'ownership.enabled', value: false }), CFG)
    s = fold(s, ev('config_changed', { path: 'mystery.enabled', value: false }), CFG)
    s = fold(s, ev('config_changed', { path: 'ownership.enabled', value: true }), CFG)
    expect(s.laws).toEqual({ 'ownership.enabled': true, 'mystery.enabled': false })
  })

  it('the fold itself reads the law it just set — replay cannot drift from the live run', () => {
    // partnerWindowDays is read inside the co_slept fold; widen it and the same gap stops breaking the pair.
    let s = world()
    s = fold(s, ev('agent_spawned', { id: 'a2', name: 'a2', x: 3, y: 2, ageDays: 7300 }), CFG)
    s = fold(s, ev('co_slept', { aId: 'a1', bId: 'a2', day: 0 }), CFG)
    const narrow = fold(s, ev('co_slept', { aId: 'a1', bId: 'a2', day: 20 }), CFG)
    expect(narrow.pairNights!['a1|a2']!.nights).toBe(1) // the gap broke the run

    const widened = fold(
      s,
      ev('config_changed', { path: 'reproduction.partnerWindowDays', value: 40 }),
      CFG,
    )
    const kept = fold(widened, ev('co_slept', { aId: 'a1', bId: 'a2', day: 20 }), CFG)
    expect(kept.pairNights!['a1|a2']!.nights).toBe(2)
  })
})

describe('worldTick: laws drain at the boundary', () => {
  const tickAt = (state: WorldState, tick: number, queue?: LawQueue) => {
    const advanced = fold({ ...state, tick: tick - 1 }, ev('tick_advanced', {}, tick), CFG)
    return createWorldTick(CFG, new RngStreams('laws'), queue)(advanced)
  }

  it('drains every queued law first, before a single system runs', () => {
    const queue: LawQueue = []
    applyLaw(queue, 'mystery.enabled', false)
    applyLaw(queue, 'ownership.enabled', false)
    const res = tickAt(world(), 100, queue)
    expect(res.events.slice(0, 2)).toEqual([
      { type: 'config_changed', payload: { path: 'mystery.enabled', value: false } },
      { type: 'config_changed', payload: { path: 'ownership.enabled', value: false } },
    ])
    expect(res.events.slice(2).some((e) => e.type === 'config_changed')).toBe(false)
    expect(queue).toHaveLength(0)
  })

  it('the flip is live for the systems of that very tick', () => {
    const noon = MINUTES_PER_DAY + 12 * 60
    const certain: LawQueue = []
    applyLaw(certain, 'mystery.chancePerDay', 1)
    expect(tickAt(world(), noon, certain).events.some((e) => e.type === 'mystery_event')).toBe(true)
    expect(tickAt(world(), noon).events.some((e) => e.type === 'mystery_event')).toBe(false)
  })

  it('a law queued after the drain waits for the next tick, never lands mid-tick', () => {
    const queue: LawQueue = []
    const first = tickAt(world(), 100, queue)
    expect(first.events.some((e) => e.type === 'config_changed')).toBe(false)
    applyLaw(queue, 'ownership.enabled', false)
    expect(first.state.laws).toBeUndefined()
    const second = tickAt(first.state, 101, queue)
    expect(second.state.laws).toEqual({ 'ownership.enabled': false })
  })

  it('an empty queue emits nothing and leaves the world exactly as it was', () => {
    const res = tickAt(world(), 100, [])
    expect(res.events.some((e) => e.type === 'config_changed')).toBe(false)
    expect(res.state.laws).toBeUndefined()
  })
})

describe('laws survive the wire: replay and snapshots', () => {
  function runWithFlips(dbPath = ':memory:'): { loop: TickLoop; store: EventStore } {
    const store = new EventStore(openDb(dbPath))
    const queue: LawQueue = []
    const rng = new RngStreams('laws-run')
    const worldTick = createWorldTick(CFG, rng, queue)
    const loop: TickLoop = new TickLoop({
      store,
      state: genesisState(CFG, MAP()),
      rng,
      config: CFG,
      snapshotEveryTicks: 10,
      onTick: ({ tick, emit }) => {
        if (tick === 1) emit('agent_spawned', { id: 'a1', name: 'a1', x: 2, y: 2, ageDays: 7300 })
        if (tick === 12) {
          applyLaw(queue, 'spoilage.enabled', false)
          applyLaw(queue, 'mystery.chancePerDay', 1)
        }
        for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
      },
    })
    for (let i = 0; i < 40; i++) loop.step()
    return { loop, store }
  }

  it('replay from genesis reproduces the identical hash, flips and all', () => {
    const { loop, store } = runWithFlips()
    expect(loop.state.laws).toEqual({ 'spoilage.enabled': false, 'mystery.chancePerDay': 1 })
    expect(stateHash(replayFromGenesis(store, CFG, MAP()))).toBe(stateHash(loop.state))
  })

  it('a snapshot carries the laws across a recovery', () => {
    const { loop, store } = runWithFlips()
    const recovered = replayLatest(store, CFG, MAP())
    expect(recovered.state.laws).toEqual(loop.state.laws)
    expect(stateHash(recovered.state)).toBe(stateHash(loop.state))
  })
})
