import { z } from 'zod'
import {
  CITY_H, CITY_W, PLAZA, PLAZA_CENTRE, T_PATH, T_ROAD, doorTile, makeCityTemplate, structureTiles,
  type CityStructure,
} from '@sj/shared'
import type { TileId } from '@sj/engine/state'

// The designed showcase town. C13's `makeCityTemplate()` is the single authored source of the
// plaza, the road lattice, the river bank and the eleven buildings (AMENDMENT, 2026-08-16
// evening): this module rasterises that template onto a 48×48 dev world rather than
// hand-authoring a rival layout. It is a dev/gate fixture — genesis proper takes the template.

export const SHOWCASE_W = 48, SHOWCASE_H = 48
export const ROAD_TILE = 7    // C9 Task 1b TileId
export const GRASS_TILE = 0, WATER_TILE = 2, FOREST_TILE = 3, ROCK_TILE = 4

// The template lands flush to the west edge so its river IS the map's west river; the free
// rows north and south of it stay meadow.
export const SHOWCASE_ANCHOR = { x: 0, y: 9 } as const
export const FOREST_BAND_X0 = 44                                  // spec §10 forest edge, east
export const ROCK_HILL = { x0: 42, y0: 0, x1: 47, y1: 5 } as const // spec §10 rocky hill, north-east

// Reserved, not placed: the standing stone is C8 content. C10 only keeps the meadow tile at
// the plaza's north-east shoulder clear for it.
export const STANDING_STONE_TILE = {
  x: SHOWCASE_ANCHOR.x + PLAZA.dx1,
  y: SHOWCASE_ANCHOR.y + PLAZA.dy0 - 1,
} as const

export const PLAZA_TILE = {
  x: SHOWCASE_ANCHOR.x + PLAZA_CENTRE.dx,
  y: SHOWCASE_ANCHOR.y + PLAZA_CENTRE.dy,
} as const

// The city template's kinds, not a smaller invented set — dropping the well, the fire pit or
// the wagon would make the showcase a different town from the one genesis builds.
export const ShowcaseStructureSchema = z.object({
  kind: z.enum(['hut', 'storehouse', 'shed', 'well', 'fire_pit', 'wagon']),
  x: z.number().int().min(0), y: z.number().int().min(0),
  w: z.number().int().min(1).max(4), h: z.number().int().min(1).max(4),
}).strict()
export type ShowcaseStructure = z.infer<typeof ShowcaseStructureSchema>

export const ShowcaseMapSchema = z.object({
  terrain: z.array(z.array(z.number().int().min(0).max(7))),
  structures: z.array(ShowcaseStructureSchema),
}).strict()
export type ShowcaseMap = z.infer<typeof ShowcaseMapSchema>

// C11 §9's path tile (8) is not an engine TileId yet (TileId is 0..7), and a dev world folds
// this grid for real. The riverfront path rasterises as road until the engine grows tile 8.
export function toTileId(to: number): number {
  return to === T_PATH ? ROAD_TILE : to
}

function baseTerrain(): number[][] {
  const rows: number[][] = []
  for (let y = 0; y < SHOWCASE_H; y++) {
    const row: number[] = []
    for (let x = 0; x < SHOWCASE_W; x++) {
      const rock = x >= ROCK_HILL.x0 && x <= ROCK_HILL.x1 && y >= ROCK_HILL.y0 && y <= ROCK_HILL.y1
      row.push(rock ? ROCK_TILE : x >= FOREST_BAND_X0 ? FOREST_TILE : GRASS_TILE)
    }
    rows.push(row)
  }
  return rows
}

export function makeShowcaseMap(anchor: { x: number; y: number } = SHOWCASE_ANCHOR): ShowcaseMap {
  const template = makeCityTemplate(anchor)
  const terrain = baseTerrain()
  for (const t of template.tiles) {
    const x = anchor.x + t.dx, y = anchor.y + t.dy
    if (x < 0 || y < 0 || x >= SHOWCASE_W || y >= SHOWCASE_H) continue
    terrain[y]![x] = toTileId(t.to)
  }
  const structures = template.structures.map((s: CityStructure) => ({
    kind: s.kind, x: anchor.x + s.dx, y: anchor.y + s.dy, w: s.w, h: s.h,
  }))
  return ShowcaseMapSchema.parse({ terrain, structures })
}

export function showcaseTerrain(anchor: { x: number; y: number } = SHOWCASE_ANCHOR): TileId[][] {
  return makeShowcaseMap(anchor).terrain as TileId[][]
}

// ------------------------------------------------------------------ invariants (tests + gate)

export const showcaseDoorTile = (s: ShowcaseStructure, anchor = SHOWCASE_ANCHOR): { x: number; y: number } => {
  const d = doorTile({ ...s, dx: s.x - anchor.x, dy: s.y - anchor.y, owner: null, furnishings: [] })
  return { x: anchor.x + d.dx, y: anchor.y + d.dy }
}

export const showcaseStructureTiles = (s: ShowcaseStructure): { x: number; y: number }[] =>
  structureTiles({ ...s, dx: s.x, dy: s.y, owner: null, furnishings: [] }).map((t) => ({ x: t.dx, y: t.dy }))

/** Every road tile reachable from the plaza centre, walking road to road. */
export function roadReach(map: ShowcaseMap, from: { x: number; y: number } = PLAZA_TILE): Set<string> {
  const seen = new Set<string>()
  const isRoad = (x: number, y: number): boolean => map.terrain[y]?.[x] === ROAD_TILE
  if (!isRoad(from.x, from.y)) return seen
  const queue = [from]
  seen.add(`${from.x},${from.y}`)
  while (queue.length > 0) {
    const { x, y } = queue.shift()!
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`
      if (seen.has(k) || !isRoad(nx, ny)) continue
      seen.add(k)
      queue.push({ x: nx, y: ny })
    }
  }
  return seen
}

export { CITY_H, CITY_W, T_ROAD }
