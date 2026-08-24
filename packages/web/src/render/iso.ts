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

/**
 * ★ THE ONE ROSTER OF FACINGS IN THE VIEWER, in the atlas's own column order.
 *
 * It was written out three times — here, `charAnim.SHEET_COLS`, and `forge/sheet.FACINGS` —
 * and three copies of a roster is how a roster drifts. `charAnim.ts` now re-exports this one,
 * and `iso.test.ts` reads the forge literal off disk and asserts the order is the same, which
 * is the only check available across a package boundary `@sj/web` deliberately does not cross.
 */
export const FACINGS = ['sw', 'se', 'ne', 'nw'] as const
export type Facing = (typeof FACINGS)[number]

/**
 * ★ THE RULE THAT WAS WRONG: A BODY WAS FACED BY ITS WORLD VECTOR AND NAMED BY A SCREEN COMPASS.
 *
 * The landed rule compared `|dx|` to `|dy|` — a WORLD-space classification — and then labelled
 * the answer `se`/`sw`/`ne`/`nw`, which are SCREEN directions on a 2:1 dimetric plane. On the
 * four cardinals the two agree, which is why every landed test passed; off them they do not,
 * and the disagreement is not even mirror-symmetric. `(+1,−1)` and `(−1,+1)` are exact screen
 * mirrors — pure right and pure left, `sy = 0` in both — and the old rule answered `se` (a
 * FRONT view) and `nw` (a BACK view). Two bodies crossing the screen in opposite directions,
 * one facing the camera and one facing away.
 *
 * So the projection decides it. `sx = (dx−dy)·16` and `sy = (dx+dy)·8`, and only the SIGNS
 * matter, so this reads them off `dx−dy` and `dx+dy` with no multiplication: `sy > 0` is
 * toward the viewer (a front ¾ view), `sx > 0` is toward the right of the screen.
 *
 * The two ties are broken so that negating the motion negates the facing:
 *  · PURE DEPTH (`sx = 0`, equal +dx +dy): no sideways travel at all, so either hand is right.
 *    Take the right-hand one both ways — `se` coming, `ne` going — and the pair stays a mirror.
 *  · PURE SIDEWAYS (`sy = 0`): the body is neither approaching nor receding, so it keeps its
 *    face to the camera — `se` going right, `sw` going left. The old rule gave a back view to
 *    exactly one of these two.
 *
 * ★ AND A BODY THAT HAS NOT MOVED HAS NO FACING. The old rule answered `se` for `(0,0)` —
 * `|0| >= |0|` and `0 >= 0` — so a zero delta named a direction. `legFacing` reaches that case
 * whenever the interpolated anchor lands exactly on the next waypoint. `null` is the honest
 * answer and every caller already had somewhere to put it.
 */
export function facingFrom(dx: number, dy: number): Facing | null {
  const sx = dx - dy // sign of the screen x
  const sy = dx + dy // sign of the screen y, positive toward the viewer
  if (sx === 0 && sy === 0) return null
  if (sx === 0) return sy > 0 ? 'se' : 'ne'
  if (sy === 0) return sx > 0 ? 'se' : 'sw'
  return sy > 0 ? (sx > 0 ? 'se' : 'sw') : (sx > 0 ? 'ne' : 'nw')
}
