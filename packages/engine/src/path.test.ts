import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, SimConfigSchema, type SimEvent } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { canStep, findPath, isPassable, terrainCostFor, TERRAIN_COST } from './path.js'

const CHAR_TILE: Record<string, TileId> = { '.': 0, d: 1, '~': 2, f: 3, r: 4, s: 5, F: 6, R: 7 }
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
