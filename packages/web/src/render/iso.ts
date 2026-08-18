// Hand-rolled dimetric math on the Style Bible 32×16 grid (spec §15).
export const TILE_W = 32
export const TILE_H = 16

export function tileToScreen(x: number, y: number): { sx: number; sy: number } {
  return { sx: (x - y) * (TILE_W / 2), sy: (x + y) * (TILE_H / 2) }
}

export function screenToTile(sx: number, sy: number): { x: number; y: number } {
  const a = sx / (TILE_W / 2)
  const b = sy / (TILE_H / 2)
  return { x: Math.round((a + b) / 2), y: Math.round((b - a) / 2) }
}

/** @deprecated for sorting — depth.ts owns the painter's order (U8). Kept because it is the
 *  minimap's cheap draw order and C10's landed tests still pin it. */
export function depthKey(x: number, y: number): number {
  return (x + y) * 1000 + x
}

export type Facing = 'sw' | 'se' | 'ne' | 'nw'

export function facingFrom(dx: number, dy: number): Facing {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'se' : 'nw'
  return dy >= 0 ? 'sw' : 'ne'
}
