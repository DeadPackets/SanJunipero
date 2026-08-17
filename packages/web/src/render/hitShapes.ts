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
 */
export function inflateToMin(poly: number[], minPx: number, screenScale: number): number[] {
  const k = screenScale === 0 ? 1 : screenScale
  const { w, h, cx, cy } = polygonBounds(poly)
  const fx = w * k >= minPx || w === 0 ? 1 : minPx / (w * k)
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

// ── the door, as part of the building it belongs to (U11, plan task 73) ──────────────────
//
// THE DEFECT: the door was a Graphics rounded rect in ink at 50 % alpha, 10 × 13 world px,
// drawn as a SIBLING of its building at `structureZIndex + 1` — so it painted over anyone
// standing in the doorway (U11's dark rectangle) and its tiny target lost every contest with
// the 52 × 72 body box. P9d is repealed: the door is a CHILD of its building sprite, so it
// inherits the building's depth and can never sort against it.

/** The frontage plate, in tiles. Inflated to HIT_MIN_PX where a 1×1 frontage would be
 *  smaller than a pointer can reliably find. */
export const DOOR_W_TILES = 0.55, DOOR_H_TILES = 0.85
const TILE_PX = 32   // iso.TILE_W — a tile of width is also a tile of height up a wall

/** The door tile's CENTRE in the parent sprite's local space, before scaling. The same
 *  south-face, centre-of-frontage rule `doorTileOf` applies in world tiles. */
export function doorLocalCentre(footprint: { w: number; h: number }): { x: number; y: number } {
  const ddx = ((footprint.w - 1) >> 1) - (footprint.w / 2 - 0.5)
  const ddy = footprint.h - 1 - (footprint.h / 2 - 0.5)
  return { x: (ddx - ddy) * (TILE_PX / 2), y: (ddx + ddy) * (TILE_PX / 4) + TILE_PX / 4 }
}

/**
 * The door's TARGET in the PARENT sprite's local space, derived from the footprint rather than
 * from two hardcoded pixel constants, and centred on the threshold it names. A child inherits
 * the parent's scale, so the local rect is divided by it and the SCREEN size is constant at any
 * art resolution.
 *
 * `zoom` is the CAMERA's scale, and the floor is a SCREEN size. Task 75 adds the 0.5 overview
 * stop, at which a 24-world-px target is 12 screen px — half the floor. The floor was
 * unexercised while `ZOOM_MIN` was 1; it is live now, so it has to know the zoom.
 */
export function doorLocalRect(
  footprint: { w: number; h: number }, scale: number, zoom = 1,
): { x: number; y: number; w: number; h: number } {
  const k = scale === 0 ? 1 : scale
  const z = zoom > 0 ? zoom : 1
  const floor = Math.max(HIT_MIN_PX, HIT_MIN_PX / z)
  const w = Math.max(DOOR_W_TILES * TILE_PX, floor)
  const h = Math.max(DOOR_H_TILES * TILE_PX, floor)
  const c = doorLocalCentre(footprint)
  return { x: (c.x - w / 2) / k, y: (c.y - h / 2) / k, w: w / k, h: h / k }
}

/** The threshold itself: the door tile's own ground diamond, inset so it reads as a sill laid
 *  in front of the doorway rather than as a slab painted over the wall (U11). */
export const DOOR_SILL_INSET = 0.16
export function doorSillPolygon(footprint: { w: number; h: number }, scale: number): number[] {
  const k = scale === 0 ? 1 : scale
  const c = doorLocalCentre(footprint)
  const halfW = (TILE_PX / 2) * (1 - DOOR_SILL_INSET)
  const halfH = (TILE_PX / 4) * (1 - DOOR_SILL_INSET)
  return [c.x, c.y - halfH, c.x + halfW, c.y, c.x, c.y + halfH, c.x - halfW, c.y]
    .map((v, i) => (i % 2 === 0 ? (v - 0) / k : v / k))
}

/** Priority when two hit-testable things genuinely overlap. Lower wins. A door beats a body
 *  BECAUSE a door is a destination and a body has a whole panel of its own; a body beats a
 *  building because a building's story is one popover. */
export const HIT_PRIORITY: Readonly<Record<'door' | 'agent' | 'item' | 'crop' | 'structure', number>> =
  { door: 0, agent: 1, item: 2, crop: 3, structure: 4 }

export function resolveHit(
  candidates: ReadonlyArray<{ kind: keyof typeof HIT_PRIORITY; id: string }>,
): string | null {
  let best: { kind: keyof typeof HIT_PRIORITY; id: string } | null = null
  for (const c of candidates) {
    if (best === null || HIT_PRIORITY[c.kind] < HIT_PRIORITY[best.kind]) best = c
  }
  return best?.id ?? null
}

/** The landed rectangle, as a polygon, so the before-state can be measured not remembered. */
export function legacyHitRectPolygon(w: number, h: number, scale: number): number[] {
  const k = scale === 0 ? 1 : scale
  return [-w / 2 / k, 0, w / 2 / k, 0, w / 2 / k, -h / k, -w / 2 / k, -h / k]
}
