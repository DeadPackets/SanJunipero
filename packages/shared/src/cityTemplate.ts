import { z } from 'zod'
import { roadAutotile, type RoadAutotileKey } from './autotile.js'
import {
  BLOCK, PITCH, STREET, TOWN_FACINGS, blockRect, doorFrontOf, freePlots, plattedBlocks,
  streetTiles, type Ground, type PlacedStructure,
} from './townGrammar.js'
import { claimAll, plotKey, takenPlots, type Wanted } from './townClaim.js'

// ★ THE TEMPLATE IS A PLOTTER, NOT A PICTURE.
//
// This file used to be a hand-written list of eight dwellings at literal coordinates, and the
// user rejected the town it drew on sight: "This doesn't look like a real city. You need to
// design a city that looks like it makes sense, can naturally expand (as agents build new
// buildings and roads), and is still spaced enough." It now plats blocks on the 19-tile pitch,
// derives plots from blocks and stands buildings on plots — and the genesis town comes out of
// the SAME function that produces a town thirty builds later. One grammar, no special case for
// the start. `townGrammar.ts` holds the rule and its exhaustive proof; this file is where the
// rule meets the world: a ring count, an anchor, a river, and the eleven things genesis stands.
//
// Its consumer is genesis (engine/gateway), so it lives in shared: homing it in forge would
// make the engine depend on sharp and better-sqlite3 to read a fixture (plan deviation D-2,
// controller-accepted).

/** The town starts one ring of blocks around the square. It does not STAY that: `townGrammar`
 *  plats the next ring when this one fills, and nothing in this file caps the count. */
export const TOWN_RINGS_GENESIS = 1

/** Grammar coordinates run negative around the square; template coordinates start at zero.
 *  This is the shift between them, and it is a function of the ring count and nothing else. */
export const townOrigin = (rings: number): number => rings * PITCH + STREET
export const townSpan = (rings: number): number => 2 * townOrigin(rings) + BLOCK

export const TOWN_ORIGIN = townOrigin(TOWN_RINGS_GENESIS)

// ★ THE ANCHOR PUTS THE TOWN'S RIVER ON THE WORLD'S RIVER. `RIVER_LOCAL_DX + anchor.x` is
// `GENESIS_RIVER_X`; engine's world.test.ts asserts the two agree, because a town that paints
// a channel the world does not have is a town with two rivers in it.
export const CITY_ANCHOR_DEFAULT = { x: 43, y: 56 } as const
export const CITY_W = townSpan(TOWN_RINGS_GENESIS), CITY_H = townSpan(TOWN_RINGS_GENESIS)
export const WORLD_SIZE_GENESIS = 128           // C11 §9; asserted here, never imported from engine

// C9 T1b + C11 §9 TileIds.
export const T_GRASS = 0, T_EARTH = 1, T_WATER = 2, T_ROAD = 7, T_PATH = 8

export type Rect = { dx0: number; dy0: number; dx1: number; dy1: number }

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

// ---------------------------------------------------------------- the ground the town plats on

// ★ A RIVER IS A REASON FOR THE TOWN'S SHAPE, NOT A STRIPE. It is what makes ring 1 plat FIVE
// blocks and not eight: the whole western column stands in water, so the grid is simply not
// laid there, and the west of the template is riverfront rather than street. Nothing is placed
// against it by hand — the plat rule reads the ground and the plots follow.
//
// STRAIGHT, not the reference meander. `townGrammar.RIVER_GROUND` carries the meander and the
// grammar's own ruling numbers are proven on it; the town paints the water it is ACTUALLY
// built beside, and the world's channel where the town stands is straight. A grammar that
// refuses to build on water must refuse the water that is there.
export const RIVER_LOCAL_DX = 6         // + CITY_ANCHOR_DEFAULT.x = GENESIS_RIVER_X
export const RIVER_HALF = 1             // three tiles of channel
export const BANK_HALF = 2              // one tile of wet earth either side

const riverOffset = (localDx: number): number => Math.abs(localDx - RIVER_LOCAL_DX)

/** The ground in TEMPLATE coordinates. A column, not a field: the channel runs true north. */
export function cityGroundAt(dx: number): 'dry' | 'water' | 'bank' {
  const d = riverOffset(dx)
  return d <= RIVER_HALF ? 'water' : d <= BANK_HALF ? 'bank' : 'dry'
}

/** The same ground in GRAMMAR coordinates, which is what the plat rule reads. */
export const CITY_GROUND: Ground = (dx) => cityGroundAt(dx + TOWN_ORIGIN)

const toLocal = <T extends { dx: number; dy: number }>(t: T): T =>
  ({ ...t, dx: t.dx + TOWN_ORIGIN, dy: t.dy + TOWN_ORIGIN })

// ---------------------------------------------------------------- the square

// Ring 0 is the square. It is never platted, never built on, and it holds the well and the
// fire pit — which is why a centre reads as a centre: the thing at its centre is in it.
const SQUARE = blockRect(0, 0)
export const PLAZA: Rect = {
  dx0: SQUARE.dx0 + TOWN_ORIGIN, dy0: SQUARE.dy0 + TOWN_ORIGIN,
  dx1: SQUARE.dx1 + TOWN_ORIGIN, dy1: SQUARE.dy1 + TOWN_ORIGIN,
}
/** The tile you actually stand on, between the two monuments. Paving, never a monument. */
export const PLAZA_CENTRE = { dx: PLAZA.dx0 + 7, dy: PLAZA.dy0 + 7 } as const
export const WELL_AT = { dx: PLAZA.dx0 + 4, dy: PLAZA.dy0 + 5 } as const
export const FIRE_PIT_AT = { dx: PLAZA.dx0 + 9, dy: PLAZA.dy0 + 9 } as const

// ---------------------------------------------------------------- terrain and roads

function rectTiles(r: Rect, to: number): CityTile[] {
  const out: CityTile[] = []
  for (let dy = r.dy0; dy <= r.dy1; dy++)
    for (let dx = r.dx0; dx <= r.dx1; dx++) out.push({ dx, dy, to })
  return out
}

/** ★ THE TOWN CLEARS ITS OWN GROUND. Every tile of the extent is authored — water, wet bank,
 *  or cleared grass — so a building never stands in a forest the world happened to grow there
 *  and a street is never impassable ground. Road tiles are laid by `cityRoadTiles` and cut out
 *  here, so the two sets stay disjoint. */
export function cityTerrainTiles(): CityTile[] {
  const road = new Set(cityRoadTiles().map(t => key(t.dx, t.dy)))
  const out: CityTile[] = []
  for (let dy = 0; dy < CITY_H; dy++)
    for (let dx = 0; dx < CITY_W; dx++) {
      if (road.has(key(dx, dy))) continue
      const g = cityGroundAt(dx)
      out.push({ dx, dy, to: g === 'water' ? T_WATER : g === 'bank' ? T_EARTH : T_GRASS })
    }
  return out
}

/**
 * The streets the grammar plats, plus the square's paving.
 *
 * ★ THERE IS NO SPECIAL CASE HERE AND THERE MUST NEVER BE ONE. A phantom road row once ran
 * straight through the frontage of a block, putting buildings on roads; it came from a special
 * case that widened the main street, and the fix was DELETING the special case. Every street
 * in this town is a street the plat rule laid.
 *
 * NO BRIDGE: `streetTiles` cuts water out of the set, so nothing here crosses the channel —
 * the far bank is an earned milestone (C11 §2).
 */
export function cityRoadTiles(): CityTile[] {
  const monuments = new Set([key(WELL_AT.dx, WELL_AT.dy), key(FIRE_PIT_AT.dx, FIRE_PIT_AT.dy)])
  const seen = new Set<string>()
  const out: CityTile[] = []
  const add = (dx: number, dy: number): void => {
    const k = key(dx, dy)
    if (seen.has(k) || monuments.has(k) || !inExtent(dx, dy)) return
    seen.add(k)
    out.push({ dx, dy, to: T_ROAD })
  }
  for (const t of streetTiles(TOWN_RINGS_GENESIS, CITY_GROUND)) {
    const l = toLocal(t)
    add(l.dx, l.dy)
  }
  // The square is paved, and the paving is laid AROUND the two monuments so neither ever
  // stands on a road.
  for (const t of rectTiles(PLAZA, T_ROAD)) add(t.dx, t.dy)
  return out
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
// eight ground tiles.
//
// ★ THIS TABLE IS THE UNTURNED FOOTPRINT — `w` runs ALONG the street, `h` INTO the block.
// A building on an east plot stands on that same footprint TURNED, so a farmhouse is 4×2 on a
// south plot and 2×4 on an east one: one building, two ground shapes. `footprintFor` is the
// only correct way to ask what ground a placed building covers, and reading `w`/`h` off this
// row for an SE building is the mistake it exists to prevent.
export const DWELLING_FOOTPRINTS: Readonly<Record<DwellingKind, { w: number; h: number }>> = {
  cabin: { w: 2, h: 2 }, cottage: { w: 3, h: 2 }, farmhouse: { w: 4, h: 2 },
  // 2×2 is the footprint every landed gate measured a founder's home at, and `houseSize` in
  // SimConfigSchema still says so; this row and that dial must not drift apart.
  house: { w: 2, h: 2 },
}

/** The ground a building of this mass covers once it is turned to face `facing`. */
export const footprintFor = (
  mass: { w: number; h: number }, facing: 'sw' | 'se',
): { w: number; h: number } => facing === 'sw' ? { w: mass.w, h: mass.h } : { w: mass.h, h: mass.w }

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

const STOREHOUSE_KIND = 'storehouse'

/**
 * ★ WHAT GENESIS ASKS THE GRAMMAR FOR — a list of buildings, NOT a list of positions.
 *
 * Nine buildings in the order they are raised. Each one claims the free plot nearest the
 * square, so the order below is the only thing that decides where anything stands, and moving
 * a line moves a building without any chance of moving it onto a road, into the river, or on
 * top of a neighbour. The five founders' houses are interleaved with the public buildings
 * rather than ranked together, which is what gives the streets more than one silhouette.
 */
const mass = (m: { w: number; h: number }): { along: number; deep: number } =>
  ({ along: m.w, deep: m.h })

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

const furnishingsFor = (kind: string): CityFurnishing[] =>
  kind === 'house' ? [...HOUSE_FURNISHINGS]
    : kind === STOREHOUSE_KIND ? [...STOREHOUSE_FURNISHINGS] : []

/** The buildings the grammar plats, in grammar coordinates — the one place a plot is claimed. */
export function cityPlacements(): PlacedStructure[] {
  return claimAll({ ground: CITY_GROUND, wanted: GENESIS_WANTED }).built
}

// Eleven structures, the count C13 pinned: nine buildings on nine claimed plots, and the two
// monuments in the square. The STANDING STONE is deliberately absent — it stands beyond the
// edge of town, unexplained (C11 §9).
//
// ONLY A HOUSE IS A HOME. `structures.enterableKinds` and `sleepableKinds` name `house` and
// nothing else, so the five founders keep five houses, one each, and the cottage, cabin and
// farmhouse stand as fixtures the eye reads and nobody walks into. Widening that list is a
// config decision with a pinned hash behind it, not a layout one.
export function cityStructures(): CityStructure[] {
  const monument = (kind: string, at: { dx: number; dy: number }): CityStructure => ({
    kind, dx: at.dx, dy: at.dy, w: 1, h: 1, owner: null, facing: 'sw', furnishings: [],
  })
  return [
    ...cityPlacements().map((s): CityStructure => {
      const l = toLocal(s)
      return {
        kind: l.kind, dx: l.dx, dy: l.dy, w: l.w, h: l.h, owner: l.owner, facing: l.facing,
        furnishings: furnishingsFor(l.kind),
      }
    }),
    monument('well', WELL_AT),
    monument('fire_pit', FIRE_PIT_AT),
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

/** ★ THE TILE THE DOOR OPENS ONTO — outside the building, on the face its `facing` names. SW
 *  opens on the +y face, SE on the +x face, and there is no third answer because there is no
 *  third facing. A door that opens onto anything but a road is this project's most repeated
 *  defect, four times over; the grammar makes it structurally impossible and `frontages`
 *  measures it. */
export function doorFrontTile(s: CityStructure): { dx: number; dy: number } {
  return doorFrontOf(s)
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

/**
 * ★ A PLOT IS A CLAIMABLE THING, AND THIS IS THE LIST OF THE FREE ONES.
 *
 * Not "grass that happens to be beside a road" — the grammar's own unclaimed plots, each one a
 * frontage on a street with a known facing and a known maximum mass. The tile returned is the
 * plot's street corner, the tile a 1×1 building would take, so a viewer can point at it. The
 * spacing of whatever gets built here is already proven; nothing needs to check it again.
 */
export function cityFreePlots(t: CityTemplate): Array<{
  dx: number; dy: number; facing: 'sw' | 'se'; block: { i: number; j: number }; slot: string
}> {
  const taken = takenPlots(cityPlacements())
  return freePlots(TOWN_RINGS_GENESIS, CITY_GROUND)
    .filter((p) => !taken.has(plotKey(p)))
    .map((p) => ({
      ...(p.face === 'sw'
        ? { dx: p.dx + TOWN_ORIGIN, dy: p.anchorY - 1 + TOWN_ORIGIN }
        : { dx: p.anchorX - 1 + TOWN_ORIGIN, dy: p.dy + TOWN_ORIGIN }),
      facing: p.face, block: p.block, slot: p.slot,
    }))
    .filter((p) => inExtent(p.dx, p.dy))
}

/** The plots as bare tiles, the shape older callers ask for. */
export function growthPlots(t: CityTemplate): { dx: number; dy: number }[] {
  return cityFreePlots(t).map(({ dx, dy }) => ({ dx, dy }))
}

/** The blocks the town has platted, for a viewer that wants to draw them. */
export const cityBlocks = (): Array<{ i: number; j: number }> =>
  plattedBlocks(TOWN_RINGS_GENESIS, CITY_GROUND)

const ORTHO = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const

/** Every structure's door, and the road tile it opens onto. `onto` is null when the face the
 *  building says it presents is not a road at all — the frontage invariant is that this never
 *  happens, for any building on any plot the grammar can ever offer. */
export function frontages(t: CityTemplate): Array<{
  kind: string; door: { dx: number; dy: number }; onto: { dx: number; dy: number } | null
}> {
  const roads = new Set(t.tiles.filter(isRoadTile).map(x => key(x.dx, x.dy)))
  return t.structures.map(s => {
    const front = doorFrontTile(s)
    // The well and the fire pit have no door; they stand in the paving and are reached from
    // every side, so their frontage is any road tile that touches them.
    const onto = roads.has(key(front.dx, front.dy)) ? front
      : (s.w === 1 && s.h === 1
        ? ORTHO.map(([ox, oy]) => ({ dx: s.dx + ox, dy: s.dy + oy })).find(p => roads.has(key(p.dx, p.dy))) ?? null
        : null)
    return { kind: s.kind, door: doorTile(s), onto }
  })
}

/** A road tile with exactly one road neighbour that is not a door or a template edge — a path
 *  that leads nowhere. The invariant is that this list is empty. */
export function danglingRoadEnds(t: CityTemplate): { dx: number; dy: number }[] {
  const roads = new Set(t.tiles.filter(isRoadTile).map(x => key(x.dx, x.dy)))
  const doors = new Set(t.structures.map(s => { const d = doorTile(s); return key(d.dx, d.dy) }))
  const out: { dx: number; dy: number }[] = []
  for (const k of roads) {
    const [dx, dy] = k.split(',').map(Number) as [number, number]
    if (ORTHO.filter(([ox, oy]) => roads.has(key(dx + ox, dy + oy))).length !== 1) continue
    if (dx === 0 || dy === 0 || dx === CITY_W - 1 || dy === CITY_H - 1) continue  // a map edge
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
  /** `row 38` or `col 40` — the line of road every door on this rank opens onto */
  street: string
  dwellings: Array<{ kind: string; along: number; span: number }>
}

/** The houses of the town, grouped by the street their doors open onto and ordered along it.
 *  `along` is the near edge in the street's own direction and `span` the extent. The facing
 *  column decides which street a building is on — it is not inferred from the road set, so a
 *  building at a crossroads cannot be filed under the wrong one. */
export function dwellingRanks(t: CityTemplate): StreetRank[] {
  const byStreet = new Map<string, StreetRank['dwellings']>()
  for (const s of t.structures) {
    if (!isDwellingKind(s.kind)) continue
    const street = s.facing === 'sw' ? `row ${s.dy + s.h}` : `col ${s.dx + s.w}`
    const entry = s.facing === 'sw'
      ? { kind: s.kind, along: s.dx, span: s.w }
      : { kind: s.kind, along: s.dy, span: s.h }
    const g = byStreet.get(street)
    if (g === undefined) byStreet.set(street, [entry]); else g.push(entry)
  }
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
