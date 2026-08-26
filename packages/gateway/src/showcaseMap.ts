import { z } from 'zod'
import {
  CITY_DWELLING_KINDS,
  CITY_H,
  CITY_W,
  PLAZA_CENTRE,
  RIVER_HALF,
  TOWN_RINGS_GENESIS,
  T_PATH,
  T_ROAD,
  doorFrontTile,
  makeCityTemplate,
  plazaCentreOf,
  riverLocalDx,
  structureTiles,
  townSpan,
  type CityStructure,
} from '@sj/shared'
import type { TileId } from '@sj/engine/state'

// The designed showcase town: this module rasterises `makeCityTemplate()` onto a dev world
// rather than hand-authoring a rival layout. A fixture — genesis proper takes the template.

/** The wild the town is set in. Sized by the town, not the other way round: a fixture that
 *  pinned its own span would clip the next ring off. */
export const SHOWCASE_MARGIN = 8

/** Every showcase dimension is a function of the ring count rather than a constant, and the
 *  ring-1 answers are unchanged to the tile. */
export const showcaseSpan = (rings: number): number => townSpan(rings) + 2 * SHOWCASE_MARGIN
export const SHOWCASE_W = showcaseSpan(TOWN_RINGS_GENESIS)
export const SHOWCASE_H = showcaseSpan(TOWN_RINGS_GENESIS)
export const ROAD_TILE = 7
export const GRASS_TILE = 0,
  WATER_TILE = 2,
  FOREST_TILE = 3,
  ROCK_TILE = 4,
  SAND_TILE = 5

export const SHOWCASE_ANCHOR = { x: SHOWCASE_MARGIN, y: SHOWCASE_MARGIN } as const

// spec §10 forest edge, east
export const forestBandX0 = (rings: number): number => SHOWCASE_ANCHOR.x + townSpan(rings) + 4
export const FOREST_BAND_X0 = forestBandX0(TOWN_RINGS_GENESIS)

// spec §10 rocky hill, NE
export const rockHill = (rings: number): { x0: number; y0: number; x1: number; y1: number } => ({
  x0: forestBandX0(rings),
  y0: 0,
  x1: showcaseSpan(rings) - 1,
  y1: SHOWCASE_MARGIN - 5,
})
export const ROCK_HILL = rockHill(TOWN_RINGS_GENESIS)

// Reserved, not placed: the fixture only keeps the standing stone's meadow tile clear, in the
// open ground between the last street and the forest.
export const standingStoneTile = (rings: number): { x: number; y: number } => ({
  x: SHOWCASE_ANCHOR.x + townSpan(rings) + 1,
  y: SHOWCASE_ANCHOR.y + 1,
})
export const STANDING_STONE_TILE = standingStoneTile(TOWN_RINGS_GENESIS)

/**
 * The ford is the only place a deck can span: the channel runs three tiles and
 * `structures.recipes.bridge` spans two. Fix the MAP, not the recipe — widening the recipe moves
 * the forge pin.
 * The spit is still terrain WATER on purpose, so `townGroundOf` never plats on it while
 * `townWalkOf` lets feet stand.
 */
export const FORD_ROWS = 4
export const showcaseFord = (
  anchor: { x: number; y: number } = SHOWCASE_ANCHOR,
  rings: number = TOWN_RINGS_GENESIS,
): { x: number; y0: number; y1: number } => {
  const y0 = anchor.y + plazaCentreOf(rings).dy - 1
  return { x: anchor.x + riverLocalDx(rings) + RIVER_HALF, y0, y1: y0 + FORD_ROWS - 1 }
}

/** The top-left plank of the only deck that can stand here. Derived from the ford, so the map
 *  and anything that walks to it cannot disagree. */
export const showcaseDeck = (
  anchor: { x: number; y: number } = SHOWCASE_ANCHOR,
  rings: number = TOWN_RINGS_GENESIS,
): { x: number; y: number; w: number; h: number } => {
  const f = showcaseFord(anchor, rings)
  return { x: f.x - 2 * RIVER_HALF, y: f.y0 + 1, w: 2 * RIVER_HALF, h: 1 }
}

/** The tile a bridgewright stands on to reach the deck: the spit itself. */
export const showcaseFordStand = (
  anchor: { x: number; y: number } = SHOWCASE_ANCHOR,
  rings: number = TOWN_RINGS_GENESIS,
): { x: number; y: number } => {
  const f = showcaseFord(anchor, rings)
  return { x: f.x, y: f.y0 + 1 }
}

export const plazaTile = (rings: number): { x: number; y: number } => ({
  x: SHOWCASE_ANCHOR.x + plazaCentreOf(rings).dx,
  y: SHOWCASE_ANCHOR.y + plazaCentreOf(rings).dy,
})
export const PLAZA_TILE = plazaTile(TOWN_RINGS_GENESIS)

// The city template's kinds, not a smaller invented set — dropping the well, the fire pit or
// the wagon would make the showcase a different town from the one genesis builds.
export const ShowcaseStructureSchema = z
  .object({
    kind: z.enum([...CITY_DWELLING_KINDS, 'storehouse', 'shed', 'well', 'fire_pit', 'wagon']),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1).max(4),
    h: z.number().int().min(1).max(4),
    // The facing rides along because a door is on the face the building presents, and half this
    // town's buildings present the +x one.
    facing: z.enum(['sw', 'se']),
  })
  .strict()
export type ShowcaseStructure = z.infer<typeof ShowcaseStructureSchema>

export const ShowcaseMapSchema = z
  .object({
    terrain: z.array(z.array(z.number().int().min(0).max(7))),
    structures: z.array(ShowcaseStructureSchema),
  })
  .strict()
export type ShowcaseMap = z.infer<typeof ShowcaseMapSchema>

// C11 §9's path tile (8) is not an engine TileId yet (TileId is 0..7), and a dev world folds
// this grid for real. The riverfront path rasterises as road until the engine grows tile 8.
export function toTileId(to: number): number {
  return to === T_PATH ? ROAD_TILE : to
}

function baseTerrain(rings: number): number[][] {
  const span = showcaseSpan(rings),
    hill = rockHill(rings),
    forestX0 = forestBandX0(rings)
  const rows: number[][] = []
  for (let y = 0; y < span; y++) {
    const row: number[] = []
    for (let x = 0; x < span; x++) {
      const rock = x >= hill.x0 && x <= hill.x1 && y >= hill.y0 && y <= hill.y1
      row.push(rock ? ROCK_TILE : x >= forestX0 ? FOREST_TILE : GRASS_TILE)
    }
    rows.push(row)
  }
  return rows
}

export function makeShowcaseMap(
  anchor: { x: number; y: number } = SHOWCASE_ANCHOR,
  rings: number = TOWN_RINGS_GENESIS,
): ShowcaseMap {
  const span = showcaseSpan(rings)
  const template = makeCityTemplate(anchor, rings)
  const terrain = baseTerrain(rings)
  for (const t of template.tiles) {
    const x = anchor.x + t.dx,
      y = anchor.y + t.dy
    if (x < 0 || y < 0 || x >= span || y >= span) continue
    terrain[y]![x] = toTileId(t.to)
  }
  // After the template, not before: `cityTerrainTiles` paints the whole extent, so a spit laid
  // first would be painted back to water.
  const ford = showcaseFord(anchor, rings)
  for (let y = ford.y0; y <= ford.y1; y++) {
    if (y < 0 || y >= span || ford.x < 0 || ford.x >= span) continue
    terrain[y]![ford.x] = SAND_TILE
  }
  const structures = template.structures.map((s: CityStructure) => ({
    kind: s.kind,
    x: anchor.x + s.dx,
    y: anchor.y + s.dy,
    w: s.w,
    h: s.h,
    facing: s.facing,
  }))
  return ShowcaseMapSchema.parse({ terrain, structures })
}

export function showcaseTerrain(
  anchor: { x: number; y: number } = SHOWCASE_ANCHOR,
  rings: number = TOWN_RINGS_GENESIS,
): TileId[][] {
  return makeShowcaseMap(anchor, rings).terrain as TileId[][]
}

// ------------------------------------------------------------------ invariants (tests + gate)

/** The tile the door OPENS ONTO, on the face the structure's facing names. The well and the
 *  fire pit have no door and answer with their own tile — they stand in the paving. */
export const showcaseDoorTile = (
  s: ShowcaseStructure,
  anchor = SHOWCASE_ANCHOR,
): { x: number; y: number } => {
  if (s.w === 1 && s.h === 1) return { x: s.x, y: s.y }
  const d = doorFrontTile({
    kind: s.kind,
    w: s.w,
    h: s.h,
    dx: s.x - anchor.x,
    dy: s.y - anchor.y,
    facing: s.facing,
    owner: null,
    furnishings: [],
  })
  return { x: anchor.x + d.dx, y: anchor.y + d.dy }
}

export const showcaseStructureTiles = (s: ShowcaseStructure): { x: number; y: number }[] =>
  structureTiles({ w: s.w, h: s.h, dx: s.x, dy: s.y }).map((t) => ({ x: t.dx, y: t.dy }))

/** Every road tile reachable from the plaza centre, walking road to road. */
export function roadReach(
  map: ShowcaseMap,
  from: { x: number; y: number } = plazaTile(TOWN_RINGS_GENESIS),
): Set<string> {
  const seen = new Set<string>()
  const isRoad = (x: number, y: number): boolean => map.terrain[y]?.[x] === ROAD_TILE
  if (!isRoad(from.x, from.y)) return seen
  const queue = [from]
  seen.add(`${from.x},${from.y}`)
  while (queue.length > 0) {
    const { x, y } = queue.shift()!
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const nx = x + dx,
        ny = y + dy,
        k = `${nx},${ny}`
      if (seen.has(k) || !isRoad(nx, ny)) continue
      seen.add(k)
      queue.push({ x: nx, y: ny })
    }
  }
  return seen
}

export { CITY_H, CITY_W, T_ROAD }
