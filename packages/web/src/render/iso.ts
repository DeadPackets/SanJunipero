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

/**
 * @deprecated for sorting — depth.ts owns the painter's order (U8). Kept as the BEFORE-STATE
 * the U8 tests measure against: `depth.test.ts` and `occlusion.test.ts` reproduce the landed
 * ordering with it and assert what the topological pass fixed.
 *
 * ★ THIS COMMENT USED TO NAME THE MINIMAP as the reason it was kept. There was no minimap. It
 * was a fossil describing a thing nobody built, and it cost the camera lane real time — it read
 * the sentence, believed a minimap existed, and planned around one. There is a
 * minimap now (`render/minimap.ts`) and it does not use this: it has its own raster and never
 * sorts anything. A comment asserting a fact nothing enforces is the defect this project keeps
 * finding, and a comment asserting a fact that was never true is the same defect with a longer
 * fuse. `iso.test.ts` holds the line.
 */
export function depthKey(x: number, y: number): number {
  return (x + y) * 1000 + x
}

export type Facing = 'sw' | 'se' | 'ne' | 'nw'

export function facingFrom(dx: number, dy: number): Facing {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'se' : 'nw'
  return dy >= 0 ? 'sw' : 'ne'
}
