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

// ---------------------------------------------------------------- structures

// Assumption A-2: the five locked founders (design spec §10). Template data, not engine truth
// — genesis binds them, and different id strings are one data edit with no code change.
export const FOUNDER_IDS = ['amara', 'yusuf', 'nadia', 'omar', 'salma'] as const
export type FounderId = (typeof FOUNDER_IDS)[number]

// The room grid every enterable structure exposes to its furnishings. Template vocabulary:
// C10 T11 owns what a room actually looks like.
export const CITY_INTERIOR_SLOTS = { w: 3, h: 3 } as const

// Shared cannot import the forge catalog, so these stand in for it here and Task 28's
// g13.test.ts asserts them equal to the library (the plan's declared seam).
export const CITY_FURNISHING_KINDS =
  ['bed', 'hearth', 'table', 'chair', 'rug', 'shelf', 'crate', 'barrel', 'anvil', 'bench'] as const
export const CITY_BED_KIND = 'bed'
export const CITY_HEARTH_KIND = 'hearth'

const HUT_FURNISHINGS: CityFurnishing[] = [
  { kind: 'bed', slot: { x: 2, y: 1 } },
  { kind: 'hearth', slot: { x: 0, y: 2 } },
  { kind: 'table', slot: { x: 1, y: 2 } },
  { kind: 'chair', slot: { x: 1, y: 1 } },
  // The plan put the rug at (0,1). A rug is two slots tall, so it would have lain across the
  // hearth; (0,0) is the same wall with the collision gone.
  { kind: 'rug', slot: { x: 0, y: 0 } },
]
const STOREHOUSE_FURNISHINGS: CityFurnishing[] = [
  { kind: 'shelf', slot: { x: 0, y: 1 } },
  { kind: 'shelf', slot: { x: 1, y: 1 } },
  { kind: 'crate', slot: { x: 2, y: 2 } },
  { kind: 'crate', slot: { x: 2, y: 1 } },
  { kind: 'barrel', slot: { x: 0, y: 2 } },
]
const SHED_FURNISHINGS: CityFurnishing[] = [
  { kind: 'anvil', slot: { x: 1, y: 1 } },
  { kind: 'bench', slot: { x: 2, y: 1 } },
  { kind: 'shelf', slot: { x: 0, y: 1 } },
]

const HUT_ORIGINS: readonly (readonly [number, number])[] = [[14, 4], [17, 4], [20, 4], [23, 4], [26, 4]]

// Eleven structures, inside the ruled 8-12. The STANDING STONE is deliberately absent: it
// stands beyond the edge of town, unexplained (C11 §9).
export function cityStructures(): CityStructure[] {
  return [
    ...HUT_ORIGINS.map(([dx, dy], i) => ({
      kind: 'hut', dx, dy, w: 2, h: 2,
      owner: FOUNDER_IDS[i]! as string, furnishings: [...HUT_FURNISHINGS],
    })),
    { kind: 'storehouse', dx: 13, dy: 12, w: 2, h: 2, owner: null, furnishings: [...STOREHOUSE_FURNISHINGS] },
    { kind: 'shed', dx: 16, dy: 17, w: 1, h: 1, owner: null, furnishings: [...SHED_FURNISHINGS] },
    { kind: 'shed', dx: 16, dy: 21, w: 1, h: 1, owner: null, furnishings: [...SHED_FURNISHINGS] },
    { kind: 'well', dx: 20, dy: 13, w: 1, h: 1, owner: null, furnishings: [] },
    { kind: 'fire_pit', dx: 20, dy: 15, w: 1, h: 1, owner: null, furnishings: [] },
    // Open question 2, answered: the wagon is a lore prop and stays unenterable.
    { kind: 'wagon', dx: 5, dy: 16, w: 1, h: 2, owner: null, furnishings: [] },
  ]
}

// The tile a resident walks out of, on the south face, at the centre of the frontage.
export function doorTile(s: CityStructure): { dx: number; dy: number } {
  return { dx: s.dx + ((s.w - 1) >> 1), dy: s.dy + s.h - 1 }
}

export function structureTiles(s: CityStructure): { dx: number; dy: number }[] {
  const out: { dx: number; dy: number }[] = []
  for (let dy = s.dy; dy < s.dy + s.h; dy++)
    for (let dx = s.dx; dx < s.dx + s.w; dx++) out.push({ dx, dy })
  return out
}

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
