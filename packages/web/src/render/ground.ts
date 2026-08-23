import type { AssetRecord, TerrainTileManifest } from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import { TILE_H, TILE_W, tileToScreen } from './iso.js'
import { roadAutotile } from '@sj/shared'
import { ROAD_TILE_ID, resolveTerrainTile, roadNeighborsAt } from './tileset.js'

// ★ THE PAINTED GROUND, AS A PREDICATE — AND WHY IT IS NOT THE CULL'S AABB.
//
// A row of flat untextured rectangles was standing on the void past the bottom-right edge of
// the stage. They are the ambient layer's tree canopies, and the reason nothing caught them is
// that no test ever asked whether a thing the renderer draws is ON THE GROUND.
//
// The obvious place to ask is `cull.ts`, which already computes an exact drawn AABB. It is the
// wrong instrument, and that is measured rather than asserted: of the 140 decoration quads the
// genesis world places, **38 leave the painted ground and 0 leave the field's AABB**. The AABB
// is the bounding box of a DIAMOND, so its four corners are void by construction and a test
// against it passes with the property broken — the same shape as every other guard this
// project has had to kill. The cull's question is "does this reach the VIEW", which is a
// different question that happens to share a rectangle.
//
// So the law is asked of the field's own geometry, read back rather than re-invented:
// `tilesetPlan` lays one diamond per tile over the whole w×h lattice, and `tileToScreen`
// returns a tile's TOP vertex — so tile (x, y) covers the unit square [x, x+1] × [y, y+1] in
// continuous tile space, and the painted field is exactly [0, w] × [0, h].

/** The continuous inverse of `tileToScreen`. `screenToTile` rounds to a tile; this does not,
 *  because a quad's corner lands between tiles and the rounding is what hides an overhang. */
export function screenToTileF(sx: number, sy: number): { fx: number; fy: number } {
  const a = sx / (TILE_W / 2), b = sy / (TILE_H / 2)
  return { fx: (a + b) / 2, fy: (b - a) / 2 }
}

export type ScreenRect = { x0: number; y0: number; x1: number; y1: number }

/** How far a screen rectangle reaches past the painted ground, in TILES. `<= 0` is inside;
 *  `0` means it touches the edge exactly. Every corner is tested, because a diamond's edge is
 *  diagonal and the corner that leaves first is not the one nearest the map's centre. */
export function groundOverhangTiles(
  terrain: { length: number; [i: number]: { length: number } }, r: ScreenRect,
): number {
  const h = terrain.length, w = h === 0 ? 0 : terrain[0]!.length
  let worst = -Infinity
  for (const [px, py] of [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]] as const) {
    const { fx, fy } = screenToTileF(px, py)
    worst = Math.max(worst, -fx, fx - w, -fy, fy - h)
  }
  return worst
}

/** Nothing the renderer draws may leave the terrain extent. */
export const rectOnGround = (
  terrain: { length: number; [i: number]: { length: number } }, r: ScreenRect,
): boolean => groundOverhangTiles(terrain, r) <= 0

// master-palette hexes — the placeholder terrain IS palette-true
export const TILE_COLORS: Record<TileId, number> = {
  0: 0x93b573 /* grass */,
  1: 0xc68a48 /* dirt */,
  2: 0x7fb0c9 /* water */,
  3: 0x4f7040 /* forest */,
  4: 0xaba198 /* rock */,
  5: 0xe8d5bc /* sand */,
  6: 0xa66e38 /* farmland */,
  7: 0xb8ad9e /* road — placeholder; C10 owns the texture */,
  8: 0xa9946b /* path — dirt the feet made */,
  9: 0x6f9152 /* sapling */,
  10: 0x8fbfd6 /* channel */,
}

// shade tiles draw one ramp step darker for subtle checker texture
export const SHADE_MULT = 0.85

export function shadeColor(color: number): number {
  const r = Math.round(((color >> 16) & 0xff) * SHADE_MULT)
  const g = Math.round(((color >> 8) & 0xff) * SHADE_MULT)
  const b = Math.round((color & 0xff) * SHADE_MULT)
  return (r << 16) | (g << 8) | b
}

export type GroundCell = { sx: number; sy: number; color: number; shade: boolean }

export function groundPlan(terrain: TileId[][]): GroundCell[] {
  const cells: GroundCell[] = []
  for (let y = 0; y < terrain.length; y++) {
    const row = terrain[y]!
    for (let x = 0; x < row.length; x++) {
      const { sx, sy } = tileToScreen(x, y)
      cells.push({ sx, sy, color: TILE_COLORS[row[x]!], shade: (x + y) % 2 === 1 })
    }
  }
  return cells
}

export const GROUND_FALLBACK_COLOR = 0x93b573
export const GRASS_TILE_ID = 0

// One plan entry per tile: a codex texture url when terrain art exists, otherwise the C6
// flat palette-true diamond. Art independence — an empty record set renders exactly as C6 did.
export type TileLayer = { tex: TerrainTileManifest | null; url: string | null; fallback: number }

export type TilePlan = TileLayer & {
  sx: number; sy: number
  shade: boolean
  /** the C13 strip is a ribbon on transparency — `tex` covers only part of the diamond */
  overlay: boolean
  /** the ground that goes UNDER an overlay; null when `tex` fills its own diamond */
  base: TileLayer | null
}

export function tilesetPlan(terrain: TileId[][], records: AssetRecord[]): TilePlan[] {
  const cells: TilePlan[] = []
  for (let y = 0; y < terrain.length; y++) {
    const row = terrain[y]!
    for (let x = 0; x < row.length; x++) {
      const id = row[x]!
      const { sx, sy } = tileToScreen(x, y)
      // AMENDMENT (C13 §4): a road tile asks the shared autotiler for its shape first; the
      // flat road variants stay the fallback when no autotiled strip is in the codex.
      const autotile = id === ROAD_TILE_ID ? roadAutotile(roadNeighborsAt(terrain, x, y)) : null
      const { manifest, url, overlay } = resolveTerrainTile(records, id, x, y, autotile)
      // A ribbon drawn INSTEAD of the ground shows the stage through its own transparency —
      // half of a straight run is a hole. The road is painted to meet GRASS at its edges
      // (roadTiles.ts strokes exactly that seam), so grass is what goes underneath it.
      let base: TileLayer | null = null
      if (overlay) {
        const under = resolveTerrainTile(records, GRASS_TILE_ID, x, y)
        base = { tex: under.manifest, url: under.url, fallback: TILE_COLORS[GRASS_TILE_ID] }
      }
      cells.push({
        sx, sy, tex: manifest, url, overlay, base,
        fallback: TILE_COLORS[id] ?? GROUND_FALLBACK_COLOR,
        shade: (x + y) % 2 === 1,
      })
    }
  }
  return cells
}
