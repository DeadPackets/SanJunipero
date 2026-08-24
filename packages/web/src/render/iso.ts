// Hand-rolled dimetric math on the Style Bible 32×16 grid (spec §15).
export const TILE_W = 32
export const TILE_H = 16

export function tileToScreen(x: number, y: number): { sx: number; sy: number } {
  return { sx: (x - y) * (TILE_W / 2), sy: (x + y) * (TILE_H / 2) }
}

/**
 * ★ THE TILE A SCREEN POINT IS STANDING ON — AND IT USED TO BE THE WRONG ONE BY HALF A TILE.
 *
 * `tileToScreen` returns a tile's TOP vertex, so tile (x, y) covers `[x, x+1] × [y, y+1]` in
 * continuous tile space. `ground.ts` states exactly that in its own header and
 * `groundField.toScreen` adds `TILE_H / 2` to reach a tile's CENTRE from it. The tile
 * containing a point is therefore the FLOOR of its continuous coordinates. This ROUNDED, which
 * answers with the tile whose top vertex is nearest — the neighbour to the south-east for any
 * point in a tile's lower half, and one tile off in BOTH axes at a tile's own centre.
 *
 * `iso.test.ts` shipped a sweep that only ever sampled `tileToScreen`'s own output, i.e. the
 * lattice vertices, the one set of points where rounding and flooring cannot disagree — so it
 * passed for the whole life of the defect. The reader that DID notice was `minimap.ts`, which
 * carried a hand-rolled `- TILE_H / 2` to shift the point half a tile north before asking.
 * That workaround is gone, and `iso.test.ts` now samples inside the tile.
 */
export function screenToTile(sx: number, sy: number): { x: number; y: number } {
  const a = sx / (TILE_W / 2)
  const b = sy / (TILE_H / 2)
  return { x: Math.floor((a + b) / 2), y: Math.floor((b - a) / 2) }
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
