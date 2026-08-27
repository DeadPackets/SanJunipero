import { z } from 'zod'
import { roadAutotile, type RoadAutotileKey } from './autotile.js'
import {
  BLOCK,
  PITCH,
  STREET,
  TOWN_FACINGS,
  blockRect,
  doorFrontOf,
  freePlots,
  plattedBlocks,
  streetTiles,
  type Ground,
  type PlacedStructure,
} from './townGrammar.js'
import { claimAll, plotKey, takenPlots, type Wanted } from './townClaim.js'
import { isTravelled, T_EARTH, T_GRASS, T_ROAD, T_WATER } from './tiles.js'

// Plats blocks on the 19-tile pitch and stands buildings on plots, so the genesis town and a
// town thirty builds later come out of one function. In shared: genesis (engine/gateway) reads it.

/** The town starts one ring of blocks around the square. It does not STAY that: `townGrammar`
 *  plats the next ring when this one fills, and nothing in this file caps the count. */
export const TOWN_RINGS_GENESIS = 1

/** Grammar coordinates run negative around the square; template coordinates start at zero.
 *  This is the shift between them, and it is a function of the ring count and nothing else. */
export const townOrigin = (rings: number): number => rings * PITCH + STREET
export const townSpan = (rings: number): number => 2 * townOrigin(rings) + BLOCK

export const TOWN_ORIGIN = townOrigin(TOWN_RINGS_GENESIS)

// The town grows outward around the square, so the square is the one town coordinate that has a
// world coordinate; the template's own origin walks a PITCH north-west per ring.
export const TOWN_SQUARE = { x: 65, y: 78 } as const

/** Where the template's own (0, 0) stands, for a town of `rings` rings around `square`. Runs
 *  negative from ring 4 — that ground is what growing north and west is for. */
export const anchorFor = (
  rings: number,
  square: { x: number; y: number } = TOWN_SQUARE,
): { x: number; y: number } => ({
  x: square.x - townOrigin(rings),
  y: square.y - townOrigin(rings),
})

// RIVER_LOCAL_DX + anchor.x is GENESIS_RIVER_X: a town that paints a channel the world does not
// have is a town with two rivers in it.
export const CITY_ANCHOR_DEFAULT = anchorFor(TOWN_RINGS_GENESIS)
export const CITY_W = townSpan(TOWN_RINGS_GENESIS),
  CITY_H = townSpan(TOWN_RINGS_GENESIS)
export const WORLD_SIZE_GENESIS = 128 // C11 §9; asserted here, never imported from engine

// Not a size, a clearance: one block pitch of wild beyond everything standing, which is exactly
// the ground the next ring needs. So the world can never be the thing that stops a build.
export const WORLD_MARGIN = PITCH

/** The smallest square world that can hold a town of `rings` rings, margin and all. Unbounded
 *  in `rings`, because the grammar is: ask for a bigger town and get a bigger world. */
export const worldSizeForRings = (rings: number): number => townSpan(rings) + 2 * WORLD_MARGIN

/** That world, laid out: the town sits one margin in from every edge. This is the world's OWN
 *  frame — its origin is not the authored origin, because growing north or west moves it. */
export function worldForRings(rings: number): {
  size: number
  anchor: { x: number; y: number }
  square: { x: number; y: number }
} {
  const anchor = { x: WORLD_MARGIN, y: WORLD_MARGIN }
  return {
    size: worldSizeForRings(rings),
    anchor,
    square: { x: anchor.x + townOrigin(rings), y: anchor.y + townOrigin(rings) },
  }
}

export type EdgeOwed = { edge: 'n' | 'e' | 's' | 'w'; owed: number }

/** Off a measured box of what stands, never a ring count: a ring count needs the square's world
 *  coordinate and the array origin moves. An empty list is the invariant. */
export function edgesOwed(
  box: { dx0: number; dy0: number; dx1: number; dy1: number },
  size: { w: number; h: number },
  margin: number = WORLD_MARGIN,
): EdgeOwed[] {
  const clearance = { n: box.dy0, w: box.dx0, s: size.h - 1 - box.dy1, e: size.w - 1 - box.dx1 }
  return (['n', 'e', 's', 'w'] as const)
    .map((edge) => ({ edge, owed: margin - clearance[edge] }))
    .filter((x) => x.owed > 0)
}

export type Rect = { dx0: number; dy0: number; dx1: number; dy1: number }

export const CityTileSchema = z
  .object({
    dx: z.number().int(),
    dy: z.number().int(),
    to: z.number().int(),
  })
  .strict()

export const CityFurnishingSchema = z
  .object({
    kind: z.string(),
    slot: z.object({ x: z.number().int(), y: z.number().int() }).strict(),
  })
  .strict()

export const CityStructureSchema = z
  .object({
    kind: z.string(),
    dx: z.number().int(),
    dy: z.number().int(),
    w: z.number().int().min(1).max(4),
    h: z.number().int().min(1).max(4),
    // USER RULING 1: the five houses are owned, one founder each; every public building is null.
    // The field is REQUIRED; only its value may be null.
    owner: z.string().min(1).nullable(),
    // A two-value enum, and REQUIRED, so `ne` and `nw` — which the forge has no art for — are
    // unrepresentable rather than merely unused. facingFrom(dx, dy) answers four ways.
    facing: z.enum(TOWN_FACINGS),
    furnishings: z.array(CityFurnishingSchema),
  })
  .strict()

export const CityTemplateSchema = z
  .object({
    anchor: z.object({ x: z.number().int(), y: z.number().int() }).strict(),
    tiles: z.array(CityTileSchema),
    structures: z.array(CityStructureSchema),
  })
  .strict()

export type CityTile = z.infer<typeof CityTileSchema>
export type CityFurnishing = z.infer<typeof CityFurnishingSchema>
export type CityStructure = z.infer<typeof CityStructureSchema>
export type CityTemplate = z.infer<typeof CityTemplateSchema>

export function inExtent(dx: number, dy: number, rings: number = TOWN_RINGS_GENESIS): boolean {
  const span = townSpan(rings)
  return dx >= 0 && dy >= 0 && dx < span && dy < span
}

export function inRect(r: Rect, dx: number, dy: number): boolean {
  return dx >= r.dx0 && dx <= r.dx1 && dy >= r.dy0 && dy <= r.dy1
}

export const key = (dx: number, dy: number): string => `${dx},${dy}`

// ---------------------------------------------------------------- the ground the town plats on

// Fixed in grammar coordinates: TOWN_SQUARE.x + RIVER_GRAMMAR_DX === GENESIS_RIVER_X at every
// ring count. Straight, not the grammar's meander — the town paints the water it stands beside.
export const RIVER_GRAMMAR_DX = -16
export const RIVER_HALF = 1 // three tiles of channel
export const BANK_HALF = 2 // one tile of wet earth either side

export const riverLocalDx = (rings: number): number => RIVER_GRAMMAR_DX + townOrigin(rings)
export const RIVER_LOCAL_DX = riverLocalDx(TOWN_RINGS_GENESIS) // + CITY_ANCHOR_DEFAULT.x = GENESIS_RIVER_X

/** The ground in TEMPLATE coordinates. A column, not a field: the channel runs true north. */
export function cityGroundAt(
  dx: number,
  rings: number = TOWN_RINGS_GENESIS,
): 'dry' | 'water' | 'bank' {
  const d = Math.abs(dx - riverLocalDx(rings))
  return d <= RIVER_HALF ? 'water' : d <= BANK_HALF ? 'bank' : 'dry'
}

/** The same ground in GRAMMAR coordinates, which is what the plat rule reads. Ring-independent
 *  by construction: a bigger town plats against the same river, in the same place. */
export const CITY_GROUND: Ground = (dx) => {
  const d = Math.abs(dx - RIVER_GRAMMAR_DX)
  return d <= RIVER_HALF ? 'water' : d <= BANK_HALF ? 'bank' : 'dry'
}

const toLocal = <T extends { dx: number; dy: number }>(
  t: T,
  rings: number = TOWN_RINGS_GENESIS,
): T => ({ ...t, dx: t.dx + townOrigin(rings), dy: t.dy + townOrigin(rings) })

// ---------------------------------------------------------------- the square

// Ring 0 is the square. It is never platted, never built on, and it holds the well and the
// fire pit — which is why a centre reads as a centre: the thing at its centre is in it.
const SQUARE = blockRect(0, 0)
export function plazaOf(rings: number = TOWN_RINGS_GENESIS): Rect {
  const o = townOrigin(rings)
  return { dx0: SQUARE.dx0 + o, dy0: SQUARE.dy0 + o, dx1: SQUARE.dx1 + o, dy1: SQUARE.dy1 + o }
}
export const PLAZA: Rect = plazaOf(TOWN_RINGS_GENESIS)

/** The tile you actually stand on, between the two monuments. Paving, never a monument. */
export const plazaCentreOf = (rings: number = TOWN_RINGS_GENESIS): { dx: number; dy: number } => ({
  dx: plazaOf(rings).dx0 + 7,
  dy: plazaOf(rings).dy0 + 7,
})
export const wellAt = (rings: number = TOWN_RINGS_GENESIS): { dx: number; dy: number } => ({
  dx: plazaOf(rings).dx0 + 4,
  dy: plazaOf(rings).dy0 + 5,
})
export const firePitAt = (rings: number = TOWN_RINGS_GENESIS): { dx: number; dy: number } => ({
  dx: plazaOf(rings).dx0 + 9,
  dy: plazaOf(rings).dy0 + 9,
})

export const PLAZA_CENTRE = plazaCentreOf(TOWN_RINGS_GENESIS)
export const WELL_AT = wellAt(TOWN_RINGS_GENESIS)
export const FIRE_PIT_AT = firePitAt(TOWN_RINGS_GENESIS)

// ---------------------------------------------------------------- terrain and roads

function rectTiles(r: Rect, to: number): CityTile[] {
  const out: CityTile[] = []
  for (let dy = r.dy0; dy <= r.dy1; dy++)
    for (let dx = r.dx0; dx <= r.dx1; dx++) out.push({ dx, dy, to })
  return out
}

/** Every tile of the extent is authored — water, wet bank or cleared grass — so a building never
 *  stands in a forest and a street is never impassable. Road tiles are cut out here. */
export function cityTerrainTiles(rings: number = TOWN_RINGS_GENESIS): CityTile[] {
  const road = new Set(cityRoadTiles(rings).map((t) => key(t.dx, t.dy)))
  const span = townSpan(rings)
  const out: CityTile[] = []
  for (let dy = 0; dy < span; dy++)
    for (let dx = 0; dx < span; dx++) {
      if (road.has(key(dx, dy))) continue
      const g = cityGroundAt(dx, rings)
      out.push({ dx, dy, to: g === 'water' ? T_WATER : g === 'bank' ? T_EARTH : T_GRASS })
    }
  return out
}

/** The streets the grammar plats, plus the square's paving (the two monument tiles stay bare).
 *  No special case, ever: a widened-main-street special case once ran a road through a block's
 *  frontage. `streetTiles` cuts water, so nothing here crosses the channel. */
export function cityRoadTiles(rings: number = TOWN_RINGS_GENESIS): CityTile[] {
  const well = wellAt(rings),
    firePit = firePitAt(rings)
  const monuments = new Set([key(well.dx, well.dy), key(firePit.dx, firePit.dy)])
  const seen = new Set<string>()
  const out: CityTile[] = []
  const add = (dx: number, dy: number): void => {
    const k = key(dx, dy)
    if (seen.has(k) || monuments.has(k) || !inExtent(dx, dy, rings)) return
    seen.add(k)
    out.push({ dx, dy, to: T_ROAD })
  }
  for (const t of streetTiles(rings, CITY_GROUND)) {
    const l = toLocal(t, rings)
    add(l.dx, l.dy)
  }
  // The square is paved, and the paving is laid AROUND the two monuments so neither ever
  // stands on a road.
  for (const t of rectTiles(plazaOf(rings), T_ROAD)) add(t.dx, t.dy)
  return out
}

export const isRoadTile = (t: CityTile): boolean => isTravelled(t.to)

// ---------------------------------------------------------------- structures

// A shared contract with the art lane: the dwelling kinds this template places. What can be
// BUILT is structures.recipes, not this list.
export const CITY_DWELLING_KINDS = ['cottage', 'farmhouse', 'cabin', 'house'] as const
export type DwellingKind = (typeof CITY_DWELLING_KINDS)[number]
export const isDwellingKind = (kind: string): kind is DwellingKind =>
  (CITY_DWELLING_KINDS as readonly string[]).includes(kind)

// The UNTURNED footprint: w runs along the street, h into the block. footprintFor is the only
// correct way to ask what ground a placed building covers — an SE building stands on it turned.
export const DWELLING_FOOTPRINTS: Readonly<Record<DwellingKind, { w: number; h: number }>> = {
  cabin: { w: 2, h: 2 },
  cottage: { w: 3, h: 2 },
  farmhouse: { w: 4, h: 2 },
  // 2×2 is the footprint every landed gate measured a founder's home at, and `houseSize` in
  // SimConfigSchema still says so; this row and that dial must not drift apart.
  house: { w: 2, h: 2 },
}

// Two tiles of floor per body — physics, not ownership. Read by both sides: the engine caps a
// room by it, and the template below lays a bed per body.
export const TILES_PER_BODY = 2

export function roomCapacity(s: { w: number; h: number }): number {
  return Math.max(1, Math.floor((s.w * s.h) / TILES_PER_BODY))
}

/** The ground a building of this mass covers once it is turned to face `facing`. */
export const footprintFor = (
  mass: { w: number; h: number },
  facing: 'sw' | 'se',
): { w: number; h: number } =>
  facing === 'sw' ? { w: mass.w, h: mass.h } : { w: mass.h, h: mass.w }

// Assumption A-2: the five locked founders (design spec §10). Template data, not engine truth
// — genesis binds them, and different id strings are one data edit with no code change.
export const FOUNDER_IDS = ['amara', 'yusuf', 'nadia', 'omar', 'salma'] as const
export type FounderId = (typeof FOUNDER_IDS)[number]

// The room grid every enterable structure exposes to its furnishings: template vocabulary
// only, never what a room actually looks like.
export const CITY_INTERIOR_SLOTS = { w: 3, h: 3 } as const

/** A bed is 1x2, so three beds fill two rows of a 3x3 grid and a farmhouse's fourth has nowhere
 *  to go: the grid, not the floor, is what runs out. Widens with roomCapacity, never below 3. */
export function citySlotsFor(kind: string): { w: number; h: number } {
  const plan = (DWELLING_FOOTPRINTS as Record<string, { w: number; h: number } | undefined>)[kind]
  const w =
    plan === undefined ? CITY_INTERIOR_SLOTS.w : Math.max(CITY_INTERIOR_SLOTS.w, roomCapacity(plan))
  return { w, h: CITY_INTERIOR_SLOTS.h }
}

// Shared cannot import the forge catalog, so these stand in for it here; g13.test.ts
// asserts them equal to the library.
export const CITY_FURNISHING_KINDS = [
  'bed',
  'hearth',
  'table',
  'chair',
  'rug',
  'shelf',
  'crate',
  'barrel',
  'anvil',
  'bench',
] as const
export const CITY_BED_KIND = 'bed'
export const CITY_HEARTH_KIND = 'hearth'

// (0, 2) written in three places is (0, 2) that drifts.
const THE_BED: CityFurnishing = { kind: CITY_BED_KIND, slot: { x: 2, y: 1 } }
const THE_HEARTH: CityFurnishing = { kind: CITY_HEARTH_KIND, slot: { x: 0, y: 2 } }
/** Bed count is roomCapacity — the same floor(w*h/2) the ladder is priced on. A private kind
 *  lays one bed (a couple); a shared kind lays one per body. */
const bedRow = (count: number): CityFurnishing[] =>
  Array.from({ length: count }, (_, i) => ({ kind: CITY_BED_KIND, slot: { x: i, y: 0 } }))

const sharedDwelling = (kind: DwellingKind): CityFurnishing[] => {
  const slots = citySlotsFor(kind)
  return [
    ...bedRow(roomCapacity(DWELLING_FOOTPRINTS[kind])),
    THE_HEARTH,
    { kind: 'table', slot: { x: 1, y: 2 } },
    { kind: 'bench', slot: { x: slots.w - 1, y: 2 } },
  ]
}
const HOUSE_FURNISHINGS: CityFurnishing[] = [
  THE_BED,
  THE_HEARTH,
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

const STOREHOUSE_KIND = 'storehouse'

const mass = (m: { w: number; h: number }): { along: number; deep: number } => ({
  along: m.w,
  deep: m.h,
})

// Genesis asks for buildings in the order they are raised, never for positions: each claims the free
// plot nearest the square, so moving a line moves a building and cannot move it onto a road or a neighbour.
export const GENESIS_WANTED: readonly Wanted[] = [
  { kind: STOREHOUSE_KIND, ...mass(DWELLING_FOOTPRINTS.house), owner: null },
  { kind: 'house', ...mass(DWELLING_FOOTPRINTS.house), owner: 'amara' },
  { kind: 'house', ...mass(DWELLING_FOOTPRINTS.house), owner: 'yusuf' },
  { kind: 'cottage', ...mass(DWELLING_FOOTPRINTS.cottage), owner: null },
  { kind: 'house', ...mass(DWELLING_FOOTPRINTS.house), owner: 'nadia' },
  { kind: 'cabin', ...mass(DWELLING_FOOTPRINTS.cabin), owner: null },
  { kind: 'house', ...mass(DWELLING_FOOTPRINTS.house), owner: 'omar' },
  { kind: 'house', ...mass(DWELLING_FOOTPRINTS.house), owner: 'salma' },
  { kind: 'farmhouse', ...mass(DWELLING_FOOTPRINTS.farmhouse), owner: null },
]

// A kind whose row says `hearth` is furnished with one, or it is a fire a mind can feed and
// nobody can see; config.test.ts holds the two halves equal.
const FURNISHINGS_BY_KIND: Readonly<Record<string, CityFurnishing[]>> = {
  house: HOUSE_FURNISHINGS,
  cottage: sharedDwelling('cottage'),
  farmhouse: sharedDwelling('farmhouse'),
  // A refuge, not a home: no bed, no table, no rug. The bench and the woodpile are the two things
  // a refuge has — somewhere to sit out a night, and the fuel the fire is fed from.
  cabin: [
    THE_HEARTH,
    { kind: 'bench', slot: { x: 1, y: 2 } },
    { kind: 'crate', slot: { x: 2, y: 2 } },
  ],
  [STOREHOUSE_KIND]: STOREHOUSE_FURNISHINGS,
}

const furnishingsFor = (kind: string): CityFurnishing[] => [...(FURNISHINGS_BY_KIND[kind] ?? [])]

/** The buildings the grammar plats, in grammar coordinates — the one place a plot is claimed. */
export function cityPlacements(): PlacedStructure[] {
  return claimAll({ ground: CITY_GROUND, wanted: GENESIS_WANTED }).built
}

// Eleven: nine buildings on nine claimed plots plus the two monuments. The standing stone is
// deliberately absent. Only structures.privateKinds (house) separates a home from a bigger roof.
export function cityStructures(rings: number = TOWN_RINGS_GENESIS): CityStructure[] {
  const monument = (kind: string, at: { dx: number; dy: number }): CityStructure => ({
    kind,
    dx: at.dx,
    dy: at.dy,
    w: 1,
    h: 1,
    owner: null,
    facing: 'sw',
    furnishings: [],
  })
  return [
    ...cityPlacements().map((s): CityStructure => {
      const l = toLocal(s, rings)
      return {
        kind: l.kind,
        dx: l.dx,
        dy: l.dy,
        w: l.w,
        h: l.h,
        owner: l.owner,
        facing: l.facing,
        furnishings: furnishingsFor(l.kind),
      }
    }),
    monument('well', wellAt(rings)),
    monument('fire_pit', firePitAt(rings)),
  ]
}

// Geometry only: both take the four numbers they read rather than a whole CityStructure, so a
// schema field added for the art lane cannot stop the showcase rasteriser compiling.
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

/** The tile the door opens onto — outside the building, on the face its `facing` names: SW opens
 *  on the +y face, SE on the +x, and there is no third. `frontages` measures it. */
export function doorFrontTile(s: CityStructure): { dx: number; dy: number } {
  return doorFrontOf(s)
}

// ---------------------------------------------------------------- assembly

// Parsed on the way out, so the function cannot return an invalid template. Pure: two calls
// are deep-equal and no RNG is consulted, which is why genesis can replay it.
export function makeCityTemplate(
  anchor: { x: number; y: number } = CITY_ANCHOR_DEFAULT,
  rings: number = TOWN_RINGS_GENESIS,
): CityTemplate {
  return CityTemplateSchema.parse({
    anchor: { x: anchor.x, y: anchor.y },
    tiles: [...cityTerrainTiles(rings), ...cityRoadTiles(rings)],
    structures: cityStructures(rings),
  })
}

export function templateFits(
  anchor: { x: number; y: number },
  worldSize: number,
  rings: number = TOWN_RINGS_GENESIS,
): boolean {
  const span = townSpan(rings)
  return (
    anchor.x >= 0 && anchor.y >= 0 && anchor.x + span <= worldSize && anchor.y + span <= worldSize
  )
}

// Two questions, never one function: plattedPlots(rings) is a fact about the lattice,
// genesisEmptyPlots(rings) about the template. What is free right now is claimTownPlot (townPlot.ts).

export type PlotTile = {
  dx: number
  dy: number
  facing: 'sw' | 'se'
  block: { i: number; j: number }
  slot: string
}

/** Every plot the grammar plats out to `rings`, in TEMPLATE coordinates; the tile is the plot's
 *  street corner. A plot outside the extent THROWS rather than being quietly dropped. */
export function plattedPlots(rings: number = TOWN_RINGS_GENESIS): PlotTile[] {
  if (!Number.isInteger(rings) || rings < 1) {
    throw new Error(`plattedPlots: a town of ${rings} ring(s) has no plots — ask for at least 1`)
  }
  const o = townOrigin(rings)
  return freePlots(rings, CITY_GROUND).map((p) => {
    const at: PlotTile = {
      ...(p.face === 'sw'
        ? { dx: p.dx + o, dy: p.anchorY - 1 + o }
        : { dx: p.anchorX - 1 + o, dy: p.dy + o }),
      facing: p.face,
      block: p.block,
      slot: p.slot,
    }
    if (!inExtent(at.dx, at.dy, rings)) {
      throw new Error(
        `plattedPlots: plot ${plotKey(p)} at ${key(at.dx, at.dy)} falls outside a ${rings}-ring town`,
      )
    }
    return at
  })
}

/** A fact about the template, not any running world: eleven on day one and eleven on day one
 *  hundred. What is free now is claimTownPlot. */
export function genesisEmptyPlots(rings: number = TOWN_RINGS_GENESIS): PlotTile[] {
  const taken = takenPlots(cityPlacements())
  return plattedPlots(rings).filter((p) => !taken.has(plotKey(p)))
}

/** How many tiles across the template actually is, read off its own ground. */
const templateSpan = (t: CityTemplate): number =>
  t.tiles.reduce((m, x) => Math.max(m, x.dx + 1, x.dy + 1), 0)

/** The empty plots of THIS template, as bare tiles. Throws when `t` was built for another ring
 *  count rather than quietly answering with a shorter list. */
export function growthPlots(
  t: CityTemplate,
  rings: number = TOWN_RINGS_GENESIS,
): { dx: number; dy: number }[] {
  const span = templateSpan(t)
  if (span !== townSpan(rings)) {
    throw new Error(
      `growthPlots: a template ${span} tiles across is not a town of ${rings} ring(s)` +
        ` — that wants ${townSpan(rings)}`,
    )
  }
  return genesisEmptyPlots(rings).map(({ dx, dy }) => ({ dx, dy }))
}

/** The blocks the town has platted, for a viewer that wants to draw them. */
export const cityBlocks = (rings: number = TOWN_RINGS_GENESIS): { i: number; j: number }[] =>
  plattedBlocks(rings, CITY_GROUND)

const ORTHO = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const

/** Every structure's door, and the road tile it opens onto. `onto` is null when the face the
 *  building presents is not a road — the frontage invariant is that this never happens. */
export function frontages(t: CityTemplate): {
  kind: string
  door: { dx: number; dy: number }
  onto: { dx: number; dy: number } | null
}[] {
  const roads = new Set(t.tiles.filter(isRoadTile).map((x) => key(x.dx, x.dy)))
  return t.structures.map((s) => {
    const front = doorFrontTile(s)
    // The well and the fire pit have no door; they stand in the paving and are reached from
    // every side, so their frontage is any road tile that touches them.
    const onto = roads.has(key(front.dx, front.dy))
      ? front
      : s.w === 1 && s.h === 1
        ? (ORTHO.map(([ox, oy]) => ({ dx: s.dx + ox, dy: s.dy + oy })).find((p) =>
            roads.has(key(p.dx, p.dy)),
          ) ?? null)
        : null
    return { kind: s.kind, door: doorTile(s), onto }
  })
}

/** A road tile with exactly one road neighbour that is not a door or a template edge — a path
 *  that leads nowhere. The invariant is that this list is empty. */
export function danglingRoadEnds(
  t: CityTemplate,
  rings: number = TOWN_RINGS_GENESIS,
): { dx: number; dy: number }[] {
  const edge = townSpan(rings) - 1
  const roads = new Set(t.tiles.filter(isRoadTile).map((x) => key(x.dx, x.dy)))
  const doors = new Set(
    t.structures.map((s) => {
      const d = doorTile(s)
      return key(d.dx, d.dy)
    }),
  )
  const out: { dx: number; dy: number }[] = []
  for (const k of roads) {
    const [dx, dy] = k.split(',').map(Number) as [number, number]
    if (ORTHO.filter(([ox, oy]) => roads.has(key(dx + ox, dy + oy))).length !== 1) continue
    if (dx === 0 || dy === 0 || dx === edge || dy === edge) continue // a map edge
    if (ORTHO.some(([ox, oy]) => doors.has(key(dx + ox, dy + oy)))) continue // arrives at a door
    out.push({ dx, dy })
  }
  return out.sort((a, b) => a.dy - b.dy || a.dx - b.dx)
}

// Neighbours are computed over the road set only (T_ROAD ∪ T_PATH), then the shared autotiler
// picks the tile. Keyed 'dx,dy'.
export function cityRoadKeys(tiles: readonly CityTile[]): Map<string, RoadAutotileKey> {
  const set = new Set(tiles.filter(isRoadTile).map((t) => key(t.dx, t.dy)))
  const out = new Map<string, RoadAutotileKey>()
  for (const k of set) {
    const [dx, dy] = k.split(',').map(Number) as [number, number]
    out.set(
      k,
      roadAutotile({
        n: set.has(key(dx, dy - 1)),
        e: set.has(key(dx + 1, dy)),
        s: set.has(key(dx, dy + 1)),
        w: set.has(key(dx - 1, dy)),
      }),
    )
  }
  return out
}
