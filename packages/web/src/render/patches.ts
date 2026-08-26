import { TILE_H, TILE_W, tileToScreen } from './iso.js'
import { ROAD_SHOULDER_DARK } from './groundField.js'

// Outlines and furrows are drawn into the ground bake, so they cost nothing per frame.

export type Tile = { x: number; y: number }

/** The kerb around paved ground. #ABA198, the stone of the master palette. */
export const KERB_COLOR = 0xaba198
/** A field's headland. Deliberately the road shoulder's dark, so a field edge and a road edge
 *  are the same language rather than two unrelated inventions. */
export const HEADLAND_COLOR = ROAD_SHOULDER_DARK

/** Furrows are spaced in whole tiles, so they read as ploughing rather than as a texture. */
export const FURROW_SPACING_TILES = 1

const keyOf = (x: number, y: number): string => `${x},${y}`

// A tile's diamond, clockwise on screen from its top vertex. Each edge is shared with exactly
// one orthogonal neighbour, so an edge whose neighbour is missing is a boundary edge.
type Pt = readonly [number, number]

function corners(x: number, y: number): { top: Pt; right: Pt; bottom: Pt; left: Pt } {
  const { sx, sy } = tileToScreen(x, y)
  return {
    top: [sx, sy],
    right: [sx + TILE_W / 2, sy + TILE_H / 2],
    bottom: [sx, sy + TILE_H],
    left: [sx - TILE_W / 2, sy + TILE_H / 2],
  }
}

// Clockwise, so every emitted edge keeps the patch on the same side. Chaining then closes into
// loops without a winding test.
const EDGES = [
  { dx: 0, dy: -1, from: 'top', to: 'right' },      // NE
  { dx: 1, dy: 0, from: 'right', to: 'bottom' },    // SE
  { dx: 0, dy: 1, from: 'bottom', to: 'left' },     // SW
  { dx: -1, dy: 0, from: 'left', to: 'top' },       // NW
] as const

/** The outline of a set of tiles, as closed screen-space polylines with interior edges cut. */
export function patchOutline(tiles: ReadonlyArray<Tile>): number[][] {
  const set = new Set(tiles.map((t) => keyOf(t.x, t.y)))
  // sorted, so the output does not depend on the order the caller collected tiles in
  const sorted = [...tiles].sort((a, b) => a.y - b.y || a.x - b.x)

  type Seg = { from: Pt; to: Pt; tile: string; used: boolean }
  const segs: Seg[] = []
  for (const t of sorted) {
    const c = corners(t.x, t.y)
    for (const e of EDGES) {
      if (set.has(keyOf(t.x + e.dx, t.y + e.dy))) continue
      segs.push({ from: c[e.from], to: c[e.to], tile: keyOf(t.x, t.y), used: false })
    }
  }

  const out = new Map<string, number[]>()
  segs.forEach((s, i) => {
    const k = keyOf(s.from[0], s.from[1])
    const list = out.get(k)
    if (list === undefined) out.set(k, [i])
    else list.push(i)
  })

  const loops: number[][] = []
  for (const start of segs) {
    if (start.used) continue
    const poly: number[] = []
    let cur: Seg | undefined = start
    while (cur !== undefined && !cur.used) {
      cur.used = true
      poly.push(cur.from[0], cur.from[1])
      const here: Seg = cur
      const candidates: Seg[] = (out.get(keyOf(here.to[0], here.to[1])) ?? [])
        .map((i) => segs[i]!).filter((s) => !s.used)
      // at a pinch vertex, stay on the tile we arrived on so two patches never fuse
      cur = candidates.find((s) => s.tile === here.tile) ?? candidates[0]
    }
    if (poly.length > 0) loops.push(poly)
  }
  return loops
}

/** Parallel lines along a patch's longer axis, spaced one tile apart across its shorter one. */
export function furrowLines(tiles: ReadonlyArray<Tile>): number[][] {
  if (tiles.length === 0) return []
  const xs = tiles.map((t) => t.x), ys = tiles.map((t) => t.y)
  const w = Math.max(...xs) - Math.min(...xs) + 1
  const h = Math.max(...ys) - Math.min(...ys) + 1
  const alongX = w >= h

  // group by the row (or column) the furrow runs down
  const rows = new Map<number, Tile[]>()
  for (const t of tiles) {
    const k = alongX ? t.y : t.x
    const list = rows.get(k)
    if (list === undefined) rows.set(k, [t])
    else list.push(t)
  }

  const centre = (t: Tile): [number, number] => {
    const { sx, sy } = tileToScreen(t.x, t.y)
    return [sx, sy + TILE_H / 2]
  }

  const out: number[][] = []
  for (const k of [...rows.keys()].sort((a, b) => a - b)) {
    if (k % FURROW_SPACING_TILES !== 0) continue
    const line = rows.get(k)!
    const lo = line.reduce((m, t) => (alongX ? t.x < m.x : t.y < m.y) ? t : m, line[0]!)
    const hi = line.reduce((m, t) => (alongX ? t.x > m.x : t.y > m.y) ? t : m, line[0]!)
    out.push([...centre(lo), ...centre(hi)])
  }
  return out
}
