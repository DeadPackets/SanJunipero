import {
  TERRAIN_TILE_KINDS, materialKind, roadAutotile, roadAutotileKind,
  type AssetRecord, type RoadAutotileKey, type TerrainTileKind,
} from '@sj/shared'
import { Matrix } from 'pixi.js'
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

// ── U6: two periods that never line up ──────────────────────────────────────────────────────
//
// Terrain v2 removed TILE-frequency pattern and introduced MATERIAL-frequency pattern in its
// place: every ground shape was filled with `{ texture, matrix: new Matrix() }`, an identity
// matrix, so one 256px material tiled on an axis-aligned 256px lattice across the whole map.
// The eye finds a 256px grid as easily as a 32px one.
//
// Two fixes, both to WHERE the material is sampled — the geometry never moves, so nothing in
// the world shifts. First, each ground layer gets its own small rotation and offset, derived
// from its id so two runs agree. Second, each layer is filled a second time with the same
// material at an incommensurate scale and low alpha: two periods whose least common multiple
// exceeds the map cannot produce a visible lattice.

/** Bounded and auditable: a layer's rotation is drawn from this set by index, never rolled. */
export const MATERIAL_ROTATIONS_DEG: readonly number[] = [0, 7.5, -5, 12]

/** 2.37 is irrational-enough that the second period never re-aligns with the first. */
export const OCTAVE_SCALE = 2.37
export const OCTAVE_ALPHA = 0.22

/** Autocorrelation of a rendered strip at the material period. 1 = a perfect lattice. */
export const LATTICE_PEAK_MAX = 0.35

// FNV-1a, so a layer id maps to a stable offset without pulling in a hash dependency.
function idHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return h >>> 0
}

/** The fill transform for a ground layer: a bounded rotation plus an id-derived offset,
 *  applied to WHERE the material is sampled and never to the geometry. */
export function materialMatrix(layerId: string, index: number): Matrix {
  const deg = MATERIAL_ROTATIONS_DEG[index % MATERIAL_ROTATIONS_DEG.length]!
  const h = idHash(layerId)
  const m = new Matrix()
  m.rotate((deg * Math.PI) / 180)
  m.translate(h % MATERIAL_REPEAT_PX, (h >>> 11) % MATERIAL_REPEAT_PX)
  return m
}

/** The coarse second pass: the same material, scaled so its period never lines up with the
 *  first, and offset by half a repeat so the two do not share an origin either. */
export function octaveMatrix(layerId: string, index: number): Matrix {
  const m = materialMatrix(layerId, index)
  m.scale(OCTAVE_SCALE, OCTAVE_SCALE)
  m.translate(MATERIAL_REPEAT_PX / 2, MATERIAL_REPEAT_PX / 3)
  return m
}

/** One pixel of the octave pass over one pixel of the base. A convex blend, so the result can
 *  never leave the material's own tone range. */
export function octaveComposite(base: number, octave: number): number {
  return base * (1 - OCTAVE_ALPHA) + octave * OCTAVE_ALPHA
}

/** Normalised autocorrelation of an RGBA buffer at `period` px along x. 1.0 is an exact
 *  repeat; white noise is ~0. Calibrate it before trusting it — the tests do. */
export function latticePeak(
  pixels: Uint8ClampedArray | Uint8Array, w: number, h: number, period: number,
): number {
  if (period <= 0 || period >= w) return 0
  const lum = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) {
    lum[i] = luma((pixels[i * 4]! << 16) | (pixels[i * 4 + 1]! << 8) | pixels[i * 4 + 2]!)
  }
  let n = 0, sa = 0, sb = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x + period < w; x++) { sa += lum[y * w + x]!; sb += lum[y * w + x + period]!; n++ }
  }
  if (n === 0) return 0
  const ma = sa / n, mb = sb / n
  let cov = 0, va = 0, vb = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x + period < w; x++) {
      const a = lum[y * w + x]! - ma, b = lum[y * w + x + period]! - mb
      cov += a * b; va += a * a; vb += b * b
    }
  }
  const d = Math.sqrt(va * vb)
  return d === 0 ? 0 : Math.max(0, cov / d)
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

// ── U5: a road you can see from the widest view ─────────────────────────────────────────────
//
// MEASURED from the shipped 256px materials: grass reads 0.4186 mean relative luminance and
// road reads 0.5066 — a delta of 0.088, so at scale 1 a one-tile ribbon is 32x16 px of a
// near-flat average that lands within a few luma points of the grass beside it. The single
// shoulder colour above is WORSE: 0xB89D7E is 0.3581, only 0.060 from the grass. That is the
// whole mechanism of "roads read ghost-faint at 1x".
//
// The fix is an EDGE, not a repaint — the art is generated and P11 forbids tinting it. The rim
// wedge is split across its depth into two palette tones, so the ribbon carries a hard edge at
// any zoom: dark where the shoulder meets the road, light where it meets the ground.

/** WCAG-style relative luminance of a packed 0xRRGGBB colour, 0..1. */
export function luma(rgb: number): number {
  const ch = (shift: number): number => {
    const s = ((rgb >> shift) & 0xff) / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0)
}

/** The floor a road's edge must clear against the ground it runs through. Measured, not
 *  guessed: the shipped road/grass pair sits at 0.088 and fails it, which is the complaint. */
export const ROAD_GROUND_LUMA_DELTA_MIN = 0.14

/** Both MASTER_PALETTE members: #9C6B47 and #E8D5BC. */
export const ROAD_SHOULDER_DARK = 0x9c6b47
export const ROAD_SHOULDER_LIGHT = 0xe8d5bc

/** How much of the rim's depth the dark half takes, measured from the road side. */
export const SHOULDER_SPLIT = 0.55

export function roadReadsAt(roadTone: number, groundTone: number): boolean {
  return Math.abs(roadTone - groundTone) >= ROAD_GROUND_LUMA_DELTA_MIN
}

export type ImageLike = { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

const toneCache = new Map<string, number>()

/** Mean relative luminance of a material, cached per url — the number a delta is measured
 *  against. Pure for a given url: the first sample wins, as a material never changes. */
export function materialTone(url: string, sample: ImageLike): number {
  const hit = toneCache.get(url)
  if (hit !== undefined) return hit
  const d = sample.data
  const stride = d.length / (sample.width * sample.height)
  let sum = 0, n = 0
  for (let i = 0; i + 2 < d.length; i += stride) {
    sum += luma((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!)
    n++
  }
  const tone = n === 0 ? 0 : sum / n
  toneCache.set(url, tone)
  return tone
}

// each arm's two corner vertices, and the neighbouring direction that shares that edge
const ARM_SIDES: Record<ArmDir, ReadonlyArray<{ v: readonly [number, number]; shared: ArmDir }>> = {
  n: [{ v: [-0.5, -0.5], shared: 'w' }, { v: [0.5, -0.5], shared: 'e' }],
  e: [{ v: [0.5, -0.5], shared: 'n' }, { v: [0.5, 0.5], shared: 's' }],
  s: [{ v: [0.5, 0.5], shared: 'e' }, { v: [-0.5, 0.5], shared: 'w' }],
  w: [{ v: [-0.5, 0.5], shared: 's' }, { v: [-0.5, -0.5], shared: 'n' }],
}

const lerp2 = (a: readonly [number, number], b: readonly [number, number], t: number): [number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** Every exposed rim wedge, as [outer edge a, corner, tapered corner, tapered a]. The two
 *  colour bands are cut out of these, so the SHOULDER_T rule has exactly one definition. */
function shoulderWedges(key: RoadAutotileKey): Array<{
  a: readonly [number, number]; v: readonly [number, number]; other: readonly [number, number]
}> {
  const arms = roadArms(key)
  const out: Array<{ a: readonly [number, number]; v: readonly [number, number]; other: readonly [number, number] }> = []
  for (const dir of Object.keys(ARM_DIRS) as ArmDir[]) {
    if (!arms[dir]) continue
    const sides = ARM_SIDES[dir]
    for (let i = 0; i < sides.length; i++) {
      const side = sides[i]!
      if (arms[side.shared]) continue          // an interior join keeps no rim
      out.push({ a: [0, 0], v: side.v, other: sides[1 - i]!.v })
    }
  }
  return out
}

export function roadShoulderPolys(key: RoadAutotileKey): number[][] {
  return shoulderWedges(key).map(({ a, v, other }) =>
    [a, v, lerp2(v, other, SHOULDER_T), lerp2(a, other, SHOULDER_T)]
      .flatMap(([dx, dy]) => toScreen(dx, dy)))
}

/**
 * The same rim, in two tones across its depth. `light` is the outer strip, against the ground;
 * `dark` is the inner strip, against the road. Both are subdivisions of the wedge above, so
 * they inherit its "only on edges facing a missing arm" rule and stay inside their own tile.
 */
export function roadShoulderBands(key: RoadAutotileKey): { dark: number[][]; light: number[][] } {
  const split = SHOULDER_T * (1 - SHOULDER_SPLIT)
  const dark: number[][] = [], light: number[][] = []
  for (const { a, v, other } of shoulderWedges(key)) {
    const aSplit = lerp2(a, other, split), vSplit = lerp2(v, other, split)
    light.push([a, v, vSplit, aSplit].flatMap(([dx, dy]) => toScreen(dx, dy)))
    dark.push([aSplit, vSplit, lerp2(v, other, SHOULDER_T), lerp2(a, other, SHOULDER_T)]
      .flatMap(([dx, dy]) => toScreen(dx, dy)))
  }
  return { dark, light }
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

export { roadAutotileKind } from '@sj/shared'
