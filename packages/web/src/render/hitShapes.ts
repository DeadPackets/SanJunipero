// Pixi has no per-pixel hit test, so a body's click target is a MEASURED CAPSULE. Every
// vertical dimension is a fraction of the figure's own drawn height, so there is no second
// table to keep in step when a sheet gets taller.

/** Screen px, across. A stance is narrower than shoulders; a head is narrower still. */
export const STANCE_W = 20,
  SHOULDER_W = 28,
  HEAD_W = 18
/** Screen px up from the feet where the stance has widened into the torso. */
const FOOT_H = 8
/** Fractions of the DRAWN figure height. */
export const TORSO_TOP = 0.66
const HEAD_TOP = 0.94

/** The minimum any pointer target may be, in SCREEN px, at any zoom. */
export const HIT_MIN_PX = 24

/** Area of the hit shape over the area of the drawn silhouette's bounding box. The number the
 *  gate asserts. */
export const HIT_TIGHTNESS_MAX = 1.35

/** The capsule in LOCAL sprite space — feet at (0,0), the body rising to negative y. Points are
 *  pre-divided by `scale` because Pixi scales `hitArea` with the sprite. */
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
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs)
  const y0 = Math.min(...ys),
    y1 = Math.max(...ys)
  return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }
}

/**
 * Grow a capsule about its own centroid to at least `minPx` of TOTAL on-screen scale — sprite
 * scale times camera zoom — capped by `maxWidthPx`, the pitch to the nearest neighbour of the
 * same class: a rank of bodies all grown to the floor is one contest the viewer cannot settle.
 */
export function inflateToMin(
  poly: number[],
  minPx: number,
  screenScale: number,
  maxWidthPx = Infinity,
): number[] {
  const k = screenScale === 0 ? 1 : screenScale
  const { w, h, cx, cy } = polygonBounds(poly)
  const wantW = Math.min(minPx, Math.max(maxWidthPx, w * k))
  const fx = w * k >= wantW || w === 0 ? 1 : wantW / (w * k)
  const fy = h * k >= minPx || h === 0 ? 1 : minPx / (h * k)
  if (fx === 1 && fy === 1) return [...poly]
  return poly.map((v, i) => (i % 2 === 0 ? cx + (v - cx) * fx : cy + (v - cy) * fy))
}

/** Hit-shape area over the drawn silhouette's bounding box; 1.0 is the silhouette itself. */
export function hitTightness(
  poly: number[],
  figureW: number,
  figureH: number,
  scale: number,
): number {
  const k = scale === 0 ? 1 : scale
  return (polygonArea(poly) * k * k) / (figureW * k * (figureH * k))
}

// ── a building is a volume ───────────────────────────────────────────────────────────────
//
// The hit shape is the diamond footprint of what is DRAWN, extruded: drawn art is 1.90–2.00×
// the ground diamond, so a prism over the TRUE footprint misses the eaves.
// Pixi has no per-pixel hit test, and the prism already covers 89.1 %–99.7 % of drawn pixels,
// so a silhouette read-back is refused.
// No per-kind table: the prism is `(w + h) · BUILDING_UNIT_PX`, so it is correct for a kind
// nobody has drawn yet.

/** One tile of width is also one tile of height up a wall (`BUILT_FORM_UNIT_PX` says the same
 *  thing for the drawn volumes). Restated here so `hitShapes` stays free of the art modules. */
export const BUILDING_UNIT_PX = 32

/**
 * A ground diamond swept upward. `base` is four points in N, E, S, W order; the result is the
 * SIX-point outer silhouette, because the raised south vertex is inside the shape.
 */
export function extrudeDiamond(base: number[], heightPx: number): number[] {
  const [nx, ny, ex, ey, sx, sy, wx, wy] = base as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  const h = Math.max(0, heightPx)
  return [wx, wy, sx, sy, ex, ey, ex, ey - h, nx, ny - h, wx, wy - h]
}

/**
 * The hit prism for a building drawn from ART, in the sprite's LOCAL space: the drawn ground
 * diamond's SOUTH vertex sits on the feet point, `side` wide and `side / 2` tall, and the body
 * rises to `side`. Points are pre-divided by `scale` because Pixi scales `hitArea`.
 */
export function artPrismPolygon(w: number, h: number, scale: number): number[] {
  const k = scale === 0 ? 1 : scale
  const side = (w + h) * BUILDING_UNIT_PX
  const halfW = side / 2,
    halfH = side / 4
  // N, E, S, W of the DRAWN ground diamond, south vertex on the feet point
  const base = [0, -halfH * 2, halfW, -halfH, 0, 0, -halfW, -halfH]
  return extrudeDiamond(base, side - halfH * 2).map((v) => v / k)
}

/** Priority when two hit-testable things genuinely overlap. Lower wins. A body beats a
 *  building because a person is the smaller, more specific claim on the pointer. */
export const HIT_PRIORITY: Readonly<Record<'agent' | 'item' | 'crop' | 'structure', number>> = {
  agent: 0,
  item: 1,
  crop: 2,
  structure: 3,
}

export function resolveHit(
  candidates: readonly { kind: keyof typeof HIT_PRIORITY; id: string }[],
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
