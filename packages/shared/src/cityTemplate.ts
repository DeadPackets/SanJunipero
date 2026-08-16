import { z } from 'zod'

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
