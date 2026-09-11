// The ground under anything that stands on it: the mark occlusion leaves wherever two surfaces
// meet, and the mark the sun lays out from it.

import { SHADOW_MAX_STRETCH, type ShadowCast } from '../ui/skyModel.js'
import { TILE_W } from './iso.js'

/** The one ink every contact in the frame is drawn in: the bodies' own. */
export const GROUND_SHADOW_INK = 0x000000
/** How much wider the baked ring is than the shape it edges, and how faint. */
export const AO_SPREAD = 0.22
export const AO_ALPHA = 0.1
/** The cast's ceiling. The ink rises and falls with the stretch, so the mark is at its
 *  darkest when it is longest and is gone by the time it has shortened back to the footprint. */
export const CAST_ALPHA = 0.25

/** A shape lying flat on the ground, in the caster's own local space. */
export type GroundMark = { poly: number[]; alpha: number }

function centreOf(poly: readonly number[]): [number, number] {
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i += 2) {
    cx += poly[i]!
    cy += poly[i + 1]!
  }
  const n = poly.length / 2
  return [cx / n, cy / n]
}

function ring(
  poly: readonly number[],
  scaleX: number,
  scaleY: number,
  alpha: number,
  anchorX?: number,
): GroundMark {
  const [cx, cy] = centreOf(poly)
  const ax = anchorX ?? cx
  const out: number[] = []
  for (let i = 0; i < poly.length; i += 2) {
    out.push(ax + (poly[i]! - ax) * scaleX, cy + (poly[i + 1]! - cy) * scaleY)
  }
  return { poly: out, alpha }
}

/** The mark a thing standing here leaves whatever the hour. It takes no tick on purpose:
 *  occlusion is where two surfaces meet, not where the sun is. */
export function contactAo(footprint: readonly number[]): GroundMark {
  return ring(footprint, 1 + AO_SPREAD, 1 + AO_SPREAD, AO_ALPHA)
}

/** The mark the sun lays from something this tall, in the caster's own local space. The reach
 *  is the body's own reach times the height in tiles, so a wall goes further than a kerb. */
export function sunCast(
  footprint: readonly number[],
  heightPx: number,
  sun: ShadowCast,
): GroundMark {
  const xs = footprint.filter((_, i) => i % 2 === 0)
  const [lo, hi] = [Math.min(...xs), Math.max(...xs)]
  const golden = (sun.scaleX - 1) / (SHADOW_MAX_STRETCH - 1)
  // A shadow leaves the LIT edge of what casts it, so the whole reach grows away from the sun
  // and the ink goes with the stretch: a cast that shortened to nothing at full ink was cut off.
  return ring(
    footprint,
    sun.scaleX + Math.abs((sun.dx * heightPx) / TILE_W) / (hi - lo),
    sun.scaleY,
    CAST_ALPHA * sun.alpha * golden,
    sun.dx < 0 ? hi : lo,
  )
}
