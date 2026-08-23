import { z } from 'zod'
import { roadAutotile, type RoadAutotileKey } from './autotile.js'
import { TOWN_FACINGS } from './townGrammar.js'

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
  // Two columns of dry ground, not one: the bank held nothing but a cart because a single
  // buildable column (dx 5) cannot take a 2-wide house, and a town with no house on its river
  // is a town whose river is scenery.
  riverfront: { dx0: 0, dy0: 0, dx1: 6, dy1: 29 },     // west bank: the landing, clay, reeds
  market: { dx0: 13, dy0: 11, dx1: 21, dy1: 17 },      // the widened plaza
  homes: { dx0: 14, dy0: 1, dx1: 31, dy1: 9 },         // the yard street and the lane behind it
  // Two rows further north than C13 drew it, so the farmhouse can stand on the dry side of
  // the headland it fronts: a building south of that road would have its door in the field.
  farm: { dx0: 7, dy0: 18, dx1: 27, dy1: 29 },         // tilled-ready meadow, south, in river reach
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
  // USER RULING 1: the five houses are owned, one founder each; every public building is null.
  // The field is REQUIRED; only its value may be null.
  owner: z.string().min(1).nullable(),
  // ★ FACING IS DATA. `facingFrom(dx, dy)` derives a facing from a delta and can answer `ne`
  // or `nw`, for which the forge has no art — right for a walking body, which turns four ways,
  // never right for a building, which the user ruled turns two. Because this is a two-value
  // enum and it is REQUIRED, NE and NW are not merely unused: they are unrepresentable.
  facing: z.enum(TOWN_FACINGS),
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

// The two monuments stand INSIDE the square, on its north-south axis, and the paving is laid
// around them: a centre reads as a centre only when the thing at its centre is in it. Their
// tiles are cut from the road set, so no structure ever stands on a road.
export const WELL_AT = { dx: 17, dy: 12 } as const        // the plaza's north axis
export const FIRE_PIT_AT = { dx: 17, dy: 16 } as const    // the plaza's south axis

// Empty buildable ground beside a road. A plot carries no schema field and reserves nothing:
// the template clears it, and the road-adjacency benefit (C11 §3) is why life will fill it.
const GROWTH_PLOT_TILES: readonly (readonly [number, number])[] = [
  [5, 10], [5, 13], [5, 15], [5, 16],     // the landing, above and below the river house
  [15, 17], [16, 17], [18, 17],           // market, off the plaza's south edge
  [16, 5], [17, 5], [18, 5],              // homes, the near gap in the yard street's rank
  [22, 5], [23, 5], [24, 5], [25, 5],     // homes, the wide gap where the street thins out
  [18, 8], [19, 8], [20, 8], [23, 8], [24, 8], // homes, the two gaps in the back lane's rank
  [10, 21], [11, 21], [12, 21], [13, 21], // farm, along the headland west of the farmhouse
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

// The square, the approaches that join the districts to it, the C11 §9 starter spine running
// east, and the riverfront path down the bank. NO BRIDGE: the far bank is an earned milestone
// (C11 §2), so nothing here crosses the water.
//
// Every run either reaches a map edge, meets the bank path, or stops at a door. The approaches
// enter the square at dx 15 and dx 19 rather than down its centre line, because the centre
// line is where the well and the fire pit stand.
export function cityRoadTiles(): CityTile[] {
  const monuments = new Set([key(WELL_AT.dx, WELL_AT.dy), key(FIRE_PIT_AT.dx, FIRE_PIT_AT.dy)])
  const road: CityTile[] = [
    ...rectTiles(PLAZA, T_ROAD).filter(t => !monuments.has(key(t.dx, t.dy))),
    ...rectTiles({ dx0: 5, dy0: 14, dx1: PLAZA.dx0 - 1, dy1: 14 }, T_ROAD),          // main street, west
    ...rectTiles({ dx0: PLAZA.dx1 + 1, dy0: 14, dx1: CITY_W - 1, dy1: 14 }, T_ROAD), // starter spine, east
    ...rectTiles({ dx0: 15, dy0: 7, dx1: 15, dy1: PLAZA.dy0 - 1 }, T_ROAD),          // north approach
    ...rectTiles({ dx0: 19, dy0: PLAZA.dy1 + 1, dx1: 19, dy1: 19 }, T_ROAD),         // south approach
    // The yard street starts where the north approach meets it and ends at the last door on
    // it; the back lane does the same behind. A run that carried on past its last house was
    // the dangling end this file already forbids, so the houses set the length of the street.
    ...rectTiles({ dx0: 14, dy0: 6, dx1: 26, dy1: 6 }, T_ROAD),                      // the homes yard street
    ...rectTiles({ dx0: 16, dy0: 9, dx1: 25, dy1: 9 }, T_ROAD),                      // the homes back lane
    ...rectTiles({ dx0: 5, dy0: 20, dx1: 25, dy1: 20 }, T_ROAD),                     // the farm headland
  ]
  const path = rectTiles({ dx0: PATH_DX, dy0: 0, dx1: PATH_DX, dy1: CITY_H - 1 }, T_PATH)
  return [...road, ...path]
}

export const isRoadTile = (t: CityTile): boolean => t.to === T_ROAD || t.to === T_PATH

// ---------------------------------------------------------------- structures

// ★ THE FOUR DWELLING KINDS — a shared contract with the art lane, for the CONTEMPORARY
// RURAL setting. These are FIXTURES this template places, never new buildable verbs:
// `structures.recipes` is the buildable set and it is C8's business, not this file's. `house`
// is the exception that proves it — the founders' homes are also the one buildable dwelling.
export const CITY_DWELLING_KINDS = ['cottage', 'farmhouse', 'cabin', 'house'] as const
export type DwellingKind = (typeof CITY_DWELLING_KINDS)[number]
export const isDwellingKind = (kind: string): kind is DwellingKind =>
  (CITY_DWELLING_KINDS as readonly string[]).includes(kind)

// Mass, not palette. In isometric a change of DEPTH is nearly invisible and a change of WIDTH
// along the street is not, so the kinds differ where the eye can see it: four, four, six and
// eight ground tiles. Two kinds share the smallest mass; what the street never does is stand
// two of the SAME kind side by side, which is the property the layout tests measure.
export const DWELLING_FOOTPRINTS: Readonly<Record<DwellingKind, { w: number; h: number }>> = {
  cabin: { w: 2, h: 2 }, cottage: { w: 3, h: 2 }, farmhouse: { w: 4, h: 2 },
  // 2×2 is the footprint every landed gate measured a founder's home at, and `houseSize` in
  // SimConfigSchema still says so; this row and that dial must not drift apart.
  house: { w: 2, h: 2 },
}

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

const HOUSE_FURNISHINGS: CityFurnishing[] = [
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
// The workshop shed's set is gone with the sheds. `CITY_FURNISHING_KINDS` stays the LIBRARY's
// vocabulary (G13 Task 28 asserts it against the catalog), not a list of what the current
// eleven buildings happen to hold.

// ★ A STREET OF DIFFERENT BUILDINGS, NOT ONE BUILDING FIVE TIMES.
//
// USER FEEDBACK: "it does not look like a town at all, the buildings are all the same." Read
// as a plan the old layout was already a street; what it was not was a place with more than
// one kind of building on it. Five identical 2×2 homes stood at dx 14, 18 and 22 — one mass,
// one silhouette, one spacing — and a 2×2 sprite is drawn to a 128 px square over 64 px of
// ground, so at four tiles apart they abutted into a single blob. Four things change here,
// and each is asserted in cityTemplate.test.ts:
//
//   MASS      four widths on the street (4, 4, 6 and 8 ground tiles), never two of a kind
//             standing next to each other.
//   SPACING   the gaps between neighbours are 2, 3 and 4 tiles. A street that thins out as
//             it leaves the centre is a town; equal gaps are a spreadsheet.
//   PLACE     two houses are NOT on the homes street — one at the landing on the river path,
//             the farmhouse out at the field — so the town has more than one address.
//   ARRIVAL   four roads reach the square, one from each side.
//
// A door is the south-centre tile of a footprint, so a rank's door row is its bottom row.
// The yard street's rank opens onto dy 6, the back lane's rank onto dy 9, and the two door
// sets are disjoint so no door looks straight down another.
export const DWELLINGS: readonly { kind: DwellingKind; dx: number; dy: number; owner: string | null }[] = [
  // The yard street, west to east.
  { kind: 'house', dx: 14, dy: 4, owner: 'amara' },
  { kind: 'cottage', dx: 19, dy: 4, owner: null },
  { kind: 'house', dx: 26, dy: 4, owner: 'yusuf' },
  // The back lane behind them.
  { kind: 'house', dx: 16, dy: 7, owner: 'nadia' },
  { kind: 'cabin', dx: 21, dy: 7, owner: null },
  { kind: 'house', dx: 25, dy: 7, owner: 'omar' },
  // The landing, on the river path — a house where the town meets its water. Its nearest
  // neighbour is inside its line of sight, so nobody wakes up alone.
  { kind: 'house', dx: 5, dy: 11, owner: 'salma' },
  // The farmhouse stands at its own field, north of the headland it fronts. It is the largest
  // roof in the parish and the only building out here, which is what a farm looks like.
  { kind: 'farmhouse', dx: 24, dy: 18, owner: null },
]

// Eleven structures, the count C13 pinned. The STANDING STONE is deliberately absent: it
// stands beyond the edge of town, unexplained (C11 §9).
//
// Eleven is a hard budget and every slot is spoken for: five founders' houses, the three
// other dwellings, the storehouse genesis stocks, and the two monuments in the square.
// What that budget bought the layout, it paid for by dropping the two 1×1 sheds and the river
// wagon — a matched pair of identical boxes and a parked cart, in exchange for a cottage, a
// cabin and a farmhouse. (Deviation from C13's open question 2, which kept the wagon;
// reversible the moment the count may be twelve.)
//
// ONLY A HOUSE IS A HOME. `structures.enterableKinds` and `sleepableKinds` name `house` and
// nothing else, so the five founders keep five houses, one each, and the cottage, cabin and
// farmhouse stand as fixtures the eye reads and nobody walks into, exactly as the wagon and
// the well already do. Widening that list is a config decision with a pinned hash behind it,
// not a layout one.
export function cityStructures(): CityStructure[] {
  return [
    ...DWELLINGS.map(({ kind, dx, dy, owner }) => {
      const f = DWELLING_FOOTPRINTS[kind]
      return {
        kind, dx, dy, w: f.w, h: f.h, owner, facing: 'sw' as const,
        furnishings: kind === 'house' ? [...HOUSE_FURNISHINGS] : [],
      }
    }),
    // The storehouse fronts the main street where it arrives at the square, so the first
    // building you pass coming from the river is the one the town keeps its food in.
    { kind: 'storehouse', dx: 13, dy: 12, w: 2, h: 2, owner: null, facing: 'sw' as const, furnishings: [...STOREHOUSE_FURNISHINGS] },
    { kind: 'well', dx: WELL_AT.dx, dy: WELL_AT.dy, w: 1, h: 1, owner: null, facing: 'sw' as const, furnishings: [] },
    { kind: 'fire_pit', dx: FIRE_PIT_AT.dx, dy: FIRE_PIT_AT.dy, w: 1, h: 1, owner: null, facing: 'sw' as const, furnishings: [] },
  ]
}

// Geometry only, so a caller holding a footprint and nothing else can ask. Both take the four
// numbers they read rather than a whole `CityStructure`: a schema field added for the art lane
// is not a reason for the showcase rasteriser to stop compiling.
export type StructureBox = { dx: number; dy: number; w: number; h: number }

// The tile a resident walks out of, on the south face, at the centre of the frontage.
export function doorTile(s: StructureBox): { dx: number; dy: number } {
  return { dx: s.dx + ((s.w - 1) >> 1), dy: s.dy + s.h - 1 }
}

export function structureTiles(s: StructureBox): { dx: number; dy: number }[] {
  const out: { dx: number; dy: number }[] = []
  for (let dy = s.dy; dy < s.dy + s.h; dy++)
    for (let dx = s.dx; dx < s.dx + s.w; dx++) out.push({ dx, dy })
  return out
}

// ---------------------------------------------------------------- assembly

// Parsed on the way out, so the function cannot return an invalid template. Pure: two calls
// are deep-equal and no RNG is consulted, which is why genesis can replay it.
export function makeCityTemplate(anchor: { x: number; y: number } = CITY_ANCHOR_DEFAULT): CityTemplate {
  return CityTemplateSchema.parse({
    anchor: { x: anchor.x, y: anchor.y },
    tiles: [...cityTerrainTiles(), ...cityRoadTiles()],
    structures: cityStructures(),
  })
}

export function templateFits(anchor: { x: number; y: number }, worldSize: number): boolean {
  return anchor.x >= 0 && anchor.y >= 0
    && anchor.x + CITY_W <= worldSize && anchor.y + CITY_H <= worldSize
}

// A growth plot is literally empty buildable ground next to a road: cleared grass, no
// structure, orthogonally adjacent to a road tile. Derived, never stored — nothing reserves it.
export function growthPlots(t: CityTemplate): { dx: number; dy: number }[] {
  const roads = new Set(t.tiles.filter(isRoadTile).map(x => key(x.dx, x.dy)))
  const built = new Set(t.structures.flatMap(s => structureTiles(s).map(x => key(x.dx, x.dy))))
  return t.tiles
    .filter(x => x.to === T_GRASS && !built.has(key(x.dx, x.dy)))
    .filter(x => [[0, -1], [1, 0], [0, 1], [-1, 0]]
      .some(([ox, oy]) => roads.has(key(x.dx + ox!, x.dy + oy!))))
    .map(x => ({ dx: x.dx, dy: x.dy }))
}

const ORTHO = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const

/** Every structure's door, and the road tile it opens onto. `onto` is null when a door faces
 *  no road at all — the frontage invariant is that this never happens. */
export function frontages(t: CityTemplate): Array<{
  kind: string; door: { dx: number; dy: number }; onto: { dx: number; dy: number } | null
}> {
  const roads = new Set(t.tiles.filter(isRoadTile).map(x => key(x.dx, x.dy)))
  return t.structures.map(s => {
    const door = doorTile(s)
    const onto = ORTHO
      .map(([ox, oy]) => ({ dx: door.dx + ox, dy: door.dy + oy }))
      .find(p => roads.has(key(p.dx, p.dy))) ?? null
    return { kind: s.kind, door, onto }
  })
}

/** A road tile with exactly one road neighbour that is not a door, an edge or the bank path —
 *  a path that leads nowhere. The invariant is that this list is empty. */
export function danglingRoadEnds(t: CityTemplate): { dx: number; dy: number }[] {
  const roads = new Set(t.tiles.filter(isRoadTile).map(x => key(x.dx, x.dy)))
  const doors = new Set(t.structures.map(s => { const d = doorTile(s); return key(d.dx, d.dy) }))
  const out: { dx: number; dy: number }[] = []
  for (const k of roads) {
    const [dx, dy] = k.split(',').map(Number) as [number, number]
    if (ORTHO.filter(([ox, oy]) => roads.has(key(dx + ox, dy + oy))).length !== 1) continue
    if (dx === 0 || dy === 0 || dx === CITY_W - 1 || dy === CITY_H - 1) continue  // a map edge
    if (dx === PATH_DX) continue                                                 // the bank path
    if (ORTHO.some(([ox, oy]) => doors.has(key(dx + ox, dy + oy)))) continue      // arrives at a door
    out.push({ dx, dy })
  }
  return out.sort((a, b) => a.dy - b.dy || a.dx - b.dx)
}

// ------------------------------------------------- WHAT "LOOKS LIKE A TOWN" MEANS, MEASURED
//
// Five properties, each a function of the template alone. They are the reason this file can be
// re-authored without a person squinting at a screenshot to decide whether it got better.

const roadSetOf = (t: CityTemplate): Set<string> =>
  new Set(t.tiles.filter(isRoadTile).map((x) => key(x.dx, x.dy)))

/** 1. FRONTAGE. Pairs of structures whose footprints touch orthogonally. A door that opens
 *  against a neighbour's wall is not frontage, and a town has ground on every side of every
 *  building — so the invariant is that this list is empty. */
export function touchingStructures(t: CityTemplate): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const at = new Map<string, number>()
  t.structures.forEach((s, i) => { for (const c of structureTiles(s)) at.set(key(c.dx, c.dy), i) })
  t.structures.forEach((s, i) => {
    const touched = new Set<number>()
    for (const c of structureTiles(s))
      for (const [ox, oy] of ORTHO) {
        const j = at.get(key(c.dx + ox, c.dy + oy))
        if (j !== undefined && j > i) touched.add(j)
      }
    for (const j of [...touched].sort((a, b) => a - b))
      out.push([`${s.kind}@${s.dx},${s.dy}`, `${t.structures[j]!.kind}@${t.structures[j]!.dx},${t.structures[j]!.dy}`])
  })
  return out
}

/** 2. CONNECTIVITY. Structures grouped by the road component their door opens onto. One group
 *  means you can walk from any building in town to any other without leaving the roads. */
export function structureComponents(t: CityTemplate): string[][] {
  const roads = roadSetOf(t)
  const label = new Map<string, number>()
  let n = 0
  for (const k of [...roads].sort()) {
    if (label.has(k)) continue
    const id = n++
    const stack = [k]
    label.set(k, id)
    while (stack.length > 0) {
      const [dx, dy] = stack.pop()!.split(',').map(Number) as [number, number]
      for (const [ox, oy] of ORTHO) {
        const nk = key(dx + ox, dy + oy)
        if (roads.has(nk) && !label.has(nk)) { label.set(nk, id); stack.push(nk) }
      }
    }
  }
  const groups = new Map<number | 'none', string[]>()
  for (const f of frontages(t)) {
    const id = f.onto === null ? 'none' : label.get(key(f.onto.dx, f.onto.dy))!
    const name = `${f.kind}@${f.door.dx},${f.door.dy}`
    const g = groups.get(id)
    if (g === undefined) groups.set(id, [name]); else g.push(name)
  }
  return [...groups.values()]
}

export type PlazaArrival = { side: 'n' | 'e' | 's' | 'w'; from: { dx: number; dy: number } }

/** 4. A CENTRE. The road tiles that arrive at the square from outside it, by compass side. A
 *  square streets merely pass is a wide street; a square streets ARRIVE at is a centre. */
export function plazaArrivals(t: CityTemplate): PlazaArrival[] {
  const roads = roadSetOf(t)
  const out: PlazaArrival[] = []
  const SIDES = [['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]] as const
  for (let dy = PLAZA.dy0; dy <= PLAZA.dy1; dy++)
    for (let dx = PLAZA.dx0; dx <= PLAZA.dx1; dx++) {
      if (!roads.has(key(dx, dy))) continue
      for (const [side, ox, oy] of SIDES) {
        const p = { dx: dx + ox, dy: dy + oy }
        if (inRect(PLAZA, p.dx, p.dy) || !roads.has(key(p.dx, p.dy))) continue
        out.push({ side, from: p })
      }
    }
  return out.sort((a, b) => a.from.dy - b.from.dy || a.from.dx - b.from.dx)
}

export type StreetRank = {
  /** `row 6` or `col 4` — the line of road every door on this rank opens onto */
  street: string
  dwellings: Array<{ kind: string; along: number; span: number }>
}

/** The houses of the town, grouped by the street their doors open onto and ordered along it.
 *  `along` is the near edge in the street's own direction and `span` the extent. */
export function dwellingRanks(t: CityTemplate): StreetRank[] {
  const roads = roadSetOf(t)
  const byStreet = new Map<string, StreetRank['dwellings']>()
  const onto0 = frontages(t)
  t.structures.forEach((s, i) => {
    if (!isDwellingKind(s.kind)) return
    const onto = onto0[i]!.onto
    if (onto === null) return
    const horizontal = roads.has(key(onto.dx - 1, onto.dy)) || roads.has(key(onto.dx + 1, onto.dy))
    const street = horizontal ? `row ${onto.dy}` : `col ${onto.dx}`
    const entry = horizontal
      ? { kind: s.kind, along: s.dx, span: s.w }
      : { kind: s.kind, along: s.dy, span: s.h }
    const g = byStreet.get(street)
    if (g === undefined) byStreet.set(street, [entry]); else g.push(entry)
  })
  return [...byStreet.entries()]
    .map(([street, dwellings]) => ({ street, dwellings: dwellings.sort((a, b) => a.along - b.along) }))
    .sort((a, b) => a.street.localeCompare(b.street))
}

/** 3. VARIETY OF MASS. The longest run of one dwelling kind standing consecutively on one
 *  street. Two neighbours of a kind read as neighbours; three read as a terrace, and five in
 *  a line was the complaint — so the ruling is N = 2. */
export function longestKindRun(t: CityTemplate): number {
  let worst = 0
  for (const rank of dwellingRanks(t)) {
    let run = 0, last = ''
    for (const d of rank.dwellings) {
      run = d.kind === last ? run + 1 : 1
      last = d.kind
      worst = Math.max(worst, run)
    }
  }
  return worst
}

/** 5. PLOTS AND GAPS. The empty ground between consecutive dwellings on each street. Every
 *  gap is at least one tile, and they are not all the same number. */
export function dwellingGaps(t: CityTemplate): number[] {
  const out: number[] = []
  for (const rank of dwellingRanks(t))
    for (let i = 1; i < rank.dwellings.length; i++) {
      const prev = rank.dwellings[i - 1]!, next = rank.dwellings[i]!
      out.push(next.along - (prev.along + prev.span))
    }
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
