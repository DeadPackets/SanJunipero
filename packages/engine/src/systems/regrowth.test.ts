import { describe, it, expect } from 'vitest'
import {
  MINUTES_PER_DAY,
  SimConfigSchema,
  stateHash,
  type SimConfig,
  type SimEvent,
} from '@sj/shared'
import { fold } from '../fold.js'
import { submitIntent } from '../intent.js'
import { stepCostAt, isPassable } from '../path.js'
import { RngStreams } from '../rng.js'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { CLEAR_TICKS, FELL_TICKS, TIMBER_PER_TREE, VERBS } from '../verbs.js'
import { createWorldTick, type WorldTickResult } from '../worldTick.js'
import { saplingKey } from './regrowth.js'

const quiet = {
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  mapGrowth: { enabled: false },
  fauna: { enabled: false },
  desirePaths: { enabled: false },
}
const CFG: SimConfig = SimConfigSchema.parse(quiet)
const SURE: SimConfig = SimConfigSchema.parse({ ...quiet, regrowth: { saplingChancePerDay: 1 } })
const OFF: SimConfig = SimConfigSchema.parse({ ...quiet, regrowth: { enabled: false } })
const DAYS = CFG.regrowth.saplingDays

let seq = 98000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({
  seq: seq++,
  tick,
  type,
  payload,
})

// One forest tile at (2,2). Its orthogonal neighbours are grass; (1,1) is diagonal only.
function wood(config = CFG, tick = 0): WorldState {
  const t = Array.from({ length: 6 }, () => Array.from({ length: 6 }, (): TileId => 0))
  t[2]![2] = 3
  const s = genesisState(config, t)
  return { ...s, tick }
}
const midnightOf = (day: number): number => day * MINUTES_PER_DAY - 1

function tickOnce(s: WorldState, config = CFG): WorldTickResult {
  return createWorldTick(
    config,
    new RngStreams('rg'),
  )(fold(s, ev('tick_advanced', {}, s.tick + 1), config))
}
const seeded = (r: WorldTickResult) =>
  r.events
    .filter(
      (e) => e.type === 'tile_changed' && (e.payload as { reason: string }).reason === 'seeded',
    )
    .map((e) => e.payload as { x: number; y: number; from: number; to: number })

describe('seeding: the forest edge creeps back into the grass', () => {
  it('seeds every orthogonal neighbour on a certain roll, and no diagonal one', () => {
    const out = seeded(tickOnce(wood(SURE, midnightOf(1)), SURE))
    expect(out.map((p) => [p.x, p.y]).sort()).toEqual([
      [1, 2],
      [2, 1],
      [2, 3],
      [3, 2],
    ])
    expect(out.every((p) => p.from === 0 && p.to === 9)).toBe(true)
    expect(out.map((p) => [p.x, p.y])).not.toContainEqual([1, 1])
  })

  it('only speaks at midnight, and never with the law switched off', () => {
    expect(seeded(tickOnce(wood(SURE, 12 * 60), SURE))).toEqual([])
    expect(seeded(tickOnce(wood(OFF, midnightOf(1)), OFF))).toEqual([])
  })

  it('stamps the day it was seeded, sparsely, and nowhere else', () => {
    const s = tickOnce(wood(SURE, midnightOf(1)), SURE).state
    expect(s.saplings).toEqual({
      [saplingKey(1, 2)]: 1,
      [saplingKey(2, 1)]: 1,
      [saplingKey(2, 3)]: 1,
      [saplingKey(3, 2)]: 1,
    })
    expect(wood(SURE).saplings).toBeUndefined()
  })

  it('never seeds a tile that is not grass', () => {
    const paved = { ...wood(SURE, midnightOf(1)) }
    const terrain = paved.terrain.map((row, y) => row.map((t, x) => (x === 1 && y === 2 ? 7 : t)))
    expect(seeded(tickOnce({ ...paved, terrain }, SURE)).map((p) => [p.x, p.y])).not.toContainEqual(
      [1, 2],
    )
  })
})

describe('maturity: a sapling is a forest thirty days later, to the day', () => {
  // Planted with a certain roll, then left alone: no further seeding while the clock runs.
  const NOSEED: SimConfig = SimConfigSchema.parse({
    ...quiet,
    regrowth: { saplingChancePerDay: 0 },
  })
  const planted = (): WorldState => tickOnce(wood(SURE, midnightOf(1)), SURE).state
  const grown = (r: WorldTickResult) =>
    r.events
      .filter(
        (e) => e.type === 'tile_changed' && (e.payload as { reason: string }).reason === 'grown',
      )
      .map((e) => e.payload as { x: number; y: number; to: number })

  it('does not grow on the day before, and grows on the day itself', () => {
    const early = tickOnce({ ...planted(), tick: midnightOf(1 + DAYS - 1) }, NOSEED)
    expect(grown(early)).toEqual([])
    const due = tickOnce({ ...planted(), tick: midnightOf(1 + DAYS) }, NOSEED)
    expect(
      grown(due)
        .map((p) => [p.x, p.y])
        .sort(),
    ).toEqual([
      [1, 2],
      [2, 1],
      [2, 3],
      [3, 2],
    ])
    expect(grown(due).every((p) => p.to === 3)).toBe(true)
  })

  it('drops the stamp when it grows, so a grown wood hashes like one that was always there', () => {
    const due = tickOnce({ ...planted(), tick: midnightOf(1 + DAYS) }, NOSEED)
    expect(due.state.saplings).toBeUndefined()
    expect(Object.keys(due.state)).not.toContain('saplings')
    const t = Array.from({ length: 6 }, () => Array.from({ length: 6 }, (): TileId => 0))
    for (const [x, y] of [
      [2, 2],
      [1, 2],
      [2, 1],
      [2, 3],
      [3, 2],
    ])
      t[y!]![x!] = 3
    // Same clock and same sky, so the only thing left to differ is whether the ground still
    // remembers being planted. It does not.
    const always: WorldState = {
      ...genesisState(NOSEED, t),
      tick: due.state.tick,
      weather: due.state.weather,
    }
    expect(stateHash(due.state)).toBe(stateHash(always))
  })
})

describe('a sapling is ground you can walk on and ground you can clear', () => {
  const sapling = (config = CFG): WorldState => {
    const t = Array.from({ length: 6 }, () => Array.from({ length: 6 }, (): TileId => 0))
    t[2]![2] = 3
    t[1]![2] = 9
    let s = { ...genesisState(config, t), tick: 720 }
    s = fold(
      s,
      ev('agent_spawned', { id: 'a1', name: 'a1', x: 2, y: 0, ageDays: 7300 }, 720),
      config,
    )
    return s
  }

  it('walks like the grass it grew from', () => {
    const s = sapling()
    expect(isPassable(s, 2, 1)).toBe(true)
    expect(stepCostAt(s, 2, 1, CFG)).toBe(1)
  })

  it('is chopped back to grass, and yields nothing at all', () => {
    const s = sapling()
    const r = submitIntent(s, CFG, 'a1', 'chop', { x: 2, y: 1 })
    expect(r.ok).toBe(true)
    const out = VERBS.chop!.onComplete(
      s,
      CFG,
      'a1',
      { x: 2, y: 1 },
      new RngStreams('c').get('actions'),
    )
    expect(out).toEqual([
      {
        type: 'tile_changed',
        payload: { x: 2, y: 1, from: 9, to: 0, reason: 'cleared', byId: 'a1' },
      },
    ])
    expect(out.some((e) => e.type === 'item_spawned')).toBe(false)
    let after = s
    for (const e of out) after = fold(after, ev(e.type, e.payload, s.tick), CFG)
    expect(after.terrain[1]![2]).toBe(0)
  })

  it('refuses bare ground: a swing needs something standing in front of it', () => {
    const s = sapling()
    const r = submitIntent(s, CFG, 'a1', 'chop', { x: 3, y: 0 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('there is nothing standing there to cut')
    // The tree two tiles off is a legal target and still out of arm's reach.
    const far = submitIntent(s, CFG, 'a1', 'chop', { x: 2, y: 2 })
    expect(far.ok).toBe(false)
    if (!far.ok) expect(far.reason).toBe('not close enough to cut')
  })

  it('clearing a sapling takes its stamp with it, so the ground forgets it was ever planted', () => {
    let s = tickOnce(wood(SURE, midnightOf(1)), SURE).state
    expect(s.saplings?.[saplingKey(2, 1)]).toBe(1)
    s = fold(
      s,
      ev('tile_changed', { x: 2, y: 1, from: 9, to: 0, reason: 'cleared', byId: 'a1' }, s.tick),
      SURE,
    )
    expect(s.saplings?.[saplingKey(2, 1)]).toBeUndefined()
  })
})

describe('the wood loop: felling is the consumer the regrowth cycle was missing', () => {
  function stand(config = CFG, trees: [number, number][] = [[2, 2]]): WorldState {
    const t = Array.from({ length: 6 }, () => Array.from({ length: 6 }, (): TileId => 0))
    for (const [x, y] of trees) t[y]![x] = 3
    const s = { ...genesisState(config, t), tick: 720 }
    return fold(
      s,
      ev('agent_spawned', { id: 'a1', name: 'a1', x: 2, y: 1, ageDays: 7300 }, 720),
      config,
    )
  }

  it('a tree costs a long swing and hands over timber the town can build with', () => {
    const s = stand()
    const r = submitIntent(s, CFG, 'a1', 'chop', { x: 2, y: 2 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const started = r.events.find((e) => e.type === 'action_started')!.payload as {
        duration: number
      }
      expect(started.duration).toBe(FELL_TICKS)
    }
    expect(FELL_TICKS).toBeGreaterThan(CLEAR_TICKS)

    const out = VERBS.chop!.onComplete(
      s,
      CFG,
      'a1',
      { x: 2, y: 2 },
      new RngStreams('c').get('actions'),
    )
    expect(out[0]).toEqual({
      type: 'tile_changed',
      payload: { x: 2, y: 2, from: 3, to: 0, reason: 'cleared', byId: 'a1' },
    })
    const timber = out.find((e) => e.type === 'item_spawned')!.payload as Record<string, unknown>
    expect(timber.kind).toBe('wood')
    expect(timber.qty).toBe(TIMBER_PER_TREE)
    expect(timber.loc).toEqual({ t: 'agent', id: 'a1' })
  })

  it('the stump is grass, and grass beside a wood is where the next sapling comes up', () => {
    let s = stand(SURE, [
      [2, 2],
      [3, 2],
    ])
    const out = VERBS.chop!.onComplete(
      s,
      SURE,
      'a1',
      { x: 2, y: 2 },
      new RngStreams('c').get('actions'),
    )
    for (const e of out) s = fold(s, ev(e.type, e.payload, s.tick), SURE)
    expect(s.terrain[2]![2]).toBe(0)
    const seeds = seeded(tickOnce({ ...s, tick: midnightOf(1) }, SURE))
    expect(seeds.some((p) => p.x === 2 && p.y === 2)).toBe(true)
  })

  it('a sapling is still a sapling: four ticks, and nothing to carry away', () => {
    const s = stand(CFG, [])
    const young = fold(
      s,
      ev('tile_changed', { x: 2, y: 2, from: 0, to: 9, reason: 'seeded' }, s.tick),
      CFG,
    )
    const r = submitIntent(young, CFG, 'a1', 'chop', { x: 2, y: 2 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const started = r.events.find((e) => e.type === 'action_started')!.payload as {
        duration: number
      }
      expect(started.duration).toBe(CLEAR_TICKS)
    }
    const out = VERBS.chop!.onComplete(
      young,
      CFG,
      'a1',
      { x: 2, y: 2 },
      new RngStreams('c').get('actions'),
    )
    expect(out.some((e) => e.type === 'item_spawned')).toBe(false)
  })
})

describe('forageable nodes climb back toward what the world authored', () => {
  const REGROW: SimConfig = SimConfigSchema.parse(quiet)
  const DAWN = 6 * 60

  const bush = (stock: number, fullStock?: number): WorldState => {
    const s = {
      ...genesisState(
        REGROW,
        Array.from({ length: 4 }, () => Array.from({ length: 4 }, (): TileId => 0)),
      ),
      tick: DAWN - 1,
    }
    return fold(
      s,
      ev(
        'forageable_spawned',
        {
          id: 'node_1',
          kind: 'berry_bush',
          x: 1,
          y: 1,
          stock,
          ...(fullStock === undefined ? {} : { fullStock }),
        },
        s.tick,
      ),
      REGROW,
    )
  }

  it('remembers the abundance it was authored with', () => {
    expect(bush(6, 6).forageables!.node_1!.fullStock).toBe(6)
    // A node spawned by a recorded log that never knew the field keeps the old ceiling of one.
    expect(bush(6).forageables!.node_1!.fullStock).toBeUndefined()
  })

  // One stream across the whole run: a fresh RngStreams per tick would draw the same number
  // every dawn and the bush would never come back at all.
  const dawns = (start: WorldState, n: number): WorldState => {
    const rng = new RngStreams('fg')
    let s = start
    for (let i = 0; i < n; i++) {
      s = createWorldTick(REGROW, rng)(fold(s, ev('tick_advanced', {}, s.tick + 1), REGROW)).state
      s = { ...s, tick: DAWN - 1 + (i + 1) * MINUTES_PER_DAY }
    }
    return s
  }

  it('regrows a picked bush one handful at a time, and stops at what it was', () => {
    const s = dawns(bush(0, 3), 80)
    expect(s.forageables!.node_1!.stock).toBe(3)
    const full = createWorldTick(
      REGROW,
      new RngStreams('fg2'),
    )(fold(s, ev('tick_advanced', {}, s.tick + 1), REGROW))
    expect(full.events.some((e) => e.type === 'forageable_regrown')).toBe(false)
  })

  it('is a cycle, not a ratchet: an old node with no ceiling still crawls back to one', () => {
    const s = dawns(bush(0), 80)
    expect(s.forageables!.node_1!.stock).toBe(1)
  })
})
