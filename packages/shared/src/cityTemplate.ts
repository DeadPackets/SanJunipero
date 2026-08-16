import { z } from 'zod'
import { roadAutotile, type RoadAutotileKey } from './autotile.js'

// The genesis city as pure data. Its consumer is genesis (engine/gateway), so it lives in
// shared: homing it in forge would make the engine depend on sharp and better-sqlite3 to read
// a fixture (plan deviation D-2, controller-accepted).

export const CITY_ANCHOR_DEFAULT = { x: 48, y: 56 } as const
export const CITY_W = 34, CITY_H = 30
export const WORLD_SIZE_GENESIS = 128           // C11 §9; asserted here, never imported from engine

// C9 T1b + C11 §9 TileIds.
export const T_GRASS = 0, T_EARTH = 1, T_WATER = 2, T_ROAD = 7, T_PATH = 8

export type District = 'homes' | 'market' | 'farm' | 'riverfront'
export type Rect = { dx0: number; dy0: number; dx1: number; dy1: number }

// "District" is planner and viewer vocabulary ONLY. No zoning exists in the world; nothing
// reads these rectangles at runtime. They exist so the template author and the reviewer can
// talk about the city.
export const DISTRICTS: Record<District, Rect> = {
  riverfront: { dx0: 0, dy0: 0, dx1: 5, dy1: 29 },     // west bank: fishing frontage, clay, reeds
  market: { dx0: 13, dy0: 11, dx1: 21, dy1: 17 },      // the widened plaza
  homes: { dx0: 14, dy0: 1, dx1: 31, dy1: 9 },         // huts around a shared yard, NE of the square
  farm: { dx0: 7, dy0: 20, dx1: 27, dy1: 29 },         // tilled-ready meadow, south, in river reach
}
export const DISTRICT_NAMES = Object.keys(DISTRICTS) as District[]

export const CityTileSchema = z.object({
  dx: z.number().int(), dy: z.number().int(), to: z.number().int(),
}).strict()

export const CityFurnishingSchema = z.object({
  kind: z.string(),
  slot: z.object({ x: z.number().int(), y: z.number().int() }).strict(),
}).strict()

export const CityStructureSchema = z.object({
  kind: z.string(),
  dx: z.number().int(), dy: z.number().int(),
  w: z.number().int().min(1).max(4), h: z.number().int().min(1).max(4),
  // USER RULING 1: the five huts are owned, one founder each; every public building is null.
  // The field is REQUIRED; only its value may be null.
  owner: z.string().min(1).nullable(),
  furnishings: z.array(CityFurnishingSchema),
}).strict()

export const CityTemplateSchema = z.object({
  anchor: z.object({ x: z.number().int(), y: z.number().int() }).strict(),
  tiles: z.array(CityTileSchema),
  structures: z.array(CityStructureSchema),
}).strict()

export type CityTile = z.infer<typeof CityTileSchema>
export type CityFurnishing = z.infer<typeof CityFurnishingSchema>
export type CityStructure = z.infer<typeof CityStructureSchema>
export type CityTemplate = z.infer<typeof CityTemplateSchema>

export function inExtent(dx: number, dy: number): boolean {
  return dx >= 0 && dy >= 0 && dx < CITY_W && dy < CITY_H
}

export function inRect(r: Rect, dx: number, dy: number): boolean {
  return dx >= r.dx0 && dx <= r.dx1 && dy >= r.dy0 && dy <= r.dy1
}

export const key = (dx: number, dy: number): string => `${dx},${dy}`

// ---------------------------------------------------------------- terrain and roads

export const RIVER_DX1 = 2          // the river runs down the west edge, dx 0..2
export const BANK_DX = 3            // the wet earth bank between water and path
export const PATH_DX = 4            // the riverfront path, a contiguous north-south run
export const PLAZA: Rect = { dx0: 15, dy0: 12, dx1: 19, dy1: 16 }
export const PLAZA_CENTRE = { dx: 17, dy: 14 } as const

// Empty buildable ground beside a road. A plot carries no schema field and reserves nothing:
// the template clears it, and the road-adjacency benefit (C11 §3) is why life will fill it.
const GROWTH_PLOT_TILES: readonly (readonly [number, number])[] = [
  [5, 13], [5, 15],                       // riverfront, off the bank road
  [18, 17], [19, 17],                     // market, off the plaza's south edge
  [29, 5], [30, 5], [29, 7], [30, 7],     // homes, at the east end of the shared yard
  [10, 21], [11, 21], [12, 21], [13, 21], // farm, along the north headland
]

function rectTiles(r: Rect, to: number): CityTile[] {
  const out: CityTile[] = []
  for (let dy = r.dy0; dy <= r.dy1; dy++)
    for (let dx = r.dx0; dx <= r.dx1; dx++) out.push({ dx, dy, to })
  return out
}

export function cityTerrainTiles(): CityTile[] {
  return [
    ...rectTiles({ dx0: 0, dy0: 0, dx1: RIVER_DX1, dy1: CITY_H - 1 }, T_WATER),
    ...rectTiles({ dx0: BANK_DX, dy0: 0, dx1: BANK_DX, dy1: CITY_H - 1 }, T_EARTH),
    ...GROWTH_PLOT_TILES.map(([dx, dy]) => ({ dx, dy, to: T_GRASS })),
  ]
}

// The plaza, the four approaches that join the districts to it, the C11 §9 starter spine
// running east, and the riverfront path down the bank. NO BRIDGE: the far bank is an earned
// milestone (C11 §2), so nothing here crosses the water.
export function cityRoadTiles(): CityTile[] {
  const road: CityTile[] = [
    ...rectTiles(PLAZA, T_ROAD),
    ...rectTiles({ dx0: 5, dy0: 14, dx1: PLAZA.dx0 - 1, dy1: 14 }, T_ROAD),          // west approach
    ...rectTiles({ dx0: PLAZA.dx1 + 1, dy0: 14, dx1: CITY_W - 1, dy1: 14 }, T_ROAD), // starter spine, east
    ...rectTiles({ dx0: 17, dy0: 7, dx1: 17, dy1: PLAZA.dy0 - 1 }, T_ROAD),          // north approach
    ...rectTiles({ dx0: 17, dy0: PLAZA.dy1 + 1, dx1: 17, dy1: 19 }, T_ROAD),         // south approach
    ...rectTiles({ dx0: 14, dy0: 6, dx1: 31, dy1: 6 }, T_ROAD),                      // the homes yard
    ...rectTiles({ dx0: 7, dy0: 20, dx1: 27, dy1: 20 }, T_ROAD),                     // the farm headland
  ]
  const path = rectTiles({ dx0: PATH_DX, dy0: 0, dx1: PATH_DX, dy1: CITY_H - 1 }, T_PATH)
  return [...road, ...path]
}

export const isRoadTile = (t: CityTile): boolean => t.to === T_ROAD || t.to === T_PATH

// Neighbours are computed over the road set only (T_ROAD ∪ T_PATH), then the shared autotiler
// picks the tile. Keyed 'dx,dy'.
export function cityRoadKeys(tiles: readonly CityTile[]): Map<string, RoadAutotileKey> {
  const set = new Set(tiles.filter(isRoadTile).map(t => key(t.dx, t.dy)))
  const out = new Map<string, RoadAutotileKey>()
  for (const k of set) {
    const [dx, dy] = k.split(',').map(Number) as [number, number]
    out.set(k, roadAutotile({
      n: set.has(key(dx, dy - 1)), e: set.has(key(dx + 1, dy)),
      s: set.has(key(dx, dy + 1)), w: set.has(key(dx - 1, dy)),
    }))
  }
  return out
}
