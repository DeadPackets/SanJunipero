import type { DepthBox } from './depth.js'
import { BUILDING_PX_PER_TILE } from './textures.js'

// VIEWPORT CULLING, AND WHY IT IS SIX LINES.
//
// The town grows without bound — blocks plat in rings and agents claim plots forever — so every
// frame was building and drawing the whole settlement whether or not any of it was on screen.
// Worse than the draw cost: `depthOrder` compares every pair of drawables, and above
// `DEPTH_BUDGET` (256) it abandons the topological pass and falls back to seed order. A town of
// a few hundred buildings therefore did not merely run slowly, it drew in the WRONG ORDER.
//
// ★ THE CULL TEST IS EXACT BECAUSE THE BOX ALREADY IS. A `DepthBox` carries `sx0..sy1`: the
// screen AABB of the DRAWN sprite, overhang included — a 4×2 roof's box already reaches 192 px
// above the ground the building stands on, because depth.ts needed that number to decide who
// occludes whom. So the cull asks the one question that matters — do the painted pixels touch
// the view — and a footprint rect, which is what a naive cull tests, is not involved. The
// popping test in cull.test.ts sweeps a 384-building town across a viewport and proves it.
//
// The margin is NOT geometry; the box covers the geometry. It covers what the box ASSUMES: a
// building's box is computed from `(w + h) · BUILDING_PX_PER_TILE`, while the sprite it
// describes is a bitmap from the forge scaled by a manifest. Two tiles' worth of overhang is
// one whole extra roof of slack for art that does not match the assumption.

export type ViewRect = { x: number; y: number; w: number; h: number }

export const CULL_MARGIN_PX = 2 * BUILDING_PX_PER_TILE

/** Does a painted screen rectangle reach the view, with the margin's slack? The ground's chunk
 *  residency asks exactly this question about a chunk and the depth sort asks it about a
 *  drawable, so they ask it of ONE function — two things that decide what is on screen and
 *  disagree by a pixel is a hole in the picture at the edge of the stage. */
export function rectInView(
  sx0: number, sy0: number, sx1: number, sy1: number, view: ViewRect, margin = CULL_MARGIN_PX,
): boolean {
  return sx1 >= view.x - margin && sx0 <= view.x + view.w + margin
    && sy1 >= view.y - margin && sy0 <= view.y + view.h + margin
}

/** Does this drawable's painted rectangle reach the view, with the margin's slack? */
export function boxInView(b: DepthBox, view: ViewRect, margin = CULL_MARGIN_PX): boolean {
  return rectInView(b.sx0, b.sy0, b.sx1, b.sy1, view, margin)
}

export type Culled<T> = { drawn: T[]; hidden: T[] }

/** Split a frame's drawables into the ones worth sorting and drawing and the ones that are
 *  not. Arrival order survives inside each half, so the depth seed sees what it always saw. */
export function cullByBox<T extends { box: DepthBox }>(
  entries: readonly T[], view: ViewRect, margin = CULL_MARGIN_PX,
): Culled<T> {
  const drawn: T[] = [], hidden: T[] = []
  for (const e of entries) (boxInView(e.box, view, margin) ? drawn : hidden).push(e)
  return { drawn, hidden }
}
