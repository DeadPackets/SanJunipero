import { describe, it, expect } from 'vitest'
import { CITY_H, CITY_W, RIVER_LOCAL_DX, T_PATH, makeCityTemplate } from '@sj/shared'
import { TERRAIN_COST, makeFixtureMap } from '@sj/engine'
import { DEV_MAP_DEFAULT, devTerrain } from './devWorld.js'
import {
  FOREST_BAND_X0, GRASS_TILE, PLAZA_TILE, ROAD_TILE, ROCK_HILL, SHOWCASE_ANCHOR, SHOWCASE_H,
  SHOWCASE_W, STANDING_STONE_TILE, ShowcaseMapSchema, WATER_TILE, makeShowcaseMap, roadReach,
  showcaseDoorTile, showcaseStructureTiles, showcaseTerrain, toTileId,
} from './showcaseMap.js'

const map = makeShowcaseMap()
const tileAt = (x: number, y: number): number => map.terrain[y]![x]!

describe('makeShowcaseMap', () => {
  // ★ THE MAP IS SIZED BY THE TOWN. It was a hard-coded 48 and the town outgrew it the moment
  // the layout became a grammar — a fixture that pins its own size clips the next ring off.
  it('is a grid the whole town fits in, and it parses under its own schema', () => {
    expect(() => ShowcaseMapSchema.parse(map)).not.toThrow()
    expect(map.terrain).toHaveLength(SHOWCASE_H)
    for (const row of map.terrain) expect(row).toHaveLength(SHOWCASE_W)
    expect(SHOWCASE_W).toBeGreaterThan(CITY_W)
    expect(SHOWCASE_H).toBeGreaterThan(CITY_H)
  })

  it('is deterministic — two calls deep-equal', () => {
    expect(makeShowcaseMap()).toEqual(makeShowcaseMap())
  })

  it('uses only tile ids the engine can cost (0..7)', () => {
    for (const row of map.terrain) for (const t of row) expect(TERRAIN_COST[t as 0]).toBeTypeOf('number')
  })

  it('rasterises C13 makeCityTemplate rather than a rival hand-authored layout', () => {
    const template = makeCityTemplate(SHOWCASE_ANCHOR)
    for (const t of template.tiles) {
      expect(tileAt(SHOWCASE_ANCHOR.x + t.dx, SHOWCASE_ANCHOR.y + t.dy)).toBe(toTileId(t.to))
    }
    expect(map.structures).toHaveLength(template.structures.length)
    expect(new Set(map.structures.map((s) => s.kind))).toContain('well')
  })

  it('renders the riverfront path as road — TileId 8 does not exist yet', () => {
    expect(toTileId(T_PATH)).toBe(ROAD_TILE)
    expect(map.terrain.flat()).not.toContain(T_PATH)
  })
})

describe('the founders landscape (spec §10)', () => {
  // The channel is where the TOWN says it is — the town paints the water it is built beside,
  // and the map takes it. A river column asserted at x = 0 was a fact about the old template's
  // geometry, not about a river.
  it('runs a contiguous river down the town west side', () => {
    const column = map.terrain.map((row) => row[SHOWCASE_ANCHOR.x + RIVER_LOCAL_DX]!)
    const first = column.indexOf(WATER_TILE)
    const last = column.lastIndexOf(WATER_TILE)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(last - first + 1).toBe(CITY_H)
    for (let y = first; y <= last; y++) expect(column[y]).toBe(WATER_TILE)
  })

  it('carries a forest band on the east edge and a rocky hill in the north-east', () => {
    expect(tileAt(SHOWCASE_W - 1, SHOWCASE_H - 1)).toBe(3)
    expect(tileAt(FOREST_BAND_X0, SHOWCASE_H - 1)).toBe(3)
    expect(tileAt(ROCK_HILL.x1, ROCK_HILL.y0)).toBe(4)
  })

  it('reserves an open meadow tile beyond the edge of town for the standing stone', () => {
    expect(tileAt(STANDING_STONE_TILE.x, STANDING_STONE_TILE.y)).toBe(GRASS_TILE)
    const built = new Set(map.structures.flatMap(showcaseStructureTiles).map((t) => `${t.x},${t.y}`))
    expect(built.has(`${STANDING_STONE_TILE.x},${STANDING_STONE_TILE.y}`)).toBe(false)
  })
})

describe('the road lattice', () => {
  it('starts at a plaza that is itself road', () => {
    expect(tileAt(PLAZA_TILE.x, PLAZA_TILE.y)).toBe(ROAD_TILE)
  })

  // The door tile IS the road it opens onto now, on the face the structure's facing names —
  // so this asks the strict question rather than "is a road somewhere next to the back wall".
  it('connects the plaza to the door of every structure', () => {
    const reached = roadReach(map)
    expect(reached.size).toBeGreaterThan(50)
    for (const s of map.structures) {
      const d = showcaseDoorTile(s)
      const at = s.w === 1 && s.h === 1
        ? ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).some(([dx, dy]) => reached.has(`${d.x + dx},${d.y + dy}`))
        : reached.has(`${d.x},${d.y}`)
      expect(at, `${s.kind} at ${s.x},${s.y} has no reachable road at its door`).toBe(true)
    }
  })

  it('puts every structure on buildable ground, never on water or road', () => {
    for (const s of map.structures) {
      for (const t of showcaseStructureTiles(s)) {
        expect([GRASS_TILE, 1 /* earth */], `${s.kind} at ${t.x},${t.y}`).toContain(tileAt(t.x, t.y))
      }
    }
  })
})

describe('showcaseTerrain', () => {
  it('hands the dev world a plain TileId grid', () => {
    const t = showcaseTerrain()
    expect(t).toHaveLength(SHOWCASE_H)
    expect(t[0]).toHaveLength(SHOWCASE_W)
  })
})

describe('devTerrain', () => {
  it('keeps the G6 scripted fixture as the default and only swaps on an explicit opt-in', () => {
    expect(devTerrain()).toEqual(makeFixtureMap())
    expect(devTerrain(DEV_MAP_DEFAULT)).toEqual(makeFixtureMap())
    expect(devTerrain('showcase')).toEqual(showcaseTerrain())
    expect(devTerrain('showcase')).not.toEqual(makeFixtureMap())
  })
})
