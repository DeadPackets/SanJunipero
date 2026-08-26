import { CULL_MARGIN_PX, rectInView, type ViewRect } from './cull.js'
import type { FieldLayer } from './groundField.js'
import { TILE_H, TILE_W } from './iso.js'
import { ZOOM_STOPS } from './camera.js'

/**
 * One whole-map bake grows as the square of the ring count — 12 768 px at ten rings, past
 * `MAX_TEXTURE_SIZE`, so the allocation fails outright. Fixed chunks bound it to
 * CHUNK_PX_W × CHUNK_PX_H.
 *
 * Every texture samples NEAREST; a chunk boundary is a new place for a half pixel, so three
 * seam rules are load-bearing:
 *
 * 1. The boundary lands on a whole screen pixel at every `ZOOM_STOP`.
 * 2. A one-pixel bleed covers the fractional scales of a transit.
 * 3. A straddling shape is submitted WHOLE to both chunks and cut by the render target, never
 *    clipped by hand.
 */

/** Both dimensions are multiples of `1 / min(ZOOM_STOPS)` — see the seam law, property 1.
 *  2:1 matches the dimetric grid, so one chunk covers a square patch of the tile lattice. */
export const CHUNK_PX_W = 1024
export const CHUNK_PX_H = 512

/** The seam law's property 2. One pixel of a neighbour, carried so a fractional transit scale
 *  cannot open a crack. */
export const CHUNK_BLEED_PX = 1

/** RGBA8, which is what `RenderTexture.create` allocates. */
export const CHUNK_BYTES_PER_PX = 4

/** WebGL2 guarantees `MAX_TEXTURE_SIZE` is at least this. A bake that stays under it allocates
 *  on every conforming GPU; the whole-map bake is past it from about four rings. */
export const GPU_MIN_MAX_TEXTURE_PX = 2048

/** How many chunks outside the view stay baked. One ring of neighbours around a single-chunk
 *  view: crossing any one boundary and coming straight back never costs a rebake. */
export const CHUNK_RETAIN = 8

/** A shape is assigned to every chunk its paint can reach. Half a tile of slack over the
 *  diamond covers the road shoulders, the kerb stroke and the bleed; over-assigning costs one
 *  clipped polygon and under-assigning costs a hole, so the slack is deliberately generous. */
export const SHAPE_PAD_PX = TILE_W / 2

export type ChunkKey = string

export type ChunkRect = {
  key: ChunkKey
  c: number
  r: number
  /** the chunk's own rectangle in BAKE space (screen space shifted right by `offsetX`) */
  x: number
  y: number
  w: number
  h: number
  /** the texture it is baked into — its rect plus the bleed */
  texW: number
  texH: number
}

export type ChunkGrid = {
  cols: number
  rows: number
  fieldW: number
  fieldH: number
  /** `sx` runs negative down to `-h · TILE_W/2`; bake space is screen space shifted by this. */
  offsetX: number
}

export const chunkKey = (c: number, r: number): ChunkKey => `${c}:${r}`

export function groundGrid(fieldW: number, fieldH: number, offsetX: number): ChunkGrid {
  return {
    cols: Math.max(1, Math.ceil(fieldW / CHUNK_PX_W)),
    rows: Math.max(1, Math.ceil(fieldH / CHUNK_PX_H)),
    fieldW,
    fieldH,
    offsetX,
  }
}

/** The last column and row are cut to the field, not padded out: the field's own edge has no neighbour to seam against, and the remainder still satisfies the whole-pixel law. */
export function chunkAt(grid: ChunkGrid, c: number, r: number): ChunkRect {
  const x = c * CHUNK_PX_W,
    y = r * CHUNK_PX_H
  const w = Math.min(CHUNK_PX_W, grid.fieldW - x)
  const h = Math.min(CHUNK_PX_H, grid.fieldH - y)
  return {
    key: chunkKey(c, r),
    c,
    r,
    x,
    y,
    w,
    h,
    texW: w + CHUNK_BLEED_PX,
    texH: h + CHUNK_BLEED_PX,
  }
}

export function allChunks(grid: ChunkGrid): ChunkRect[] {
  const out: ChunkRect[] = []
  for (let r = 0; r < grid.rows; r++)
    for (let c = 0; c < grid.cols; c++) out.push(chunkAt(grid, c, r))
  return out
}

/** The chunks whose paint reaches the WORLD-space view, asked through the entity cull's own `rectInView` and margin — deciding by a different rule would show a hole at the stage edge. */
export function chunksInView(
  grid: ChunkGrid,
  view: ViewRect,
  margin: number = CULL_MARGIN_PX,
): ChunkRect[] {
  // The span is derived from the rectangle rather than swept over the grid, so the cost of
  // asking is the size of the VIEW and not the size of the town — the whole point of chunking.
  const bx0 = view.x - margin + grid.offsetX,
    bx1 = view.x + view.w + margin + grid.offsetX
  const c0 = Math.max(0, Math.min(grid.cols - 1, Math.floor(bx0 / CHUNK_PX_W)))
  const c1 = Math.max(0, Math.min(grid.cols - 1, Math.floor(bx1 / CHUNK_PX_W)))
  const r0 = Math.max(0, Math.min(grid.rows - 1, Math.floor((view.y - margin) / CHUNK_PX_H)))
  const r1 = Math.max(
    0,
    Math.min(grid.rows - 1, Math.floor((view.y + view.h + margin) / CHUNK_PX_H)),
  )
  const out: ChunkRect[] = []
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const k = chunkAt(grid, c, r)
      const sx0 = k.x - grid.offsetX,
        sy0 = k.y
      if (rectInView(sx0, sy0, sx0 + k.w, sy0 + k.h, view, margin)) out.push(k)
    }
  }
  return out
}

export const chunkTextureBytes = (k: ChunkRect): number => k.texW * k.texH * CHUNK_BYTES_PER_PX

/** What the landed whole-map baker allocates: one texture the size of the entire field. */
export const wholeMapTextureBytes = (fieldW: number, fieldH: number): number =>
  fieldW * fieldH * CHUNK_BYTES_PER_PX

/** The seam law, property 1, as a predicate over one scale. */
export const chunkBoundaryIsWhole = (scale: number): boolean =>
  Number.isInteger(CHUNK_PX_W * scale) && Number.isInteger(CHUNK_PX_H * scale)

/** Every rest stop, so adding a stop the chunk grid cannot land on turns the law red. */
export const chunkBoundariesAreWhole = (): boolean => ZOOM_STOPS.every(chunkBoundaryIsWhole)

// ── assigning the field's geometry to chunks ──────────────────────────────────────────────
// One O(shapes) pass on a terrain change, so every later chunk bake is O(the chunk).

const spanLo = (v: number, size: number, max: number): number =>
  Math.max(0, Math.min(max, Math.floor(v / size) - 1))
const spanHi = (v: number, size: number, max: number): number =>
  Math.max(0, Math.min(max, Math.floor(v / size)))

/** Does a bake-space rectangle reach this chunk's TEXTURE (its rect plus the bleed)? */
function reachesChunk(k: ChunkRect, x0: number, y0: number, x1: number, y1: number): boolean {
  return x1 >= k.x && x0 <= k.x + k.texW && y1 >= k.y && y0 <= k.y + k.texH
}

function chunkKeysForBox(
  grid: ChunkGrid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): ChunkRect[] {
  const out: ChunkRect[] = []
  const c0 = spanLo(x0, CHUNK_PX_W, grid.cols - 1),
    c1 = spanHi(x1, CHUNK_PX_W, grid.cols - 1)
  const r0 = spanLo(y0, CHUNK_PX_H, grid.rows - 1),
    r1 = spanHi(y1, CHUNK_PX_H, grid.rows - 1)
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const k = chunkAt(grid, c, r)
      if (reachesChunk(k, x0, y0, x1, y1)) out.push(k)
    }
  }
  return out
}

/** The painted box of one tile's mask shape, in bake space, with the slack. */
export function shapeBox(
  grid: ChunkGrid,
  sx: number,
  sy: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const bx = sx + grid.offsetX
  return {
    x0: bx - TILE_W / 2 - SHAPE_PAD_PX,
    x1: bx + TILE_W / 2 + SHAPE_PAD_PX,
    y0: sy - SHAPE_PAD_PX,
    y1: sy + TILE_H + SHAPE_PAD_PX,
  }
}

/** Every chunk gets every layer at its ORIGINAL index, empty or not: `materialMatrix` and `octaveMatrix` take the layer's POSITION, so a renumbered stack samples the same ground through a different rotation than its neighbour. */
export function bucketLayers(
  grid: ChunkGrid,
  layers: readonly FieldLayer[],
): Map<ChunkKey, FieldLayer[]> {
  const out = new Map<ChunkKey, FieldLayer[]>()
  const stackFor = (key: ChunkKey): FieldLayer[] => {
    let stack = out.get(key)
    if (stack === undefined) {
      stack = layers.map((l) => ({ ...l, shapes: [] }))
      out.set(key, stack)
    }
    return stack
  }
  for (const [li, layer] of layers.entries()) {
    for (const s of layer.shapes) {
      const b = shapeBox(grid, s.sx, s.sy)
      for (const k of chunkKeysForBox(grid, b.x0, b.y0, b.x1, b.y1)) {
        stackFor(k.key)[li]!.shapes.push(s)
      }
    }
  }
  return out
}

/** A stroke is 1 px wide and centred on its path; two pixels of slack covers it either side. */
export const POLY_PAD_PX = 2

/** The kerb, headland and furrow polylines, cut the same way: assigned WHOLE to every chunk their bounding box reaches, never split, so a crossing outline stays one continuous stroke. */
export function bucketPolys(
  grid: ChunkGrid,
  polys: readonly number[][],
): Map<ChunkKey, number[][]> {
  const out = new Map<ChunkKey, number[][]>()
  for (const poly of polys) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity
    for (let i = 0; i < poly.length; i += 2) {
      const x = poly[i]! + grid.offsetX,
        y = poly[i + 1]!
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    if (x0 === Infinity) continue
    for (const k of chunkKeysForBox(
      grid,
      x0 - POLY_PAD_PX,
      y0 - POLY_PAD_PX,
      x1 + POLY_PAD_PX,
      y1 + POLY_PAD_PX,
    )) {
      const list = out.get(k.key)
      if (list === undefined) out.set(k.key, [poly])
      else list.push(poly)
    }
  }
  return out
}

// ── residency ─────────────────────────────────────────────────────────────────────────────

export type ResidencyStep = {
  /** chunks to bake now — they are on screen and no texture exists for them */
  bake: ChunkRect[]
  /** chunks whose textures must be destroyed now */
  evict: ChunkKey[]
}

export type ChunkResidency = {
  /** A new terrain is a new grid: everything resident belongs to the old one. */
  setGrid(grid: ChunkGrid | null): ChunkKey[]
  update(view: ViewRect, margin?: number): ResidencyStep
  resident(): ChunkKey[]
  bytes(): number
  clear(): ChunkKey[]
}

/** Everything on screen is resident always, with a fixed ring of recently-used neighbours behind it: a byte budget would bite exactly where evicting is wrong, thrashing a viewport's own chunks. */
export function createChunkResidency(retain: number = CHUNK_RETAIN): ChunkResidency {
  let grid: ChunkGrid | null = null
  const live = new Map<ChunkKey, ChunkRect>()
  /** least-recently-used first */
  let lru: ChunkKey[] = []

  const dropAll = (): ChunkKey[] => {
    const gone = [...live.keys()]
    live.clear()
    lru = []
    return gone
  }

  return {
    setGrid(next) {
      const gone = dropAll()
      grid = next
      return gone
    },
    update(view, margin = CULL_MARGIN_PX) {
      if (grid === null) return { bake: [], evict: [] }
      const visible = chunksInView(grid, view, margin)
      const seen = new Set(visible.map((k) => k.key))
      const bake: ChunkRect[] = []
      for (const k of visible) {
        if (!live.has(k.key)) {
          live.set(k.key, k)
          bake.push(k)
        }
      }
      lru = [...lru.filter((k) => !seen.has(k)), ...visible.map((k) => k.key)]
      const evict: ChunkKey[] = []
      let spare = lru.length - visible.length
      for (const k of [...lru]) {
        if (spare <= retain) break
        if (seen.has(k)) continue
        live.delete(k)
        lru = lru.filter((x) => x !== k)
        evict.push(k)
        spare--
      }
      return { bake, evict }
    },
    resident: () => [...live.keys()],
    bytes: () => [...live.values()].reduce((n, k) => n + chunkTextureBytes(k), 0),
    clear: dropAll,
  }
}
