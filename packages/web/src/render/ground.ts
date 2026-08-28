import type { TileId } from '@sj/engine/state'
import { TILE_H, TILE_W } from './iso.js'

// Not the cull's AABB: that is a DIAMOND's bounding box, whose corners are void by construction,
// and its question is "does this reach the VIEW". `tileToScreen` returns a tile's TOP vertex, so
// the painted field is exactly [0, w] × [0, h] in continuous tile space.

/** The continuous inverse of `tileToScreen`. `screenToTile` rounds to a tile; this does not,
 *  because a quad's corner lands between tiles and the rounding is what hides an overhang. */
export function screenToTileF(sx: number, sy: number): { fx: number; fy: number } {
  const a = sx / (TILE_W / 2),
    b = sy / (TILE_H / 2)
  return { fx: (a + b) / 2, fy: (b - a) / 2 }
}

export type ScreenRect = { x0: number; y0: number; x1: number; y1: number }

/** How far a screen rectangle reaches past the painted ground, in TILES; `<= 0` is inside. Every corner is tested: a diamond's edge is diagonal, so the first to leave is not the nearest. */
export function groundOverhangTiles(
  terrain: { length: number; [i: number]: { length: number } },
  r: ScreenRect,
): number {
  const h = terrain.length,
    w = h === 0 ? 0 : terrain[0]!.length
  let worst = -Infinity
  for (const [px, py] of [
    [r.x0, r.y0],
    [r.x1, r.y0],
    [r.x0, r.y1],
    [r.x1, r.y1],
  ] as const) {
    const { fx, fy } = screenToTileF(px, py)
    worst = Math.max(worst, -fx, fx - w, -fy, fy - h)
  }
  return worst
}

/** Nothing the renderer draws may leave the terrain extent. */
export const rectOnGround = (
  terrain: { length: number; [i: number]: { length: number } },
  r: ScreenRect,
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
