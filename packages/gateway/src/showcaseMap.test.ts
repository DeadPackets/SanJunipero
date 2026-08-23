import { describe, it, expect } from 'vitest'
import { CITY_H, CITY_W, RIVER_LOCAL_DX, T_PATH, makeCityTemplate, townSpan } from '@sj/shared'
import { TERRAIN_COST, makeFixtureMap } from '@sj/engine'
import { DEV_MAP_DEFAULT, devTerrain } from './devWorld.js'
import {
  FOREST_BAND_X0, GRASS_TILE, PLAZA_TILE, ROAD_TILE, ROCK_HILL, SHOWCASE_ANCHOR, SHOWCASE_H,
  SHOWCASE_MARGIN, SHOWCASE_W, STANDING_STONE_TILE, ShowcaseMapSchema, WATER_TILE,
  forestBandX0, makeShowcaseMap, plazaTile, roadReach, rockHill, showcaseDoorTile,
  showcaseSpan, showcaseStructureTiles, showcaseTerrain, standingStoneTile, toTileId,
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
  it('keeps the G6 scripted fixture as the LIBRARY default and only swaps on an explicit opt-in', () => {
    expect(devTerrain()).toEqual(makeFixtureMap())
    expect(devTerrain(DEV_MAP_DEFAULT)).toEqual(makeFixtureMap())
    expect(devTerrain('showcase')).toEqual(showcaseTerrain())
    expect(devTerrain('showcase')).not.toEqual(makeFixtureMap())
  })
})

// ★★ THERE IS NO WAY TO LOOK AT A GROWN TOWN, AND THE LINE THAT SAYS SO READS LIKE A DERIVATION.
//
// `SHOWCASE_W = CITY_W + 2 * SHOWCASE_MARGIN` looks derived and is a constant: `CITY_W` is
// `townSpan(TOWN_RINGS_GENESIS)`. The world-growth lane removed the world's ceiling and proved
// rings 5 and 6; the town-generator proved ring 3 renders at 1904 × 816; merge train 2 could
// reach neither in a browser and refused to fake one by editing this line. Every dimension is a
// function of the ring count now, and the property below is the one that matters: it never asks
// for a number, it asks that the map be the size the GRAMMAR says, at any ring count.
describe('★ the showcase map is sized by the ring count, not by a constant', () => {
  const RINGS = [1, 2, 3, 4, 5, 6]

  it('is exactly the grammar\'s span plus two margins, at every ring count', () => {
    for (const r of RINGS) {
      const m = makeShowcaseMap(SHOWCASE_ANCHOR, r)
      const want = townSpan(r) + 2 * SHOWCASE_MARGIN
      expect(showcaseSpan(r), `rings ${r}`).toBe(want)
      expect(m.terrain, `rings ${r} rows`).toHaveLength(want)
      for (const row of m.terrain) expect(row, `rings ${r} cols`).toHaveLength(want)
    }
  })

  it('★ grows strictly with the ring count — nothing here is pinned', () => {
    const spans = RINGS.map((r) => showcaseSpan(r))
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!, `ring ${RINGS[i]}`).toBeGreaterThan(spans[i - 1]!)
    }
    // and the numbers a lane needs to reach the chunked baker's own case
    expect(showcaseSpan(1)).toBe(76)
    expect(showcaseSpan(3)).toBe(152)
  })

  it('★ holds the whole platted town inside the map at every ring count', () => {
    for (const r of RINGS) {
      const m = makeShowcaseMap(SHOWCASE_ANCHOR, r)
      const span = showcaseSpan(r)
      for (const s of m.structures) {
        for (const t of showcaseStructureTiles(s)) {
          expect(t.x, `rings ${r}: ${s.kind} runs off the east edge`).toBeLessThan(span)
          expect(t.y, `rings ${r}: ${s.kind} runs off the south edge`).toBeLessThan(span)
          expect(Math.min(t.x, t.y), `rings ${r}: ${s.kind} runs off the origin`).toBeGreaterThanOrEqual(0)
        }
      }
      // and every road tile the grammar drew is on the map it was drawn for
      const roads = makeCityTemplate(SHOWCASE_ANCHOR, r).tiles
        .filter((t) => toTileId(t.to) === ROAD_TILE)
      expect(roads.length, `rings ${r} has no roads`).toBeGreaterThan(0)
      for (const t of roads) {
        expect(SHOWCASE_ANCHOR.x + t.dx, `rings ${r} road off the map`).toBeLessThan(span)
        expect(SHOWCASE_ANCHOR.y + t.dy, `rings ${r} road off the map`).toBeLessThan(span)
      }
    }
  })

  it('leaves ring 1 byte-identical, so every landed gate folds the world it always did', () => {
    expect(makeShowcaseMap(SHOWCASE_ANCHOR, 1)).toEqual(makeShowcaseMap())
    expect(showcaseSpan(1)).toBe(SHOWCASE_W)
    expect(showcaseSpan(1)).toBe(SHOWCASE_H)
    expect(forestBandX0(1)).toBe(FOREST_BAND_X0)
    expect(rockHill(1)).toEqual(ROCK_HILL)
    expect(standingStoneTile(1)).toEqual(STANDING_STONE_TILE)
    expect(plazaTile(1)).toEqual(PLAZA_TILE)
  })

  it('★ puts the plaza where a GROWN town keeps it, not where a one-ring town kept it', () => {
    // the whole reason the map has to grow: the town's own origin walks a pitch north-west per
    // ring, so a plaza pinned at ring 1's offset would be in a street by ring 2
    const centres = [1, 2, 3].map((r) => plazaTile(r))
    expect(new Set(centres.map((c) => `${c.x},${c.y}`)).size, 'the plaza did not move').toBe(3)
    for (const r of [1, 2, 3]) {
      const m = makeShowcaseMap(SHOWCASE_ANCHOR, r)
      const p = plazaTile(r)
      expect(m.terrain[p.y]![p.x], `rings ${r}: the plaza centre is not paved`).toBe(ROAD_TILE)
      // and every road tile is still reachable from it, walking road to road
      expect(roadReach(m, p).size, `rings ${r}: the plaza reaches no road`).toBeGreaterThan(0)
    }
  })
})
