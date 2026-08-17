import { describe, expect, it } from 'vitest'
import { makeCityTemplate } from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import { TILE_H, TILE_W } from './iso.js'
import {
  FIT_MARGIN_PX, STAGE_FILL_MIN,
  WHEEL_GESTURE_GAP_MS, WHEEL_MIN_DELTA, WHEEL_STEP_DELTA, ZOOM_SETTLE_MS, ZOOM_STEP_COOLDOWN_MS,
  ZOOM_STOPS, boundsCentre, cameraBoundsOf, clampCamera, easeOutCubic, fitStop, initialZoom,
  drawnBoundsOf, stageFill, structureBoundsOf, zoomScaleAt, zoomSettled, zoomTo, zoomWheel, type ZoomStop,
} from './camera.js'

// THE LANDED RULE, quoted so the before-state is measured and not remembered
// (scene.ts `onWheel`: one integer step per EVENT, no accumulation, no gate, no animation).
const LANDED_MIN = 1, LANDED_MAX = 4
function landedWheel(events: number): number {
  let z = LANDED_MIN
  for (let i = 0; i < events; i++) z = Math.min(LANDED_MAX, Math.max(LANDED_MIN, z + 1))
  return z
}

/** mulberry32 — a seeded walk, so a random test that fails fails the same way twice */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('the complaint, as a test — "I zoom way too much by accident"', () => {
  it('a thirty-event trackpad flick advances EXACTLY ONE stop', () => {
    // the landed handler takes this to 4 — three stops in one flick, which is U19
    expect(landedWheel(30)).toBe(4)

    let s = initialZoom(1)
    for (let i = 0; i < 30; i++) s = zoomWheel(s, -12, 1000 + i * (100 / 30))
    expect(s.stop).toBe(2)
  })

  it('two deliberate notches 300 ms apart advance two stops', () => {
    let s = initialZoom(1)
    s = zoomWheel(s, -120, 1000)
    s = zoomWheel(s, -120, 1300)
    expect(s.stop).toBe(3)
  })

  it('the same two 50 ms apart advance ONE — the cooldown is the line', () => {
    let s = initialZoom(1)
    s = zoomWheel(s, -120, 1000)
    s = zoomWheel(s, -120, 1050)
    expect(s.stop).toBe(2)
    expect(ZOOM_STEP_COOLDOWN_MS).toBeGreaterThan(50)
  })

  // WHAT THE BROWSER CAUGHT: "one notch is 120" is a convention, not a fact. Chrome commonly
  // reports 100. With a bare 120 threshold and a gesture reset, a real mouse never zoomed at
  // all: every notch was its own gesture, 100 < 120, and the accumulator reset before the next.
  it('ONE NOTCH IS ONE STEP, whatever that mouse calls a notch', () => {
    for (const notch of [53, 100, 120, 240]) {
      expect(zoomWheel(initialZoom(2), -notch, 1000).stop, `${notch}`).toBe(3)
    }
  })

  it('the plan’s bare threshold never zooms a 100-delta mouse AT ALL', () => {
    // the rule as written: accumulate, reset between gestures, step at WHEEL_STEP_DELTA
    const bare = (prev: ReturnType<typeof initialZoom>, dy: number, now: number) => {
      const fresh = now - prev.lastWheelMs > WHEEL_GESTURE_GAP_MS
      const accum = (fresh ? 0 : prev.accum) + dy
      if (Math.abs(accum) < WHEEL_STEP_DELTA) return { ...prev, accum, lastWheelMs: now }
      return zoomWheel(prev, dy, now)
    }
    let plan = initialZoom(1), shipped = initialZoom(1)
    for (let i = 0; i < 5; i++) {
      const t = 1000 + i * 400        // five deliberate notches, well clear of the cooldown
      plan = bare(plan, -100, t)
      shipped = zoomWheel(shipped, -100, t)
    }
    expect(plan.stop).toBe(1)         // never moved. RED.
    expect(shipped.stop).toBe(4)
  })

  it('a graze under the dead zone accumulates but never steps', () => {
    let s = initialZoom(2)
    for (let i = 0; i < 5; i++) {
      s = zoomWheel(s, -(WHEEL_MIN_DELTA - 1), 1000 + i * (WHEEL_GESTURE_GAP_MS + 10))
      expect(s.stop).toBe(2)
    }
  })

  it('a gesture that has gone quiet starts its accumulator clean', () => {
    let s = initialZoom(2)
    s = zoomWheel(s, -4, 1000)                                // under the dead zone
    s = zoomWheel(s, -4, 1000 + WHEEL_GESTURE_GAP_MS + 1)     // a NEW gesture, not the old one's tail
    expect(Math.abs(s.accum)).toBe(4)
    expect(s.stop).toBe(2)
  })

  it('deltaY 0 is not an event at all', () => {
    const s = initialZoom(2)
    expect(zoomWheel(s, 0, 9999)).toBe(s)
  })

  it('scrolling down zooms out, scrolling up zooms in', () => {
    expect(zoomWheel(initialZoom(2), -WHEEL_STEP_DELTA, 1000).stop).toBe(3)
    expect(zoomWheel(initialZoom(2), WHEEL_STEP_DELTA, 1000).stop).toBe(1)
  })
})

describe('the transit — damped, and exact at rest', () => {
  const s = zoomTo(initialZoom(1), 4, 1000)

  it('leaves from where it was and arrives EXACTLY on the stop', () => {
    expect(zoomScaleAt(s, 1000)).toBe(1)
    expect(zoomScaleAt(s, 1000 + ZOOM_SETTLE_MS)).toBe(4)
    expect(zoomScaleAt(s, 1000 + ZOOM_SETTLE_MS + 10_000)).toBe(4)
    expect(zoomScaleAt(s, 900)).toBe(1)                  // a clock that ran backwards
  })

  it('is continuous and monotonic across the whole transit', () => {
    let prev = -Infinity
    for (let t = 0; t <= ZOOM_SETTLE_MS; t += 1) {
      const v = zoomScaleAt(s, 1000 + t)
      expect(v).toBeGreaterThanOrEqual(prev)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(4)
      prev = v
    }
  })

  it('eases out — it is more than half way at half the time', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
  })

  it('settles at ZOOM_SETTLE_MS, not before', () => {
    expect(zoomSettled(s, 1000 + ZOOM_SETTLE_MS - 1)).toBe(false)
    expect(zoomSettled(s, 1000 + ZOOM_SETTLE_MS)).toBe(true)
    expect(ZOOM_SETTLE_MS).toBeGreaterThanOrEqual(150)   // the UI mandate's motion band
    expect(ZOOM_SETTLE_MS).toBeLessThanOrEqual(300)
  })

  it('a reversal mid-transit leaves from the CURRENT scale, so the camera never jumps', () => {
    const mid = zoomScaleAt(s, 1090)
    expect(mid).toBeGreaterThan(1)
    expect(mid).toBeLessThan(4)
    const back = zoomWheel({ ...s, lastStepMs: 0 }, WHEEL_STEP_DELTA, 1090)
    expect(back.from).toBe(mid)
    expect(zoomScaleAt(back, 1090)).toBe(mid)
  })
})

describe('the stop set is never left', () => {
  it('holds at 0.5 however far out you scroll, and at 4 however far in', () => {
    let out = initialZoom(0.5)
    for (let i = 0; i < 50; i++) out = zoomWheel(out, WHEEL_STEP_DELTA, 1000 + i * 1000)
    expect(out.stop).toBe(0.5)

    let inn = initialZoom(4)
    for (let i = 0; i < 50; i++) inn = zoomWheel(inn, -WHEEL_STEP_DELTA, 1000 + i * 1000)
    expect(inn.stop).toBe(4)
  })

  it('never settles on a scale outside ZOOM_STOPS, over a 500-event seeded walk', () => {
    const r = rng(0xc12a3)
    let s = initialZoom(1)
    let now = 1000
    for (let i = 0; i < 500; i++) {
      now += Math.floor(r() * 400)
      s = zoomWheel(s, (r() < 0.5 ? -1 : 1) * Math.floor(r() * 200), now)
      expect(ZOOM_STOPS as readonly number[]).toContain(s.stop)
      expect(zoomScaleAt(s, now + ZOOM_SETTLE_MS)).toBe(s.stop)
    }
  })

  it('0.5 is in the set, and it is the reciprocal of an integer so NEAREST samples exactly', () => {
    expect(ZOOM_STOPS[0]).toBe(0.5)
    expect(ZOOM_STOPS.at(-1)).toBe(4)
    for (const z of ZOOM_STOPS) expect(Number.isInteger(z) || Number.isInteger(1 / z)).toBe(true)
    // and the set is strictly increasing, so an index step is always a zoom step
    for (let i = 1; i < ZOOM_STOPS.length; i++) expect(ZOOM_STOPS[i]!).toBeGreaterThan(ZOOM_STOPS[i - 1]!)
  })

  it('zoomTo lands on a named stop and starts from where the camera actually is', () => {
    const mid = zoomTo(initialZoom(1), 4, 1000)
    const jumped = zoomTo(mid, 2 as ZoomStop, 1090)
    expect(jumped.stop).toBe(2)
    expect(jumped.from).toBe(zoomScaleAt(mid, 1090))
  })
})

describe('every function is pure', () => {
  it('same inputs, same outputs — twice', () => {
    const s = initialZoom(2)
    expect(zoomWheel(s, -130, 1000)).toEqual(zoomWheel(s, -130, 1000))
    expect(zoomTo(s, 4, 1000)).toEqual(zoomTo(s, 4, 1000))
    expect(zoomScaleAt(s, 1000)).toBe(zoomScaleAt(s, 1000))
    expect(initialZoom()).toEqual(initialZoom())
  })

  it('does not mutate the state it was given', () => {
    const s = initialZoom(2)
    const before = { ...s }
    zoomWheel(s, -300, 5000)
    zoomTo(s, 4, 5000)
    expect(s).toEqual(before)
  })
})

// ── TASK 76: the camera knows the edges, and there is a view of the whole town (U19, R8) ──

const terrainOf = (w: number, h: number): TileId[][] =>
  Array.from({ length: h }, () => Array.from({ length: w }, () => 0 as TileId))

/** The task-59 town, rebuilt from the template at the gateway's showcase anchor — the same
 *  eleven buildings `occlusion.test.ts` measures U8 against, so the two agree by construction
 *  rather than by a pasted number. */
const ANCHOR = { x: 0, y: 9 }        // gateway SHOWCASE_ANCHOR
const TOWN = makeCityTemplate(ANCHOR).structures.map((s) => ({
  x: ANCHOR.x + s.dx, y: ANCHOR.y + s.dy, w: s.w, h: s.h,
}))
const TOWN_BOX = structureBoundsOf(TOWN)          // the ground it stands on
const TOWN_DRAWN = drawnBoundsOf(TOWN)            // what a viewer actually sees
const STAGE = { w: 1728, h: 880 }

describe('cameraBoundsOf — the world box, exactly', () => {
  it('is the dimetric extent of the terrain array', () => {
    const b = cameraBoundsOf(terrainOf(48, 48))
    expect(b.minX).toBe(-48 * (TILE_W / 2))
    expect(b.maxX).toBe(48 * (TILE_W / 2))
    expect(b.minY).toBe(0)
    expect(b.maxY).toBe((48 + 48) * (TILE_H / 2))
  })

  it('handles a non-square map, and an empty one without throwing', () => {
    const b = cameraBoundsOf(terrainOf(64, 16))
    expect(b.minX).toBe(-16 * (TILE_W / 2))
    expect(b.maxX).toBe(64 * (TILE_W / 2))
    expect(b.maxY).toBe((64 + 16) * (TILE_H / 2))
    expect(() => cameraBoundsOf([])).not.toThrow()
  })

  it('structureBoundsOf gives the settlement its own box, in the same space', () => {
    const b = structureBoundsOf(TOWN)
    expect(b.minX).toBeLessThan(b.maxX)
    expect(b.minY).toBeLessThan(b.maxY)
    expect(structureBoundsOf([])).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 })
  })
})

describe('clampCamera — the town cannot be lost off the edge', () => {
  const bounds = cameraBoundsOf(terrainOf(48, 48))

  it('THE DEFECT: nothing clamped, so one drag pushed the world off the screen', () => {
    // scene.panBy added pixels without bound; this is that position, and where it should land
    const runaway = { x: 99_999, y: -99_999 }
    const legal = clampCamera(runaway, 4, bounds, STAGE)
    expect(legal).not.toEqual(runaway)
    expect(legal.x).toBeLessThanOrEqual(-bounds.minX * 4 + 1e-9)
    expect(legal.y).toBeGreaterThanOrEqual(STAGE.h - bounds.maxY * 4 - 1e-9)
  })

  it('refuses a position that would show blank, and returns the NEAREST legal one', () => {
    const legal = clampCamera({ x: -100_000, y: 0 }, 4, bounds, STAGE)
    expect(legal.x).toBeCloseTo(STAGE.w - bounds.maxX * 4, 9)
  })

  it('CENTRES instead of clamping when the world is smaller than the viewport', () => {
    const small = cameraBoundsOf(terrainOf(8, 8))
    const a = clampCamera({ x: 5000, y: -5000 }, 0.5, small, STAGE)
    const b = clampCamera({ x: -5000, y: 5000 }, 0.5, small, STAGE)
    expect(a).toEqual(b)
    expect(a.x).toBeCloseTo((STAGE.w - (small.minX + small.maxX) * 0.5) / 2, 9)
    expect(clampCamera(a, 0.5, small, STAGE)).toEqual(a)      // idempotent
  })

  it('is idempotent at every stop', () => {
    for (const z of ZOOM_STOPS) {
      const once = clampCamera({ x: 12_345, y: -6_789 }, z, bounds, STAGE)
      expect(clampCamera(once, z, bounds, STAGE), `${z}`).toEqual(once)
    }
  })

  it('a 500-step random pan walk never shows the outside of the world', () => {
    const r = rng(0x76)
    let pos = clampCamera({ x: 0, y: 0 }, 2, bounds, STAGE)
    for (let i = 0; i < 500; i++) {
      pos = clampCamera(
        { x: pos.x + (r() - 0.5) * 900, y: pos.y + (r() - 0.5) * 900 }, 2, bounds, STAGE,
      )
      expect(-pos.x / 2).toBeGreaterThanOrEqual(bounds.minX - 1e-6)
      expect((-pos.x + STAGE.w) / 2).toBeLessThanOrEqual(bounds.maxX + 1e-6)
      expect(-pos.y / 2).toBeGreaterThanOrEqual(bounds.minY - 1e-6)
      expect((-pos.y + STAGE.h) / 2).toBeLessThanOrEqual(bounds.maxY + 1e-6)
    }
  })
})

describe('fitStop — a view of the whole thing, with a margin', () => {
  it('is the largest stop at which the box fits inside the stage minus the margin', () => {
    const town = TOWN_DRAWN
    const at = fitStop(town, STAGE)
    const w = (town.maxX - town.minX) * at, h = (town.maxY - town.minY) * at
    expect(w).toBeLessThanOrEqual(STAGE.w - 2 * FIT_MARGIN_PX)
    expect(h).toBeLessThanOrEqual(STAGE.h - 2 * FIT_MARGIN_PX)
    const bigger = ZOOM_STOPS[ZOOM_STOPS.indexOf(at) + 1]
    if (bigger !== undefined) {
      expect((town.maxX - town.minX) * bigger > STAGE.w - 2 * FIT_MARGIN_PX
        || (town.maxY - town.minY) * bigger > STAGE.h - 2 * FIT_MARGIN_PX).toBe(true)
    }
  })

  it('the 48x48 world fits at 1x; a 128x128 world does not fit at all and takes the floor', () => {
    expect(fitStop(cameraBoundsOf(terrainOf(48, 48)), STAGE)).toBe(1)
    expect(fitStop(cameraBoundsOf(terrainOf(128, 128)), STAGE)).toBe(0.5)
  })

  it('never leaves the stop set, and never returns a stop that does not exist', () => {
    for (const [w, h] of [[320, 240], [1728, 880], [4000, 3000]] as const) {
      for (const n of [4, 16, 48, 128, 512]) {
        expect(ZOOM_STOPS as readonly number[])
          .toContain(fitStop(cameraBoundsOf(terrainOf(n, n)), { w, h }))
      }
    }
  })
})

describe('stageFill — the number R8 is about', () => {
  it('THE R8 ASSERTION: the landed first frame is far below the floor', () => {
    // eleven buildings across tiles x 5..28, y 13..31: 528 x 256 px of GROUND, and
    // 584 x 376 px as DRAWN, because a sprite overhangs the ground it stands on
    expect(TOWN_BOX).toEqual({ minX: -352, maxX: 176, minY: 208, maxY: 464 })
    expect(TOWN_DRAWN).toEqual({ minX: -376, maxX: 208, minY: 96, maxY: 472 })
    // the landed first frame: scale 1, centred on the middle of a 48x48 grid
    const landed = stageFill(TOWN_DRAWN, 1, STAGE)
    expect(landed).toBeLessThan(STAGE_FILL_MIN)
    expect(landed).toBeCloseTo(0.1444, 4)    // 14.4% — the audit's "under 15%", reproduced
  })

  it('and the first frame clears it once the camera fits the TOWN', () => {
    const at = fitStop(TOWN_DRAWN, STAGE)
    expect(at).toBe(2)
    expect(stageFill(TOWN_DRAWN, at, STAGE)).toBeGreaterThanOrEqual(STAGE_FILL_MIN)
    expect(stageFill(TOWN_DRAWN, at, STAGE)).toBeCloseTo(0.5776, 4)
  })

  // WHAT THE BROWSER CAUGHT: fitting the FOOTPRINT box put the camera at 3x and cut the roofs
  // off the top and the right of the stage.
  it('fitting the footprint instead of the drawing overshoots by a whole stop', () => {
    expect(fitStop(TOWN_BOX, STAGE)).toBe(3)
    expect(fitStop(TOWN_DRAWN, STAGE)).toBe(2)
    const overshoot = 3
    expect((TOWN_DRAWN.maxY - TOWN_DRAWN.minY) * overshoot)
      .toBeGreaterThan(STAGE.h - 2 * FIT_MARGIN_PX)     // the roofs, off the stage. RED.
  })

  it('a drawn box is taller and wider than the ground under it', () => {
    expect(TOWN_DRAWN.maxY - TOWN_DRAWN.minY).toBeGreaterThan(TOWN_BOX.maxY - TOWN_BOX.minY)
    expect(TOWN_DRAWN.maxX - TOWN_DRAWN.minX).toBeGreaterThan(TOWN_BOX.maxX - TOWN_BOX.minX)
    expect(TOWN_DRAWN.minY).toBeLessThan(TOWN_BOX.minY)   // the overhang is upward
    expect(drawnBoundsOf([])).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 })
  })

  it('is an area fraction, and it is 0 for a settlement with no extent', () => {
    expect(stageFill({ minX: 0, maxX: 0, minY: 0, maxY: 0 }, 4, STAGE)).toBe(0)
    expect(stageFill({ minX: 0, maxX: 100, minY: 0, maxY: 100 }, 1, { w: 200, h: 200 }))
      .toBeCloseTo(0.25, 9)
  })

  it('boundsCentre is the middle of the box, so the first frame is OF the town', () => {
    expect(boundsCentre(TOWN_BOX)).toEqual({ sx: -88, sy: 336 })
    // the landed first frame centred on the middle of a 48x48 grid, which is not the town
    const landed = boundsCentre(cameraBoundsOf(terrainOf(48, 48)))
    expect(landed).not.toEqual(boundsCentre(TOWN_BOX))
  })
})
