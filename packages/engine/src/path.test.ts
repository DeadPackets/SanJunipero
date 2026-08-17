import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, SimConfigSchema, type SimConfig, type SimEvent } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { canStep, findPath, isPassable, stepCostAt, terrainCostFor, TERRAIN_COST } from './path.js'

const CHAR_TILE: Record<string, TileId> = { '.': 0, d: 1, '~': 2, f: 3, r: 4, s: 5, F: 6, R: 7, p: 8, S: 9, c: 10 }
const world = (rows: string[]): WorldState =>
  genesisState(DEFAULT_CONFIG, rows.map((row) => [...row].map((c) => CHAR_TILE[c]!)))
const ev = (seq: number, type: string, payload: unknown): SimEvent => ({ seq, tick: 0, type, payload })

// Vertical water wall at x=3 with a gap at y=5: (1,1)→(5,1) detours in exactly 12 steps.
const WALL_MAP = [
  '...~...',
  '...~...',
  '...~...',
  '...~...',
  '...~...',
  '.......',
]

describe('terrain costs', () => {
  it('matches the binding cost table', () => {
    expect(TERRAIN_COST[0]).toBe(1)    // grass
    expect(TERRAIN_COST[1]).toBe(1)    // dirt
    expect(TERRAIN_COST[5]).toBe(1.2)  // sand
    expect(TERRAIN_COST[6]).toBe(1)    // farmland
    expect(TERRAIN_COST[3]).toBe(2)    // forest
    expect(TERRAIN_COST[4]).toBe(3)    // rock
    expect(TERRAIN_COST[2]).toBe(Infinity) // water impassable
  })
})

describe('the C11 tiles: path, sapling, channel', () => {
  it('a worn path is cheaper than grass and dearer than road', () => {
    const cost = terrainCostFor(DEFAULT_CONFIG)
    expect(cost[8]).toBe(0.8)
    expect(cost[7]).toBeLessThan(cost[8]!)
    expect(cost[8]).toBeLessThan(cost[0]!)
    expect(terrainCostFor(SimConfigSchema.parse({ desirePaths: { pathCost: 0.95 } }))[8]).toBe(0.95)
  })
  it('a sapling walks like grass and a channel is impassable', () => {
    expect(terrainCostFor(DEFAULT_CONFIG)[9]).toBe(1)
    expect(terrainCostFor(DEFAULT_CONFIG)[10]).toBe(Infinity)
    const s = world(['.c.', 'S..'])
    expect(isPassable(s, 1, 0)).toBe(false)
    expect(isPassable(s, 0, 1)).toBe(true)
  })
})

// A road on the far row must beat a grass row that the y-tie-break would otherwise win.
const ROAD_DETOUR = ['.....', '.RRRR']
const GRASS_DETOUR = ['.....', '.....']

describe('road tile (C9 T1b)', () => {
  it('tile 7 is a road: passable, cheaper than grass, priced from config', () => {
    expect(terrainCostFor(DEFAULT_CONFIG)[7]).toBe(0.6)
    expect(TERRAIN_COST).toEqual(terrainCostFor(DEFAULT_CONFIG))
    expect(isPassable(world(ROAD_DETOUR), 1, 1)).toBe(true)
    const dear = SimConfigSchema.parse({ pathing: { roadCost: 1.5 } })
    expect(terrainCostFor(dear)[7]).toBe(1.5)
  })

  it('findPath prefers the road even against the tie-break', () => {
    expect(findPath(world(GRASS_DETOUR), { x: 0, y: 0 }, { x: 4, y: 1 }))
      .toEqual([[1, 0], [2, 0], [3, 0], [4, 0], [4, 1]])
    expect(findPath(world(ROAD_DETOUR), { x: 0, y: 0 }, { x: 4, y: 1 }))
      .toEqual([[1, 0], [1, 1], [2, 1], [3, 1], [4, 1]])
  })

  it('a road dearer than grass loses the preference', () => {
    const dear = SimConfigSchema.parse({ pathing: { roadCost: 1.5 } })
    const s = genesisState(dear, ROAD_DETOUR.map((row) => [...row].map((c) => CHAR_TILE[c]!)))
    expect(findPath(s, { x: 0, y: 0 }, { x: 4, y: 1 }, dear))
      .toEqual([[1, 0], [2, 0], [3, 0], [4, 0], [4, 1]])
  })
})

describe('isPassable', () => {
  it('rejects out-of-bounds, water, and structure footprints', () => {
    let s = world(['..~', '...'])
    expect(isPassable(s, -1, 0)).toBe(false)
    expect(isPassable(s, 0, -1)).toBe(false)
    expect(isPassable(s, 3, 0)).toBe(false)
    expect(isPassable(s, 0, 2)).toBe(false)
    expect(isPassable(s, 2, 0)).toBe(false) // water
    expect(isPassable(s, 0, 0)).toBe(true)
    s = fold(s, ev(1, 'structure_planned', { id: 'structure_1', kind: 'hut', x: 0, y: 0, w: 2, h: 1, maxHp: 50, flammable: true, builderId: 'a1' }))
    expect(isPassable(s, 0, 0)).toBe(false)
    expect(isPassable(s, 1, 0)).toBe(false)
    expect(isPassable(s, 0, 1)).toBe(true)
  })
})

describe('findPath (A*)', () => {
  it('routes around a wall in the known 12 steps', () => {
    const s = world(WALL_MAP)
    const path = findPath(s, { x: 1, y: 1 }, { x: 5, y: 1 })!
    expect(path).toEqual([
      [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [3, 5],
      [4, 5], [4, 4], [4, 3], [4, 2], [4, 1], [5, 1],
    ])
    expect(path).toHaveLength(12)
    let [px, py] = [1, 1]
    for (const [x, y] of path) {
      expect(Math.abs(x - px) + Math.abs(y - py)).toBe(1) // 4-directional, one tile at a time
      expect(s.terrain[y]![x]).not.toBe(2)                // water never entered
      ;[px, py] = [x, y]
    }
  })

  it('is deterministic: repeated runs give the identical path', () => {
    const s = world(WALL_MAP)
    const first = findPath(s, { x: 1, y: 1 }, { x: 5, y: 1 })
    for (let i = 0; i < 20; i++) expect(findPath(s, { x: 1, y: 1 }, { x: 5, y: 1 })).toEqual(first)
  })

  it('tie-break prefers lower y then lower x between equal paths', () => {
    const s = world(['....', '....', '....', '....'])
    // (0,0)→(1,1): via (1,0) [y=0] beats via (0,1) [y=1]
    expect(findPath(s, { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([[1, 0], [1, 1]])
  })

  it('pays terrain costs: detours around rock when grass is cheaper', () => {
    const s = world(['.....', '.rrr.', '.....'])
    // direct (0,1)→(4,1) through rock costs 3+3+3+1=10; over the top costs 6
    const path = findPath(s, { x: 0, y: 1 }, { x: 4, y: 1 })!
    expect(path).toHaveLength(6)
    for (const [x, y] of path) expect(s.terrain[y]![x]).not.toBe(4)
  })

  it('walks through forest when the detour is dearer', () => {
    const s = world(['~~~~~', '..f..', '~~~~~'])
    const path = findPath(s, { x: 0, y: 1 }, { x: 4, y: 1 })
    expect(path).toEqual([[1, 1], [2, 1], [3, 1], [4, 1]])
  })

  it('returns null for unreachable or impassable goals', () => {
    const s = world(['..~..', '..~..', '..~..'])
    expect(findPath(s, { x: 0, y: 0 }, { x: 4, y: 0 })).toBeNull()
    expect(findPath(s, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull() // goal is water
    expect(findPath(s, { x: 0, y: 0 }, { x: 9, y: 9 })).toBeNull() // out of bounds
  })

  it('treats structure footprints as impassable', () => {
    let s = world(['.....', '.....', '.....'])
    s = fold(s, ev(1, 'structure_planned', { id: 'structure_1', kind: 'hut', x: 2, y: 0, w: 1, h: 2, maxHp: 50, flammable: true, builderId: 'a1' }))
    const path = findPath(s, { x: 0, y: 0 }, { x: 4, y: 0 })!
    expect(path).toHaveLength(8)
    for (const [x, y] of path) expect(x === 2 && y <= 1).toBe(false)
  })

  it('corner rule: a diagonal step between two blocked corners is rejected', () => {
    let s = world(['....', '....', '....', '....'])
    s = fold(s, ev(1, 'structure_planned', { id: 'a', kind: 'hut', x: 1, y: 1, w: 1, h: 1, maxHp: 50, flammable: true, builderId: 'x' }))
    s = fold(s, ev(2, 'structure_planned', { id: 'b', kind: 'hut', x: 2, y: 2, w: 1, h: 1, maxHp: 50, flammable: true, builderId: 'x' }))
    // (1,2)→(2,1) squeezes between the two diagonally-adjacent huts: illegal
    expect(canStep(s, 1, 2, 1, -1)).toBe(false)
    // (2,1)→(3,2) has only one blocked corner: still legal
    expect(canStep(s, 2, 1, 1, 1)).toBe(true)
    // cardinal steps ignore the corner rule and just check the destination
    expect(canStep(s, 0, 0, 1, 0)).toBe(true)
    expect(canStep(s, 1, 0, 0, 1)).toBe(false) // (1,1) is a hut footprint
  })

  it('returns [] when already at the goal', () => {
    const s = world(['..', '..'])
    expect(findPath(s, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([])
  })
})

// A river three tiles wide, banks at x=0 and x=4. Nothing crosses it but a bridge.
const RIVER = ['.~~~.', '.~~~.', '.~~~.']

// A bridge is a structure like any other: planned, progressed, completed.
function span(s: WorldState, id: string, x: number, y: number, w: number, h: number, complete = true): WorldState {
  let out = fold(s, ev(50, 'structure_planned', {
    id, kind: 'bridge', x, y, w, h, maxHp: 20, flammable: false, builderId: 'a1',
  }))
  if (complete) out = fold(out, ev(51, 'structure_completed', { id }))
  return out
}

describe('bridges: the one structure that grants passage', () => {
  it('a river is uncrossable until a finished bridge spans it', () => {
    const s = world(RIVER)
    expect(findPath(s, { x: 0, y: 1 }, { x: 4, y: 1 })).toBeNull()
    const half = span(s, 'structure_1', 1, 1, 3, 1, false)
    expect(findPath(half, { x: 0, y: 1 }, { x: 4, y: 1 })).toBeNull()
    const done = span(s, 'structure_1', 1, 1, 3, 1)
    expect(findPath(done, { x: 0, y: 1 }, { x: 4, y: 1 })).toEqual([[1, 1], [2, 1], [3, 1], [4, 1]])
  })

  it('a bridge deck walks like a road, and the water beneath it is still water', () => {
    const done = span(world(RIVER), 'structure_1', 1, 1, 3, 1)
    // terrainCostFor still calls the tile impassable: findPath can only cross by asking stepCostAt.
    expect(terrainCostFor(DEFAULT_CONFIG)[done.terrain[1]![2]!]).toBe(Infinity)
    expect(stepCostAt(done, 2, 1, DEFAULT_CONFIG)).toBe(DEFAULT_CONFIG.pathing.roadCost)
    expect(done.terrain[1]![2]).toBe(2)
    expect(isPassable(done, 2, 1)).toBe(true)
    // Every other tile is priced exactly as the plain table prices it.
    for (let y = 0; y < done.terrain.length; y++) {
      for (let x = 0; x < done.terrain[y]!.length; x++) {
        if (y === 1 && x >= 1 && x <= 3) continue
        expect(stepCostAt(done, x, y, DEFAULT_CONFIG)).toBe(terrainCostFor(DEFAULT_CONFIG)[done.terrain[y]![x]!])
      }
    }
  })

  it('any other structure over water still blocks', () => {
    let s = world(RIVER)
    s = fold(s, ev(50, 'structure_planned', {
      id: 'structure_1', kind: 'hut', x: 1, y: 1, w: 3, h: 1, maxHp: 50, flammable: true, builderId: 'a1',
    }))
    s = fold(s, ev(51, 'structure_completed', { id: 'structure_1' }))
    expect(isPassable(s, 2, 1)).toBe(false)
  })
})

describe('build: planning a bridge', () => {
  const BRIDGE3 = SimConfigSchema.parse({ structures: { recipes: {
    bridge: { inputs: { wood: 6 }, w: 3, h: 1, maxHp: 20, flammable: false, durationTicks: 480 },
  } } })
  const BRIDGE4 = SimConfigSchema.parse({ structures: { recipes: {
    bridge: { inputs: { wood: 6 }, w: 4, h: 1, maxHp: 20, flammable: false, durationTicks: 480 },
  } } })

  function builder(rows: string[], config: SimConfig): WorldState {
    let s = genesisState(config, rows.map((row) => [...row].map((c) => CHAR_TILE[c]!)))
    s = fold(s, ev(1, 'agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 1, ageDays: 7300 }), config)
    return fold(s, ev(2, 'item_spawned', {
      id: 'item_1', kind: 'wood', qty: 6, loc: { t: 'agent', id: 'a1' },
    }), config)
  }

  it('plans across the water when both ends touch land', () => {
    const s = builder(RIVER, BRIDGE3)
    const r = submitIntent(s, BRIDGE3, 'a1', 'build', { kind: 'bridge', x: 1, y: 1 })
    expect(r.ok).toBe(true)
  })

  it('refuses a span longer than three, an end in open water, and dry ground', () => {
    const wide = ['.~~~~.', '.~~~~.', '.~~~~.']
    const long = submitIntent(builder(wide, BRIDGE4), BRIDGE4, 'a1', 'build', { kind: 'bridge', x: 1, y: 1 })
    expect(long.ok).toBe(false)
    // A five-wide river with a three-tile deck leaves one end standing in the river.
    const short = submitIntent(builder(wide, BRIDGE3), BRIDGE3, 'a1', 'build', { kind: 'bridge', x: 1, y: 1 })
    expect(short.ok).toBe(false)
    const dry = submitIntent(builder(['......', '......', '......'], BRIDGE3), BRIDGE3, 'a1', 'build', { kind: 'bridge', x: 1, y: 1 })
    expect(dry.ok).toBe(false)
  })

  it('an existing bridge is a bank to build the next span from', () => {
    const wide = ['.~~~~~~.', '.~~~~~~.', '.~~~~~~.']
    let s = builder(wide, BRIDGE3)
    s = span(s, 'structure_1', 1, 1, 3, 1)
    // Standing on the deck they just finished, reaching for the next span.
    s = fold(s, ev(60, 'agent_moved', { id: 'a1', x: 3, y: 1 }), BRIDGE3)
    const r = submitIntent(s, BRIDGE3, 'a1', 'build', { kind: 'bridge', x: 4, y: 1 })
    expect(r.ok).toBe(true)
  })
})
