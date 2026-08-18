import { describe, expect, it } from 'vitest'
import { CHAR_TARGET_PX, HIT_AREA_H, HIT_AREA_W } from './charAnim.js'
import {
  HEAD_W, HIT_MIN_PX, HIT_TIGHTNESS_MAX, SHOULDER_W, STANCE_W, TORSO_TOP, bodyHitPolygon,
  doorLocalRect, hitTightness, inflateToMin, legacyHitRectPolygon, polygonBounds,
} from './hitShapes.js'
import { ZOOM_STOPS } from './camera.js'
import { ZOOM_MAX, ZOOM_MIN } from './scene.js'

// The v2 sheet the product ships: a 96 px cell whose figure is 64 px tall, drawn at
// CHAR_TARGET_PX. figureW/figureH are SHEET px throughout; multiplied by the sprite scale
// they are what the viewer sees — 26 × 52 screen px.
const FIGURE_H = 64
const FIGURE_W = 32
const SCALE = CHAR_TARGET_PX / FIGURE_H
const DRAWN_H = FIGURE_H * SCALE      // 52 screen px
const DRAWN_W = FIGURE_W * SCALE      // 26 screen px

const pts = (poly: number[]): Array<[number, number]> =>
  Array.from({ length: poly.length / 2 }, (_, i) => [poly[i * 2]!, poly[i * 2 + 1]!])
const screen = (poly: number[], scale: number): number[] => poly.map((v) => v * scale)

// even-odd point-in-polygon, the same rule Pixi's Polygon.contains uses
function contains(poly: number[], px: number, py: number): boolean {
  const p = pts(poly)
  let inside = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!, [xj, yj] = p[j]!
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
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
      const xs = pts(world).filter(([, py]) => Math.abs(py - y) < 0.001).map(([x]) => x)
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
    const landed = hitTightness(legacyHitRectPolygon(HIT_AREA_W, HIT_AREA_H, SCALE), FIGURE_W, FIGURE_H, SCALE)
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
      const sheetH = DRAWN_H / s, sheetW = DRAWN_W / s
      expect(hitTightness(bodyHitPolygon(sheetH, s), sheetW, sheetH, s), `scale ${s}`)
        .toBeCloseTo(0.93479, 5)
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

// TASK 75 MAKES THE FLOOR LIVE. `ZOOM_MIN` was 1, where every target already cleared 24 px,
// so `inflateToMin` shipped unexercised. The 0.5 overview stop is a real product state now,
// and every hit class has to be measured there rather than assumed.
describe('the 24 px floor at the new ZOOM_MIN', () => {
  const local = bodyHitPolygon(FIGURE_H, SCALE)
  const FOOTPRINT = { w: 1, h: 1 }
  const ART = 0.25   // a hi-res building sprite's applied scale

  it('ZOOM_MIN is the bottom of the stop set, and it is 0.5', () => {
    expect(ZOOM_MIN).toBe(0.5)
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

  it('THE DEFECT THE NEW STOP CREATES: a zoom-blind door target is 12 px at 0.5', () => {
    // the landed rule floors at HIT_MIN_PX in WORLD px, which halves on screen at 0.5
    const blind = doorLocalRect(FOOTPRINT, ART)
    expect(blind.w * ART * 0.5).toBeCloseTo(HIT_MIN_PX / 2, 9)   // 12 px. RED.
    expect(blind.w * ART * 0.5).toBeLessThan(HIT_MIN_PX)
  })

  it('a door target clears 24 px in both axes at every stop, at every art scale', () => {
    for (const z of ZOOM_STOPS) {
      for (const art of [0.125, 0.25, 1]) {
        const r = doorLocalRect(FOOTPRINT, art, z)
        expect(r.w * art * z, `${z}× ${art} width`).toBeGreaterThanOrEqual(HIT_MIN_PX - 1e-9)
        expect(r.h * art * z, `${z}× ${art} height`).toBeGreaterThanOrEqual(HIT_MIN_PX - 1e-9)
      }
    }
  })

  it('nothing above 1× changed — the door is the size batch 2 measured', () => {
    for (const z of [1, 2, 3, 4] as const) {
      expect(doorLocalRect(FOOTPRINT, ART, z)).toEqual(doorLocalRect(FOOTPRINT, ART))
    }
  })
})
