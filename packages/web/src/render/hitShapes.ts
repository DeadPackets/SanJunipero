// HIT SHAPES THAT MATCH WHAT IS DRAWN (U9, plan task 72).
//
// THE DEFECT: the click target was a 52 × 72 RECTANGLE with the feet at (0,0), while the
// drawn figure is ~26 px wide at the shoulders and ~52 px tall. The box was therefore about
// 2.8× the silhouette's area — it claimed a 20 px column of empty sky above the head where
// the name tag lives, and it reached 26 px to each side, which is how a body stole the door
// of the building beside it (audit M5).
//
// Per-pixel hit testing does not exist in Pixi, so the ratified substitute is a MEASURED
// CAPSULE: a foot diamond the width of the stance, a torso column the width of the
// shoulders, and a head cap — with the area ratio to the drawn silhouette asserted at the
// gate. Every vertical dimension is a fraction of the figure's own drawn height, so a taller
// sheet gets a taller capsule and there is no second table to keep in step.

/** Screen px, across. A stance is narrower than shoulders; a head is narrower still. */
export const STANCE_W = 20, SHOULDER_W = 28, HEAD_W = 18
/** Screen px up from the feet where the stance has widened into the torso. */
export const FOOT_H = 8
/** Fractions of the DRAWN figure height. */
export const TORSO_TOP = 0.66, HEAD_TOP = 0.94

/** The minimum any pointer target may be, in SCREEN px, at any zoom (audit m4 + P14). */
export const HIT_MIN_PX = 24

/** Area of the hit shape over the area of the drawn silhouette's bounding box. The number U9
 *  is about, and the number the gate asserts. */
export const HIT_TIGHTNESS_MAX = 1.35

/**
 * The capsule in LOCAL sprite space — feet at (0,0), the body rising to negative y, points
 * pre-divided by `scale` exactly as `hitRect` did, because Pixi scales `hitArea` with the
 * sprite. Eight points, closed.
 *
 * `figureH` is the figure's height in its own SHEET pixels and `scale` the sprite scale, so
 * `figureH · scale` is what the viewer actually sees.
 */
export function bodyHitPolygon(figureH: number, scale: number): number[] {
  const k = scale === 0 ? 1 : scale
  const drawnH = figureH * k
  const right: [number, number][] = [
    [STANCE_W / 2, 0],
    [SHOULDER_W / 2, -FOOT_H],
    [SHOULDER_W / 2, -TORSO_TOP * drawnH],
    [HEAD_W / 2, -HEAD_TOP * drawnH],
  ]
  // up the right side, across the head, down the left side — eight points, closed
  const left = [...right].reverse().map(([x, y]): [number, number] => [-x, y])
  return [...right, ...left].flatMap(([x, y]) => [x / k, y / k])
}

/** Shoelace area of a flat point list. */
export function polygonArea(poly: number[]): number {
  let a = 0
  const n = poly.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += poly[i * 2]! * poly[j * 2 + 1]! - poly[j * 2]! * poly[i * 2 + 1]!
  }
  return Math.abs(a) / 2
}

export function polygonBounds(poly: number[]): { w: number; h: number; cx: number; cy: number } {
  const xs = poly.filter((_, i) => i % 2 === 0)
  const ys = poly.filter((_, i) => i % 2 === 1)
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const y0 = Math.min(...ys), y1 = Math.max(...ys)
  return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }
}

/**
 * Grow a capsule about its own centroid until it is at least `minPx` on screen in both axes.
 * `screenScale` is the TOTAL on-screen scale — sprite scale times camera zoom — so a tiny
 * sprite at the 0.5 overview stop stays clickable without carrying an oversized box at 4×.
 *
 * ★ `maxWidthPx` IS WHERE ACCURACY AND THE FLOOR ARE RECONCILED, AND IT IS THE WHOLE DESIGN
 * TENSION OF THIS LANE. The floor exists so a lone target stays findable; it is a Fitts's-law
 * rule about a target in open space. It says nothing about a target with a NEIGHBOUR 14 px
 * away, and applied there it is actively harmful: five bodies in a shoulder rank, each grown
 * to 24 px, are one 24 px-wide contest that the depth sort settles — the viewer can no longer
 * choose which of the five they meant. **Hitting the wrong person is a worse failure than a
 * small target**, because a small target misses loudly and the wrong person answers quietly.
 *
 * So the floor is capped by the distance to the nearest neighbour of the same class. A lone
 * body keeps the whole 24/z; a body in a rank grows to at most one pitch, which is the widest
 * it can be while still being the one thing under the pointer. `crowd.test.ts` owns the pitch
 * and `characters.test.ts` proves the five stay five at every zoom stop.
 */
export function inflateToMin(
  poly: number[], minPx: number, screenScale: number, maxWidthPx = Infinity,
): number[] {
  const k = screenScale === 0 ? 1 : screenScale
  const { w, h, cx, cy } = polygonBounds(poly)
  const wantW = Math.min(minPx, Math.max(maxWidthPx, w * k))
  const fx = w * k >= wantW || w === 0 ? 1 : wantW / (w * k)
  const fy = h * k >= minPx || h === 0 ? 1 : minPx / (h * k)
  if (fx === 1 && fy === 1) return [...poly]
  return poly.map((v, i) => (i % 2 === 0 ? cx + (v - cx) * fx : cy + (v - cy) * fy))
}

/**
 * How much bigger the click target is than the thing it claims to be. 1.0 is the silhouette's
 * own bounding box; the landed 52 × 72 rectangle is 2.77.
 */
export function hitTightness(poly: number[], figureW: number, figureH: number, scale: number): number {
  const k = scale === 0 ? 1 : scale
  return (polygonArea(poly) * k * k) / (figureW * k * (figureH * k))
}

// ── ★ A BUILDING IS A VOLUME, AND THE TARGET WAS THE GROUND UNDER IT ─────────────────────
//
// THE RULING: *"the 'click to inspect or enter building' squares [must] be retired and instead
// replaced with accurate hitboxes of the actual structures themselves."*
//
// ★ THE DEFECT, MEASURED RATHER THAN DESCRIBED. The landed target was `footprintHitPoints` —
// the FLAT ground diamond a building stands on. Every building's art was decoded and its
// opaque pixels counted against that diamond (`scratchpad/hb/alpha.mts`, twenty codex roots):
//
//   the flat footprint diamond contains 0.0 % – 0.8 % of the building's DRAWN pixels
//
// The click target and the picture were disjoint. Clicking a roof, a wall, a chimney or a
// doorway did nothing at all; the only place a house answered was the strip of grass its
// plinth touches. That is not a tight hitbox, it is a hitbox for a different object.
//
// ★ AND THE DRAWN BUILDING IS TWICE THE WIDTH OF THE GROUND IT STANDS ON. `buildingArt` fits
// every root to a `(w + h) · BUILDING_PX_PER_TILE` SQUARE, and the art fills it: measured
// `drawnW / diamondW` is 1.90 – 2.00 for every dwelling in the town. So a hit prism raised over
// the TRUE footprint is not the answer either — it contains only 58 % – 68 % of the drawn
// pixels, because the eaves, the porch and half the frontage hang outside the ground plan.
//
// ★ SO THE SHAPE IS THE DIAMOND FOOTPRINT OF WHAT IS **DRAWN**, EXTRUDED TO WHAT IS DRAWN.
// Three arguments, and one measurement each:
//
//  1. IT IS THE GEOMETRY, NOT A GUESS. A dimetric building is a diamond ground plan with a
//     body standing out of it; the art is authored that way and `builtFormSpec` already
//     extrudes exactly this prism for the kinds that have no art. The hexagon is six points
//     and every one of them comes from `(w + h) · BUILDING_PX_PER_TILE` — the SAME constant
//     `depth.ts` and `cull.ts` already compute a building's screen box from. No new table.
//
//  2. THE PIXEL-EXACT SILHOUETTE IS NOT AVAILABLE AND WOULD NOT PAY. Pixi has no per-pixel hit
//     test, so it means an alpha read-back per root, re-run on every codex hot-swap and every
//     scale change. Measured against the prism it buys 89.1 %→~99 % coverage on the six narrow
//     kinds whose art does not fill its cell (well, standing stone, scaffolding, wagon, grave,
//     bridge) and nothing at all on the fourteen that do.
//
//  3. A PER-KIND ROSTER IS THE THING THIS PROJECT KEEPS DELETING. `BUILT_FORM_MATERIALS`
//     already hashes unknown kinds onto a ramp precisely because the roster is open — the world
//     learns to raise new things and no table can be ahead of it. The prism IS the shape: give
//     it (w, h) and it is correct for a kind nobody has drawn yet.
//
// MEASURED, all twenty roots: the prism contains 89.1 % – 99.7 % of the drawn pixels at a
// tightness of 0.754 – 1.116 against the drawn bounding box — comparable to the body capsule's
// 0.935 and inside `HIT_TIGHTNESS_MAX` everywhere.

/** One tile of width is also one tile of height up a wall (`BUILT_FORM_UNIT_PX` says the same
 *  thing for the drawn volumes). Restated here so `hitShapes` stays free of the art modules. */
export const BUILDING_UNIT_PX = 32

/**
 * A ground diamond swept upward — the one primitive both structure shapes are cut from.
 *
 * `base` is a four-point diamond in N, E, S, W order (what `footprintDiamond` returns). The
 * result is the SIX-point outer silhouette of the solid: up the west side, across the bottom,
 * up the east side, then back over the raised top. Six points and not eight, because the
 * raised south vertex is inside the shape — the same reason `builtFormSpec.silhouette` has six.
 */
export function extrudeDiamond(base: number[], heightPx: number): number[] {
  const [nx, ny, ex, ey, sx, sy, wx, wy] = base as [number, number, number, number, number, number, number, number]
  const h = Math.max(0, heightPx)
  return [wx, wy, sx, sy, ex, ey, ex, ey - h, nx, ny - h, wx, wy - h]
}

/**
 * The hit prism for a building drawn from ART, in the sprite's LOCAL space.
 *
 * `buildingArt` fits every root to a `(w + h) · BUILDING_UNIT_PX` square anchored at its feet
 * point, and every root's lowest opaque row IS that feet row (measured: `below feet` is 0.0 px
 * on all twenty). So the drawn ground diamond has its SOUTH vertex at the local origin, is
 * `side` wide and `side / 2` tall, and the body rises to `side` — which makes the prism's
 * bounding box exactly the drawn cell, with the four corners cut off by the diamond.
 *
 * Points are pre-divided by `scale` because Pixi scales `hitArea` with the sprite.
 */
export function artPrismPolygon(w: number, h: number, scale: number): number[] {
  const k = scale === 0 ? 1 : scale
  const side = (w + h) * BUILDING_UNIT_PX
  const halfW = side / 2, halfH = side / 4
  // N, E, S, W of the DRAWN ground diamond, south vertex on the feet point
  const base = [0, -halfH * 2, halfW, -halfH, 0, 0, -halfW, -halfH]
  return extrudeDiamond(base, side - halfH * 2).map((v) => v / k)
}

/** How tall a drawn building stands above its feet, in local screen px. The number the prism
 *  and `structureDepthBox`'s screen AABB both mean by "a building is this tall". */
export const artPrismHeightPx = (w: number, h: number): number => (w + h) * BUILDING_UNIT_PX

/** Priority when two hit-testable things genuinely overlap. Lower wins. A body beats a
 *  building because a person is the smaller, more specific claim on the pointer. */
export const HIT_PRIORITY: Readonly<Record<'agent' | 'item' | 'crop' | 'structure', number>> =
  { agent: 0, item: 1, crop: 2, structure: 3 }

export function resolveHit(
  candidates: ReadonlyArray<{ kind: keyof typeof HIT_PRIORITY; id: string }>,
): string | null {
  let best: { kind: keyof typeof HIT_PRIORITY; id: string } | null = null
  for (const c of candidates) {
    if (best === null || HIT_PRIORITY[c.kind] < HIT_PRIORITY[best.kind]) best = c
  }
  return best?.id ?? null
}

/** The landed FLAT ground diamond, so the before-state is measured rather than remembered.
 *  `entities.footprintHitPoints` was this, and it was the whole click target for a building. */
export function legacyFootprintPolygon(base: number[], scale: number): number[] {
  const k = scale === 0 ? 1 : scale
  return base.map((v) => v / k)
}

/** The landed rectangle, as a polygon, so the before-state can be measured not remembered. */
export function legacyHitRectPolygon(w: number, h: number, scale: number): number[] {
  const k = scale === 0 ? 1 : scale
  return [-w / 2 / k, 0, w / 2 / k, 0, w / 2 / k, -h / k, -w / 2 / k, -h / k]
}
