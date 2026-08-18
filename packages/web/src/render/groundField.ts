import {
  TERRAIN_TILE_KINDS, materialKind, roadAutotile, roadAutotileKind,
  type AssetRecord, type RoadAutotileKey, type TerrainTileKind,
} from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import { TILE_H, TILE_W, tileToScreen } from './iso.js'
import { TILE_COLORS } from './ground.js'
import { ROAD_TILE_ID, TILE_KIND, roadNeighborsAt, tileKind } from './tileset.js'

// First id wins: C11's path/sapling/channel (8/9/10) alias onto earth/forest/water, and a
// later duplicate would hand the kind its alias's palette colour instead of its own.
const ID_OF_KIND = new Map<TerrainTileKind, TileId>()
for (const [id, k] of Object.entries(TILE_KIND) as Array<[string, TerrainTileKind]>) {
  if (!ID_OF_KIND.has(k)) ID_OF_KIND.set(k, Number(id) as TileId)
}

// TERRAIN V2 — user directive 2026-08-17: "why are they not high fidelity textures? You
// should have just generated a square and placed it on the grid. It also looks unsettling to
// have a checkerboard texture on the city, I want a natural normal distribution."
//
// The old ground stamped one 32x16 diamond PER TILE and picked between four variants with a
// per-tile hash. Both halves of that are the complaint: a 32x16 stamp cannot carry fidelity,
// and a per-tile choice puts a visible pattern at exactly tile frequency — the checkerboard.
//
// The ground is now a CONTINUOUS FIELD. One high-resolution seamless material per terrain is
// laid across the whole map in WORLD SPACE, and each tile is a window onto it: the material
// flows across tile boundaries, so there is no stamp to see and nothing varies at tile
// frequency. A tile contributes only its SHAPE, to the mask that decides where its terrain
// shows. Roads keep their autotile silhouettes — as mask shapes now, not as baked art.

export const MATERIAL_REPEAT_PX = 256   // must match the forge's MATERIAL_PX

/** Where a point in bake space lands inside the repeating material. World space, not tile space. */
export function materialUv(sx: number, sy: number, repeat: number = MATERIAL_REPEAT_PX): { u: number; v: number } {
  const wrap = (n: number): number => ((n % repeat) + repeat) % repeat
  return { u: wrap(sx), v: wrap(sy) }
}

// What the GROUND cares about in the codex. `assetsSeq` counts every asset that has ever
// arrived, so with the library ingested (50 items = 100 records) a bed sprite landing was
// re-baking the whole map. Only terrain records can change the ground, and records are
// append-only, so counting them is a complete signature and costs one pass.
export function groundArtSignature(records: AssetRecord[]): number {
  let n = 0
  for (const r of records) if (r.class === 'terrain' && r.status === 'ready') n++
  return n
}

export function resolveMaterial(records: AssetRecord[], kind: string): string | null {
  let best: AssetRecord | null = null
  for (const r of records) {
    if (r.status !== 'ready' || r.class !== 'terrain' || r.kind !== materialKind(kind)) continue
    if (best === null || r.seq > best.seq) best = r
  }
  return best === null ? null : `/assets/${best.id}.png`
}

/** One tile's contribution to a mask: the diamond it covers, or a road silhouette. */
export type MaskShape = { sx: number; sy: number; roadKey: RoadAutotileKey | null }

export type FieldLayer = {
  /** identity — two layers can share a `kind` and draw from different materials */
  id: string
  kind: TerrainTileKind
  /** the continuous material to lay under this layer's mask; null → flat fallback colour */
  url: string | null
  fallback: number
  shapes: MaskShape[]
}

export type GroundField = {
  layers: FieldLayer[]
  /** the ground that fills a road tile's diamond around its ribbon */
  under: TerrainTileKind
  widthPx: number
  heightPx: number
  offsetX: number
}

export const ROAD_UNDER: TerrainTileKind = 'grass'

// TERRAIN V2.1: the plaza cobble is right at plaza scale and reads as a noisy stone-string on
// a 16px ribbon. So a road tile draws from one of two materials, and the rule for which is the
// simplest one that actually separates a wide area from a one-tile-wide run: a tile is MASS if
// it belongs to any fully-road 2x2 block. Every tile of a plaza does, including its edges and
// corners; no tile of a 1-wide run ever does, not even where two runs cross, because each 2x2
// there still contains a diagonal of grass.
export const CALM_ROAD_KIND = 'road-calm'

export function isRoadMass(terrain: TileId[][], x: number, y: number): boolean {
  const isRoad = (px: number, py: number): boolean => terrain[py]?.[px] === ROAD_TILE_ID
  for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as const) {
    if (isRoad(x + ox, y + oy) && isRoad(x + ox + 1, y + oy)
      && isRoad(x + ox, y + oy + 1) && isRoad(x + ox + 1, y + oy + 1)) return true
  }
  return false
}

// Layer order is TERRAIN_TILE_KINDS order with road last, so a road ribbon is drawn over the
// ground it runs through rather than punched out of it.
const LAYER_ORDER: TerrainTileKind[] =
  [...TERRAIN_TILE_KINDS.filter((k) => k !== 'road'), 'road']

export function groundField(terrain: TileId[][], records: AssetRecord[]): GroundField {
  const h = terrain.length
  const w = terrain[0]?.length ?? 0
  const shapes = new Map<TerrainTileKind, MaskShape[]>()
  const mass: MaskShape[] = []      // plaza-scale road, the cobble material
  const ribbon: MaskShape[] = []    // one-tile-wide runs, the calm material
  const push = (kind: TerrainTileKind, s: MaskShape): void => {
    const list = shapes.get(kind)
    if (list === undefined) shapes.set(kind, [s])
    else list.push(s)
  }

  for (let y = 0; y < h; y++) {
    const row = terrain[y]!
    for (let x = 0; x < row.length; x++) {
      const id = row[x]!
      const { sx, sy } = tileToScreen(x, y)
      const kind = tileKind(id)
      if (id === ROAD_TILE_ID) {
        // the diamond under the ribbon belongs to the ground the road runs through, and the
        // ribbon itself is a shaped mask over one of the two road materials
        push(ROAD_UNDER, { sx, sy, roadKey: null })
        const key = roadAutotile(roadNeighborsAt(terrain, x, y))
        ;(isRoadMass(terrain, x, y) ? mass : ribbon).push({ sx, sy, roadKey: key })
        continue
      }
      push(kind, { sx, sy, roadKey: null })
    }
  }

  const layers: FieldLayer[] = []
  for (const kind of LAYER_ORDER) {
    if (kind === 'road') continue
    const list = shapes.get(kind)
    if (list === undefined || list.length === 0) continue
    layers.push({
      id: kind, kind, shapes: list,
      url: resolveMaterial(records, kind),
      fallback: TILE_COLORS[ID_OF_KIND.get(kind) ?? 0],
    })
  }
  // road last, over the ground it runs through; calm ribbons and cobbled mass are disjoint
  // sets of tiles, so their order relative to each other never matters
  const roadFallback = TILE_COLORS[ROAD_TILE_ID]
  if (ribbon.length > 0) {
    layers.push({
      id: CALM_ROAD_KIND, kind: 'road', shapes: ribbon, fallback: roadFallback,
      // a town with no calm material yet falls back to the cobble one, then to flat colour
      url: resolveMaterial(records, CALM_ROAD_KIND) ?? resolveMaterial(records, 'road'),
    })
  }
  if (mass.length > 0) {
    layers.push({
      id: 'road', kind: 'road', shapes: mass, fallback: roadFallback,
      url: resolveMaterial(records, 'road'),
    })
  }

  return {
    layers, under: ROAD_UNDER,
    widthPx: (w + h) * (TILE_W / 2),
    heightPx: (w + h) * (TILE_H / 2),
    offsetX: h * (TILE_W / 2),
  }
}

/** The road strip cell a key occupies, for cutting a silhouette out of the shipped strip. */
export function roadStripFrame(key: RoadAutotileKey, keys: readonly RoadAutotileKey[]): {
  x: number; y: number; w: number; h: number
} {
  return { x: keys.indexOf(key) * TILE_W, y: 0, w: TILE_W, h: TILE_H }
}

// ── road silhouettes as SHAPES over the continuous material ─────────────────────────────
// C13's strip painted each junction as finished art. In a continuous field the road surface
// comes from the material like every other ground, and a key contributes only its outline:
// a stub at the tile centre plus one arm per direction the road actually continues in. The
// arms are read from the key NAME, the same rule roadTiles.ts paints from — the isolated
// tile and the south stub share `cap-s`, and only the name tells them apart.

export const ARM_HALF_W = 5 / 32          // half-width of an arm, in tile-space units
export const ARM_DIRS = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] } as const
export type ArmDir = keyof typeof ARM_DIRS

export function roadArms(key: RoadAutotileKey): Record<ArmDir, boolean> {
  const has = (d: ArmDir): boolean => {
    if (key === 'cross') return true
    if (key.startsWith('straight-')) return key.slice(9).includes(d)
    if (key.startsWith('corner-')) return key.slice(7).includes(d)
    if (key.startsWith('t-no-')) return key.slice(5) !== d
    return key.slice(4) === d              // cap-<d>
  }
  return { n: has('n'), e: has('e'), s: has('s'), w: has('w') }
}

/** tile-space (dx,dy) offset from the tile CENTRE → screen offset from the tile's top vertex */
const toScreen = (dx: number, dy: number): [number, number] =>
  [(dx - dy) * (TILE_W / 2), (dx + dy) * (TILE_H / 2) + TILE_H / 2]

// A road needs a rim where it meets grass, and NOWHERE ELSE. Growing the whole silhouette
// about the tile centre put a dark wedge at every tile's side corners — perpendicular to the
// run, once per tile — which is precisely what read as "disconnected cobble islands with
// grass gaps". Measuring the spine of a 20-tile run proved the surface was continuous all
// along; the banding was the shoulder, not the road.
//
// So the rim is drawn only on the sides that face a MISSING arm: each present arm's two side
// edges are shared with an adjacent quadrant, and only the ones whose neighbour is absent get
// a wedge. On a straight run that is the two long sides and nothing at the joins.
export const SHOULDER_T = 0.26            // how far into the arm the rim reaches
export const ROAD_SHOULDER = 0xb89d7e     // v1's own ROAD_EDGE, a MASTER_PALETTE member

// each arm's two corner vertices, and the neighbouring direction that shares that edge
const ARM_SIDES: Record<ArmDir, ReadonlyArray<{ v: readonly [number, number]; shared: ArmDir }>> = {
  n: [{ v: [-0.5, -0.5], shared: 'w' }, { v: [0.5, -0.5], shared: 'e' }],
  e: [{ v: [0.5, -0.5], shared: 'n' }, { v: [0.5, 0.5], shared: 's' }],
  s: [{ v: [0.5, 0.5], shared: 'e' }, { v: [-0.5, 0.5], shared: 'w' }],
  w: [{ v: [-0.5, 0.5], shared: 's' }, { v: [-0.5, -0.5], shared: 'n' }],
}

export function roadShoulderPolys(key: RoadAutotileKey): number[][] {
  const arms = roadArms(key)
  const out: number[][] = []
  const lerp = (a: readonly [number, number], b: readonly [number, number], t: number): [number, number] =>
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  for (const dir of Object.keys(ARM_DIRS) as ArmDir[]) {
    if (!arms[dir]) continue
    const sides = ARM_SIDES[dir]
    for (let i = 0; i < sides.length; i++) {
      const side = sides[i]!
      if (arms[side.shared]) continue          // an interior join keeps no rim
      const other = sides[1 - i]!.v            // the arm's third vertex, to taper inward
      const a: readonly [number, number] = [0, 0]
      const quad = [a, side.v, lerp(side.v, other, SHOULDER_T), lerp(a, other, SHOULDER_T)]
      out.push(quad.flatMap(([dx, dy]) => toScreen(dx, dy)))
    }
  }
  return out
}

/**
 * Polygons covering one road cell, in screen coords relative to the tile's TOP VERTEX.
 *
 * This reproduces what roadTiles.ts PAINTS, which is not a narrow band: the painter fills the
 * whole diamond and then removes the outer wedge of every quadrant the key has no arm for. So
 * a present arm owns its entire QUADRANT — half the tile for a straight run — and only the
 * central core survives in the directions the road does not continue. A narrow-band version
 * of this made roads read as faint dotted ribbons at 1x.
 */
export function roadRibbonPolys(key: RoadAutotileKey): number[][] {
  const c = ARM_HALF_W
  // the core stub, always kept, so an isolated tile is still a piece of road
  const polys: number[][] = [
    [...toScreen(-c, -c), ...toScreen(c, -c), ...toScreen(c, c), ...toScreen(-c, c)],
  ]
  // each arm is the quadrant it points into: |v| >= |u| for n/s, |u| >= |v| for e/w
  const QUADRANT: Record<ArmDir, ReadonlyArray<readonly [number, number]>> = {
    n: [[0, 0], [-0.5, -0.5], [0.5, -0.5]],
    e: [[0, 0], [0.5, -0.5], [0.5, 0.5]],
    s: [[0, 0], [0.5, 0.5], [-0.5, 0.5]],
    w: [[0, 0], [-0.5, 0.5], [-0.5, -0.5]],
  }
  const arms = roadArms(key)
  for (const dir of Object.keys(ARM_DIRS) as ArmDir[]) {
    if (!arms[dir]) continue
    polys.push(QUADRANT[dir].flatMap(([dx, dy]) => toScreen(dx, dy)))
  }
  return polys
}

export { roadAutotileKind }
