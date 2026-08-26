import { describe, expect, it } from 'vitest'
import { CHAR_TARGET_PX, HIT_AREA_H, HIT_AREA_W } from './charAnim.js'
import {
  BUILDING_UNIT_PX,
  HEAD_W,
  HIT_MIN_PX,
  HIT_TIGHTNESS_MAX,
  SHOULDER_W,
  STANCE_W,
  TORSO_TOP,
  artPrismPolygon,
  bodyHitPolygon,
  extrudeDiamond,
  hitTightness,
  inflateToMin,
  legacyFootprintPolygon,
  legacyHitRectPolygon,
  polygonArea,
  polygonBounds,
} from './hitShapes.js'
import { footprintDiamond } from './builtForm.js'
import { CROWD_PITCH_PX } from './crowd.js'
import { ZOOM_STOPS } from './camera.js'
import { ZOOM_MAX, ZOOM_MIN } from './scene.js'

// The v2 sheet the product ships: a 96 px cell whose figure is 64 px tall. figureW/figureH are
// SHEET px throughout; multiplied by the sprite scale they are what the viewer sees.
const FIGURE_H = 64
const FIGURE_W = 32
const SCALE = CHAR_TARGET_PX / FIGURE_H
const DRAWN_H = FIGURE_H * SCALE // 52 screen px
const DRAWN_W = FIGURE_W * SCALE // 26 screen px

const pts = (poly: number[]): [number, number][] =>
  Array.from({ length: poly.length / 2 }, (_, i) => [poly[i * 2]!, poly[i * 2 + 1]!])
const screen = (poly: number[], scale: number): number[] => poly.map((v) => v * scale)

// even-odd point-in-polygon, the same rule Pixi's Polygon.contains uses
function contains(poly: number[], px: number, py: number): boolean {
  const p = pts(poly)
  let inside = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!,
      [xj, yj] = p[j]!
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

describe('bodyHitPolygon — the shape of a person, not the box around them', () => {
  const local = bodyHitPolygon(FIGURE_H, SCALE)
  const world = screen(local, SCALE)

  it('is a closed polygon of eight points', () => {
    expect(local).toHaveLength(16)
    expect(pts(local)).toHaveLength(8)
  })

  it('is shoulder-wide at the torso and stance-wide at the feet', () => {
    const widthAt = (y: number): number => {
      const xs = pts(world)
        .filter(([, py]) => Math.abs(py - y) < 0.001)
        .map(([x]) => x)
      return Math.max(...xs) - Math.min(...xs)
    }
    expect(widthAt(0)).toBe(STANCE_W)
    expect(widthAt(-TORSO_TOP * DRAWN_H)).toBe(SHOULDER_W)
    expect(polygonBounds(world).w).toBe(SHOULDER_W)
  })

  it('contains the body 4 px above the feet', () => {
    expect(contains(world, 0, -4)).toBe(true)
    expect(contains(world, 0, -DRAWN_H / 2)).toBe(true)
  })

  it('does NOT claim the sky 30 px above the head, where the name tag lives', () => {
    expect(contains(world, 0, -(DRAWN_H + 30))).toBe(false)
  })

  it('does NOT reach 26 px sideways at foot height, where a neighbour’s door sits', () => {
    expect(contains(world, 26, 0)).toBe(false)
    expect(contains(world, -26, 0)).toBe(false)
    expect(contains(world, HEAD_W, -2)).toBe(false)
  })

  it('is scale-invariant on screen — Pixi scales hitArea, so the local points divide out', () => {
    // the same DRAWN figure off four differently sized sheets: one capsule on screen
    for (const s of [0.25, 0.5, 1, 2, 4]) {
      const same = screen(bodyHitPolygon(DRAWN_H / s, s), s)
      for (const [i, v] of same.entries()) expect(v, `scale ${s}`).toBeCloseTo(world[i]!, 9)
    }
  })

  it('follows the sheet: a taller figure gets a taller capsule, with no second table', () => {
    const tall = screen(bodyHitPolygon(866, CHAR_TARGET_PX / 866), CHAR_TARGET_PX / 866)
    expect(polygonBounds(tall).h).toBeCloseTo(polygonBounds(world).h, 9)
    const half = screen(bodyHitPolygon(FIGURE_H, SCALE / 2), SCALE / 2)
    expect(polygonBounds(half).h).toBeCloseTo(polygonBounds(world).h / 2, 9)
  })
})

describe('hitTightness — the number U9 is about', () => {
  it('THE DEFECT, measured: the landed 52 × 72 rectangle is 2.77× the silhouette', () => {
    expect([HIT_AREA_W, HIT_AREA_H]).toEqual([52, 72])
    const landed = hitTightness(
      legacyHitRectPolygon(HIT_AREA_W, HIT_AREA_H, SCALE),
      FIGURE_W,
      FIGURE_H,
      SCALE,
    )
    expect(landed).toBeCloseTo(2.7692, 4)
    expect(landed).toBeGreaterThan(HIT_TIGHTNESS_MAX)
  })

  it('THE FIX, measured: the capsule is 0.93× and clears the ratified ceiling', () => {
    const capsule = hitTightness(bodyHitPolygon(FIGURE_H, SCALE), FIGURE_W, FIGURE_H, SCALE)
    expect(capsule).toBeCloseTo(0.93479, 5)
    expect(capsule).toBeLessThan(HIT_TIGHTNESS_MAX)
  })

  it('does not change with the sprite scale, for the same drawn figure', () => {
    for (const s of [0.25, 0.5, 1, 2, 4]) {
      const sheetH = DRAWN_H / s,
        sheetW = DRAWN_W / s
      expect(hitTightness(bodyHitPolygon(sheetH, s), sheetW, sheetH, s), `scale ${s}`).toBeCloseTo(
        0.93479,
        5,
      )
    }
  })
})

describe('inflateToMin — small on screen is still clickable', () => {
  const local = bodyHitPolygon(FIGURE_H, SCALE)

  it('grows a capsule that would be under 24 screen px at the overview stop', () => {
    // at the 0.5 zoom stop the capsule is 14 × 24.4 screen px — too narrow to hit
    const at0 = polygonBounds(screen(local, SCALE * 0.5))
    expect(at0.w).toBeLessThan(HIT_MIN_PX)
    const grown = polygonBounds(screen(inflateToMin(local, HIT_MIN_PX, SCALE * 0.5), SCALE * 0.5))
    expect(grown.w).toBeGreaterThanOrEqual(HIT_MIN_PX)
    expect(grown.h).toBeGreaterThanOrEqual(HIT_MIN_PX)
  })

  it('changes nothing at 4×, so a close-up keeps an honest target', () => {
    expect(inflateToMin(local, HIT_MIN_PX, SCALE * 4)).toEqual(local)
    expect(inflateToMin(local, HIT_MIN_PX, SCALE)).toEqual(local)
  })

  it('grows about the centroid, so the target stays centred on the figure', () => {
    const b = polygonBounds(local)
    const g = polygonBounds(inflateToMin(local, HIT_MIN_PX, 0.1))
    expect(g.cx).toBeCloseTo(b.cx, 9)
    expect(g.cy).toBeCloseTo(b.cy, 9)
  })
})

// `ZOOM_MIN` is 0.5, so the floor is a live product state: every hit class is measured at the
// overview stop rather than assumed to clear it.
describe('the 24 px floor at the new ZOOM_MIN', () => {
  const local = bodyHitPolygon(FIGURE_H, SCALE)

  it('ZOOM_MIN is the bottom of the stop set, and it is 0.25', () => {
    expect(ZOOM_MIN).toBe(0.25)
    expect(ZOOM_MIN).toBe(ZOOM_STOPS[0])
    expect(ZOOM_MAX).toBe(4)
  })

  it('a body capsule clears 24 px in BOTH axes at every stop', () => {
    for (const z of ZOOM_STOPS) {
      const k = SCALE * z
      const b = polygonBounds(screen(inflateToMin(local, HIT_MIN_PX, k), k))
      expect(b.w, `${z}× width`).toBeGreaterThanOrEqual(HIT_MIN_PX - 1e-9)
      expect(b.h, `${z}× height`).toBeGreaterThanOrEqual(HIT_MIN_PX - 1e-9)
    }
  })

  it('a building prism clears 24 px in both axes at every stop, at every art scale', () => {
    for (const z of ZOOM_STOPS) {
      for (const art of [0.125, 0.25, 1]) {
        const poly = inflateToMin(artPrismPolygon(1, 1, art), HIT_MIN_PX, art * z)
        const b = polygonBounds(poly)
        expect(b.w * art * z, `${z}× ${art} width`).toBeGreaterThanOrEqual(HIT_MIN_PX - 1e-9)
        expect(b.h * art * z, `${z}× ${art} height`).toBeGreaterThanOrEqual(HIT_MIN_PX - 1e-9)
      }
    }
  })

  it('★ and the floor is INERT above the stop where the thing is already big enough', () => {
    // a 1×1 shed is 64 world px across: 16 px at 0.25 (grown), 32 px at 0.5 (untouched)
    for (const art of [0.125, 0.25, 1]) {
      const raw = artPrismPolygon(1, 1, art)
      expect(inflateToMin(raw, HIT_MIN_PX, art * 0.25)).not.toEqual(raw)
      for (const z of [0.5, 1, 2, 4])
        expect(inflateToMin(raw, HIT_MIN_PX, art * z), `${z}×`).toEqual(raw)
    }
  })
})

// ── ★ THE STRUCTURE PRISM ─────────────────────────────────────────────────────────────────
//
// The numbers here were measured by decoding every building root and counting opaque pixels.
// They cannot come from `cull.ts`'s AABB: that box is the bounding RECTANGLE of a diamond, so
// its corners are void by construction and a test against it passes with the property broken.

describe('★ a building is a volume, and the landed target was the ground under it', () => {
  const SHAPES: [number, number][] = [
    [1, 1],
    [2, 2],
    [1, 2],
    [2, 1],
    [3, 2],
    [2, 4],
  ]

  it('THE DEFECT: the flat footprint diamond and the drawn sprite barely touch', () => {
    // The art is fitted to a (w+h)·32 SQUARE whose lowest opaque row is the sprite's own anchor,
    // so the drawn body occupies y ∈ [−side, 0] while the ground plan runs from the footprint's
    // north vertex DOWN.
    const flat = legacyFootprintPolygon(footprintDiamond(2, 2), 1)
    expect(polygonBounds(flat)).toEqual({ w: 64, h: 32, cx: 0, cy: 8 })
    const prism = artPrismPolygon(2, 2, 1)
    expect(polygonBounds(prism)).toEqual({ w: 128, h: 128, cx: 0, cy: -64 })
  })

  it('is the drawn cell exactly, with the corners cut off by the diamond', () => {
    for (const [w, h] of SHAPES) {
      const side = (w + h) * BUILDING_UNIT_PX
      const b = polygonBounds(artPrismPolygon(w, h, 1))
      expect([b.w, b.h], `${w}x${h}`).toEqual([side, side])
      // the south vertex is the sprite's own feet point, which is the art's lowest row
      expect(b.cy + b.h / 2, `${w}x${h}`).toBe(0)
      // 0.75 of the box: an axis-aligned rect would claim the other quarter, all of it sky
      expect(polygonArea(artPrismPolygon(w, h, 1)) / (side * side), `${w}x${h}`).toBeCloseTo(
        0.75,
        9,
      )
    }
  })

  it('contains the roof, the wall and the doorway — the places a viewer clicks', () => {
    const p = artPrismPolygon(2, 2, 1) // a 2×2 house: 128 × 128 drawn
    expect(contains(p, 0, -120)).toBe(true) // the ridge
    expect(contains(p, -40, -70)).toBe(true) // the left wall
    expect(contains(p, 30, -70)).toBe(true) // the right wall
    expect(contains(p, 0, -20)).toBe(true) // the doorway, bottom centre
    expect(contains(p, 0, -1)).toBe(true) // the ground contact
  })

  it('★ and it claims NOTHING outside the drawn cell — the corners stay empty sky', () => {
    const p = artPrismPolygon(2, 2, 1)
    for (const [x, y] of [
      [-63, -2],
      [63, -2],
      [-70, -60],
      [70, -60],
      [0, 4],
      [0, -130],
    ] as const) {
      expect(contains(p, x, y), `${x},${y}`).toBe(false)
    }
  })

  it('is scale-invariant on screen — Pixi scales hitArea, so the local points divide out', () => {
    const at1 = artPrismPolygon(2, 2, 1)
    for (const s of [0.125, 0.25, 1, 2]) {
      const same = screen(artPrismPolygon(2, 2, s), s)
      for (const [i, v] of same.entries()) expect(v, `scale ${s}`).toBeCloseTo(at1[i]!, 9)
    }
  })

  it('extrudeDiamond gives the SIX-point silhouette of a solid, not a wireframe box', () => {
    // a 1×1 ground diamond raised 10 px: W, S, E, then back across the raised top
    expect(extrudeDiamond([0, 0, 16, 8, 0, 16, -16, 8], 10)).toEqual([
      -16, 8, 0, 16, 16, 8, 16, -2, 0, -10, -16, -2,
    ])
    // a zero-height extrusion is the diamond's own outline, still six points
    expect(polygonArea(extrudeDiamond([0, 0, 16, 8, 0, 16, -16, 8], 0))).toBeCloseTo(
      polygonArea([0, 0, 16, 8, 0, 16, -16, 8]),
      9,
    )
  })

  it('the tightness is the number U9 ratified, measured against the DRAWN box', () => {
    for (const [w, h] of SHAPES) {
      const side = (w + h) * BUILDING_UNIT_PX
      const t = hitTightness(artPrismPolygon(w, h, 0.25), side / 0.25, side / 0.25, 0.25)
      expect(t, `${w}x${h}`).toBeCloseTo(0.75, 9)
      expect(t).toBeLessThan(HIT_TIGHTNESS_MAX)
    }
  })
})

// ── ★ WHERE ACCURACY AND THE 24 px FLOOR MEET ─────────────────────────────────────────────

describe('★ the floor yields to the neighbour, because the neighbour is the harder case', () => {
  const local = bodyHitPolygon(FIGURE_H, SCALE)

  it('a LONE body still gets the whole 24/z — nothing is capped that has room', () => {
    for (const z of ZOOM_STOPS) {
      const k = SCALE * z
      const b = polygonBounds(screen(inflateToMin(local, HIT_MIN_PX, k, Infinity), k))
      expect(b.w, `${z}×`).toBeGreaterThanOrEqual(HIT_MIN_PX - 1e-9)
    }
  })

  it('★ THE RED: uncapped, five bodies at 14 px pitch become one 24 px target at 0.25', () => {
    const k = SCALE * 0.25
    const wide = polygonBounds(screen(inflateToMin(local, HIT_MIN_PX, k), k)).w
    const pitchOnScreen = CROWD_PITCH_PX * 0.25 // 3.5 screen px between shoulders
    expect(wide).toBeGreaterThanOrEqual(HIT_MIN_PX)
    expect(wide).toBeGreaterThan(pitchOnScreen * 4) // one capsule swallows the whole rank
  })

  it('★ capped at the pitch, a ranked body keeps its OWN width at every stop', () => {
    // The cap binds at every stop by definition: a rank IS a pitch narrower than a body (14 px
    // against 28 px of shoulder), so there is never room to grow sideways into. The HEIGHT still
    // takes the floor — bodies in a rank stand beside each other, not on each other.
    expect(CROWD_PITCH_PX).toBeLessThan(SHOULDER_W)
    for (const z of ZOOM_STOPS) {
      const k = SCALE * z
      const capped = inflateToMin(local, HIT_MIN_PX, k, CROWD_PITCH_PX * z)
      const b = polygonBounds(screen(capped, k))
      expect(b.w, `${z}× width`).toBeCloseTo(SHOULDER_W * z, 9)
      expect(b.h, `${z}× height`).toBeGreaterThanOrEqual(Math.min(HIT_MIN_PX, DRAWN_H * z) - 1e-9)
    }
  })

  it('and the cap never SHRINKS a body that is already wider than the pitch', () => {
    const k = SCALE * 4 // shoulders are 112 screen px at the closest stop
    const raw = polygonBounds(screen(local, k)).w
    const capped = polygonBounds(
      screen(inflateToMin(local, HIT_MIN_PX, k, CROWD_PITCH_PX * 4), k),
    ).w
    expect(capped).toBe(raw)
    expect(raw).toBeCloseTo(SHOULDER_W * 4, 9)
  })
})
