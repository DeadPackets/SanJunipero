// The ground under anything that stands on it: the mark occlusion leaves wherever two surfaces
// meet. A sun-cast mark belongs here too and cannot live here yet, see the gate's residuals.

/** The one ink every contact in the frame is drawn in: the bodies' own. */
export const GROUND_SHADOW_INK = 0x000000
/** How much wider the baked ring is than the shape it edges, and how faint. */
export const AO_SPREAD = 0.22
export const AO_ALPHA = 0.1

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
  dx: number,
  alpha: number,
): GroundMark {
  const [cx, cy] = centreOf(poly)
  const out: number[] = []
  for (let i = 0; i < poly.length; i += 2) {
    out.push(cx + (poly[i]! - cx) * scaleX + dx, cy + (poly[i + 1]! - cy) * scaleY)
  }
  return { poly: out, alpha }
}

/** The mark a thing standing here leaves whatever the hour. It takes no tick on purpose:
 *  occlusion is where two surfaces meet, not where the sun is. */
export function contactAo(footprint: readonly number[]): GroundMark {
  return ring(footprint, 1 + AO_SPREAD, 1 + AO_SPREAD, 0, AO_ALPHA)
}
