import type { DepthBox } from './depth.js'
import { BUILDING_PX_PER_TILE } from './textures.js'

// The cull tests the `DepthBox`'s screen AABB of the DRAWN sprite, overhang included — not the
// footprint rect a naive cull would use. `CULL_MARGIN_PX` is not geometry; it covers art whose
// bitmap does not match the `(w + h) · BUILDING_PX_PER_TILE` assumption the box is computed from.

export type ViewRect = { x: number; y: number; w: number; h: number }

export const CULL_MARGIN_PX = 2 * BUILDING_PX_PER_TILE

/** Does a painted screen rectangle reach the view, with the margin's slack? Chunk residency and the depth sort share it, so they cannot disagree by a pixel at the edge of the stage. */
export function rectInView(
  sx0: number,
  sy0: number,
  sx1: number,
  sy1: number,
  view: ViewRect,
  margin = CULL_MARGIN_PX,
): boolean {
  return (
    sx1 >= view.x - margin &&
    sx0 <= view.x + view.w + margin &&
    sy1 >= view.y - margin &&
    sy0 <= view.y + view.h + margin
  )
}

/** Does this drawable's painted rectangle reach the view, with the margin's slack? */
export function boxInView(b: DepthBox, view: ViewRect, margin = CULL_MARGIN_PX): boolean {
  return rectInView(b.sx0, b.sy0, b.sx1, b.sy1, view, margin)
}

export type Culled<T> = { drawn: T[]; hidden: T[] }

/** Split a frame's drawables into the ones worth sorting and drawing and the ones that are
 *  not. Arrival order survives inside each half, so the depth seed sees what it always saw. */
export function cullByBox<T extends { box: DepthBox }>(
  entries: readonly T[],
  view: ViewRect,
  margin = CULL_MARGIN_PX,
): Culled<T> {
  const drawn: T[] = [],
    hidden: T[] = []
  for (const e of entries) (boxInView(e.box, view, margin) ? drawn : hidden).push(e)
  return { drawn, hidden }
}
