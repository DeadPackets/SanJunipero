import { describe, it, expect } from 'vitest'
import {
  MINUTES_PER_DAY,
  SimConfigSchema,
  stateHash,
  type SimConfig,
} from '@sj/shared'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { fold } from '../fold.js'
import { stepCostAt, terrainCostFor } from '../path.js'
import { RngStreams } from '../rng.js'
import { createWorldTick, type WorldTickResult } from '../worldTick.js'
import { trafficKey } from './desirePaths.js'
import { ev } from '../testutil/world.js'

// Nothing else may speak at midnight: no weather turn, no rumour, no wider map.
const CFG: SimConfig = SimConfigSchema.parse({
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  mapGrowth: { enabled: false },
})
const OFF: SimConfig = SimConfigSchema.parse({
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  mapGrowth: { enabled: false },
  desirePaths: { enabled: false },
})

const CHAR_TILE: Record<string, TileId> = { '.': 0, p: 8 }

function meadow(rows: string[] = ['...', '...', '...'], config = CFG): WorldState {
  return genesisState(
    config,
    rows.map((row) => Array.from(row).map((c) => CHAR_TILE[c]!)),
  )
}

function withWalker(s: WorldState, config = CFG): WorldState {
  const spawned = fold(
    s,
    ev('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }),
    config,
  )
  const a1 = spawned.agents.a1!
  return {
    ...spawned,
    agents: {
      a1: {
        ...a1,
        activity: { verb: 'walk', ticksRemaining: 999, params: { x: 1, y: 1 }, path: [[1, 1]] },
      },
    },
  }
}

function cross(s: WorldState, times: number, config = CFG): WorldState {
  for (let i = 0; i < times; i++)
    s = fold(s, ev('agent_moved', { id: 'a1', x: 1, y: 1 }, s.tick), config)
  return s
}

// One midnight: the tick that rolls the day over, and the systems that answer to it.
function midnight(s: WorldState, day: number, config = CFG): WorldTickResult {
  const eve = { ...s, tick: day * MINUTES_PER_DAY - 1 }
  return createWorldTick(
    config,
    new RngStreams('t'),
  )(fold(eve, ev('tick_advanced', {}, day * MINUTES_PER_DAY), config))
}
const tileEvents = (r: WorldTickResult) => r.events.filter((e) => e.type === 'tile_changed')

describe('traffic: the walk itself is the record', () => {
  it("counts a walker's steps, ignores a body that simply appears, and stays absent when the law is off", () => {
    expect(cross(withWalker(meadow()), 3).traffic).toEqual({ [trafficKey(1, 1)]: 3 })
    const teleported = fold(
      fold(meadow(), ev('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }), CFG),
      ev('agent_moved', { id: 'a1', x: 1, y: 1 }),
      CFG,
    )
    expect(teleported.traffic).toBeUndefined()
    expect(
      cross(withWalker(meadow(['...', '...', '...'], OFF), OFF), 3, OFF).traffic,
    ).toBeUndefined()
  })

  it('a fresh world carries no counter at all and hashes as a pre-C11 world does', () => {
    const fresh = meadow()
    expect(fresh.traffic).toBeUndefined()
    expect(fresh.quietSince).toBeUndefined()
    expect('traffic' in fresh).toBe(false)
    const spawned = fold(
      fresh,
      ev('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }),
      CFG,
    )
    expect(stateHash(fold(spawned, ev('agent_moved', { id: 'a1', x: 1, y: 1 }), CFG))).toBe(
      stateHash({ ...spawned, agents: { a1: { ...spawned.agents.a1!, x: 1, y: 1 } } }),
    )
  })
})

describe('desirePathsSystem: wear', () => {
  it('holds at 119 crossings and wears through on the 120th', () => {
    expect(CFG.desirePaths.wearThreshold).toBe(120)
    const shy = midnight(cross(withWalker(meadow()), 119), 1)
    expect(tileEvents(shy)).toEqual([])
    expect(shy.state.terrain[1]![1]).toBe(0)

    const worn = midnight(cross(withWalker(meadow()), 120), 1)
    expect(tileEvents(worn)).toEqual([
      { type: 'tile_changed', payload: { x: 1, y: 1, from: 0, to: 8, reason: 'worn' } },
    ])
    expect(worn.state.terrain[1]![1]).toBe(8)
  })

  it('a worn trail walks better than grass and worse than a road', () => {
    const worn = midnight(cross(withWalker(meadow()), 120), 1).state
    expect(stepCostAt(worn, 1, 1, CFG)).toBe(0.8)
    const cost = terrainCostFor(CFG)
    expect(cost[7]).toBeLessThan(cost[8])
    expect(cost[8]).toBeLessThan(cost[0])
  })

  it('every counter falls a tenth a night, floored', () => {
    const after = midnight(cross(withWalker(meadow()), 120), 1).state
    expect(after.traffic).toEqual({ [trafficKey(1, 1)]: 108 })
    expect(midnight(after, 2).state.traffic).toEqual({ [trafficKey(1, 1)]: 97 })
    // And a counter the fall takes to zero leaves the map, rather than being carried at zero.
    expect(
      midnight({ ...after, traffic: { [trafficKey(1, 1)]: 1 } }, 2).state.traffic,
    ).toBeUndefined()
  })
})

describe('desirePathsSystem: overgrowth', () => {
  const QUIET_TILE = trafficKey(1, 1)
  function quietPath(traffic: number): WorldState {
    return { ...meadow(['...', '.p.', '...']), traffic: { [QUIET_TILE]: traffic } }
  }
  function run(
    s: WorldState,
    fromDay: number,
    toDay: number,
  ): { state: WorldState; events: WorldTickResult['events'] } {
    const events: WorldTickResult['events'] = []
    for (let day = fromDay; day <= toDay; day++) {
      const r = midnight(s, day)
      s = r.state
      events.push(...tileEvents(r))
    }
    return { state: s, events }
  }

  it('stamps the night a trail went quiet, waits out the twenty, then gives the grass back', () => {
    expect(CFG.desirePaths.overgrowDays).toBe(20)
    const first = midnight(quietPath(10), 1)
    expect(first.state.quietSince).toEqual({ [QUIET_TILE]: 1 })
    const patient = run(first.state, 2, 20)
    expect(patient.events).toEqual([])
    expect(patient.state.terrain[1]![1]).toBe(8)
    const last = midnight(patient.state, 21)
    expect(tileEvents(last)).toEqual([
      { type: 'tile_changed', payload: { x: 1, y: 1, from: 8, to: 0, reason: 'overgrown' } },
    ])
    expect(last.state.terrain[1]![1]).toBe(0)
    expect(last.state.quietSince).toBeUndefined()
  })

  it('a trail that fills up again loses its stamp and starts the count over', () => {
    const gone = midnight(quietPath(10), 1)
    expect(gone.state.quietSince).toEqual({ [QUIET_TILE]: 1 })
    const busy = midnight({ ...gone.state, traffic: { [QUIET_TILE]: 100 } }, 2)
    expect(busy.state.quietSince).toBeUndefined()
    const requiet = midnight({ ...busy.state, traffic: { [QUIET_TILE]: 10 } }, 3)
    expect(requiet.state.quietSince).toEqual({ [QUIET_TILE]: 3 })
  })

  it('a trail well used is never taken away', () => {
    const busy = run({ ...meadow(['...', '.p.', '...']), traffic: { [QUIET_TILE]: 10000 } }, 1, 21)
    expect(busy.events).toEqual([])
    expect(busy.state.terrain[1]![1]).toBe(8)
  })
})

describe('world_grown moves the counters with the ground', () => {
  it('translates both sparse maps when the origin shifts', () => {
    const s = {
      ...meadow(['...', '.p.', '...']),
      traffic: { [trafficKey(1, 1)]: 10 },
      quietSince: { [trafficKey(1, 1)]: 4 },
    }
    const grown = fold(
      s,
      ev('world_grown', {
        edge: 'w',
        depth: 2,
        tiles: Array.from({ length: 3 }, () => [0, 0]),
      }),
      CFG,
    )
    expect(grown.traffic).toEqual({ [trafficKey(3, 1)]: 10 })
    expect(grown.quietSince).toEqual({ [trafficKey(3, 1)]: 4 })
    const south = fold(
      s,
      ev('world_grown', {
        edge: 's',
        depth: 1,
        tiles: [[0, 0, 0]],
      }),
      CFG,
    )
    expect(south.traffic).toEqual({ [trafficKey(1, 1)]: 10 })
  })
})
