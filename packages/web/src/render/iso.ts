// Hand-rolled dimetric math on the Style Bible 32×16 grid (spec §15).
export const TILE_W = 32
export const TILE_H = 16

export function tileToScreen(x: number, y: number): { sx: number; sy: number } {
  return { sx: (x - y) * (TILE_W / 2), sy: (x + y) * (TILE_H / 2) }
}

/** THE anchor law: a thing standing on `[x, x+w] × [y, y+h]` puts its feet on the footprint's
 *  SOUTH vertex — for a non-square plan, under the plan's centre line at the south row. */
export function feetOf(x: number, y: number, w = 1, h = 1): { sx: number; sy: number } {
  const cx = x + w / 2,
    cy = y + h / 2
  return { sx: (cx - cy) * (TILE_W / 2), sy: (cx + cy) * (TILE_H / 2) + ((w + h) * TILE_H) / 4 }
}

/** The tile a screen point stands on. `tileToScreen` returns a tile's TOP vertex, so the
 *  containing tile is the FLOOR of the continuous coordinates, not the nearest vertex. */
export function screenToTile(sx: number, sy: number): { x: number; y: number } {
  const a = sx / (TILE_W / 2)
  const b = sy / (TILE_H / 2)
  return { x: Math.floor((a + b) / 2), y: Math.floor((b - a) / 2) }
}

/** NOT the painter's order — depth.ts owns that. This is the before-state that `depth.test.ts`
 *  and `occlusion.test.ts` measure the topological pass against. */
export function depthKey(x: number, y: number): number {
  return (x + y) * 1000 + x
}

/** The one roster of facings, in the atlas's own column order — `charAnim` re-exports it. */
export const FACINGS = ['sw', 'se', 'ne', 'nw'] as const
export type Facing = (typeof FACINGS)[number]

/** Facing is classified in SCREEN space from the signs of `dx−dy` and `dx+dy` — the compass
 *  name is a screen name. The two ties break so that negating the motion negates the facing:
 *  pure depth takes the right hand both ways, pure sideways keeps the face to the camera.
 *  A zero delta has no facing and returns `null`. */
export function facingFrom(dx: number, dy: number): Facing | null {
  const sx = dx - dy // sign of the screen x
  const sy = dx + dy // sign of the screen y, positive toward the viewer
  if (sx === 0 && sy === 0) return null
  if (sx === 0) return sy > 0 ? 'se' : 'ne'
  if (sy === 0) return sx > 0 ? 'se' : 'sw'
  return sy > 0 ? (sx > 0 ? 'se' : 'sw') : sx > 0 ? 'ne' : 'nw'
}
