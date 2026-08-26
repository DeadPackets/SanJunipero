import { describe, expect, it } from 'vitest'
import { makeCityTemplate } from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import { TILE_H, TILE_W } from './iso.js'
import {
  FIT_MARGIN_PX, ZOOM_STOP_MAX_RATIO,
  WHEEL_GESTURE_GAP_MS, WHEEL_PX_PER_OCTAVE, PINCH_PX_PER_OCTAVE, ZOOM_COMMIT_OCTAVES,
  ZOOM_LIVE_QUANTUM, ZOOM_SETTLE_MS,
  ZOOM_STOPS, boundsCentre, boxAspect, cameraBoundsOf, clampCamera, easeOutCubic, fitStop, fitsAt,
  initialZoom, drawnBoundsOf, nearestStop, quantiseScale, resizeIntent, stageFill,
  stageFillCeiling, stageFillFloor,
  structureBoundsOf, tooBigToFit, zoomGestureEnded, zoomRelease, zoomScaleAt, zoomSettled, zoomTo,
  zoomWheel, type ZoomState, type ZoomStop,
} from './camera.js'
import { CHUNK_PX_H, CHUNK_PX_W } from './groundChunks.js'
import { boxInView, type ViewRect } from './cull.js'
import { structureDepthBox, type DepthBox } from './depth.js'
import { bigTown } from './bigTown.js'

/** The AABB the renderer will actually paint, margin excluded — the same predicate `cull.test.ts` sweeps with. */
function drawnIntersectsView(b: DepthBox, v: ViewRect): boolean {
  return b.sx1 >= v.x && b.sx0 <= v.x + v.w && b.sy1 >= v.y && b.sy0 <= v.y + v.h
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

// ── THE ZOOM: CONTINUOUS UNDER THE HAND, EXACT THE MOMENT IT LETS GO ──────────────────────
// The superseded rule, kept as a function so the before-state is measured rather than remembered.
const LANDED_COOLDOWN_MS = 200, LANDED_STEP_DELTA = 120, LANDED_GAP_MS = 140, LANDED_MIN_DELTA = 8
function landedLadder(events: ReadonlyArray<{ dy: number; at: number }>, from: number): number {
  const idx = (z: number): number => ZOOM_STOPS.indexOf(z as ZoomStop)
  let stop = from, accum = 0, lastWheel = -Infinity, lastStep = -Infinity
  for (const e of events) {
    const fresh = e.at - lastWheel > LANDED_GAP_MS
    accum = (fresh ? 0 : accum) + e.dy
    const wants = (fresh && Math.abs(e.dy) >= LANDED_MIN_DELTA) || Math.abs(accum) >= LANDED_STEP_DELTA
    lastWheel = e.at
    if (e.at - lastStep < LANDED_COOLDOWN_MS || !wants) continue
    stop = ZOOM_STOPS[Math.min(ZOOM_STOPS.length - 1, Math.max(0, idx(stop) + (accum < 0 ? 1 : -1)))]!
    accum = 0; lastStep = e.at
  }
  return stop
}

/** One gesture, delivered as `n` events of `dy` spaced `gapMs` apart, then the hand lifts. */
function gesture(
  from: ZoomStop, n: number, dy: number, gapMs: number, opts: { pinch?: boolean } = {},
): { state: ZoomState; events: Array<{ dy: number; at: number }>; endMs: number } {
  let s = initialZoom(from)
  const events: Array<{ dy: number; at: number }> = []
  let t = 1000
  for (let i = 0; i < n; i++) {
    events.push({ dy, at: t })
    s = zoomWheel(s, dy, t, opts.pinch)
    t += gapMs
  }
  const endMs = t + WHEEL_GESTURE_GAP_MS + 1
  return { state: zoomRelease(s, endMs), events, endMs }
}

describe('★ the complaint, as a test — "zooming is very hard to control"', () => {
  it('★ THE DEFECT: what the camera did depended on how LONG the gesture took, not how FAR', () => {
    // one trackpad gesture, 34 events, 322 px of deltaY — the SAME hand distance both times
    const shape = (i: number): number => -(i < 4 ? 2 + i * 3 : i < 24 ? 12 : Math.max(1, 12 - (i - 24) * 1.5))
    const at = (span: number) => Array.from({ length: 34 }, (_, i) => ({ dy: shape(i), at: 1000 + i * (span / 34) }))
    const total = at(300).reduce((s, e) => s + e.dy, 0)
    expect(Math.round(total)).toBe(-322)

    expect(landedLadder(at(300), 1)).toBe(2)       // fast: ONE rung, 22 of 34 events swallowed
    expect(landedLadder(at(1400), 1)).toBe(3)      // slow: THREE rungs, from the same hand
    // and five deliberate mouse notches, 500 px in 360 ms, moved it TWO rungs — three of the
    // five were eaten by the cooldown, which is why a brisk hand on a wheel feels dead
    expect(landedLadder([0, 1, 2, 3, 4].map((i) => ({ dy: -100, at: 1000 + i * 90 })), 1)).toBe(3)
    // the same five notches now go by distance: 500 px is 2.27 octaves, 1 -> 4 and clamped
    let m = initialZoom(1)
    for (let i = 0; i < 5; i++) m = zoomWheel(m, -100, 1000 + i * 90)
    expect(zoomRelease(m, 1000 + 4 * 90 + WHEEL_GESTURE_GAP_MS + 1).stop).toBe(4)
  })

  it('★ THE FIX: the same hand distance lands in the same place however it is paced', () => {
    const spans = [200, 400, 900, 1400]
    const landed = spans.map((sp) => {
      let s = initialZoom(1)
      let t = 1000
      for (let i = 0; i < 34; i++) { s = zoomWheel(s, -9.47, t); t += sp / 34 }
      return zoomRelease(s, t + WHEEL_GESTURE_GAP_MS + 1).stop
    })
    // every pacing of the same ~322 px lands on ONE stop, and it is not the ladder's end
    expect(new Set(landed).size).toBe(1)
    expect(landed[0]).toBe(3)
  })

  it('the live scale is proportional to the delta, in LOG space, wherever you start from', () => {
    // an octave of push is a factor of two, from 0.25 as from 2
    for (const from of [0.25, 0.5, 1, 2] as ZoomStop[]) {
      const s = zoomWheel(initialZoom(from), -WHEEL_PX_PER_OCTAVE, 1000)
      expect(s.live! / from).toBeCloseTo(2, 2)
    }
  })

  it('A NOTCH ALWAYS MOVES, whatever that mouse calls a notch — the landed guarantee, kept', () => {
    // "One notch is 120" is a convention, not a fact: Chrome commonly reports 100 and some mice
    // 53, which is 0.24 of an octave — nearest-stop alone would snap that straight back.
    for (const notch of [53, 100, 120]) {
      expect(gesture(2, 1, -notch, 0).state.stop, `in ${notch}`).toBe(3)
      expect(gesture(2, 1, notch, 0).state.stop, `out ${notch}`).toBe(1)
    }
    // A mouse that reports 240 per notch is pushing twice as hard and gets twice as much.
    // That is the point of a proportional response and it is stated rather than hidden.
    expect(gesture(2, 1, -240, 0).state.stop).toBe(4)
    for (const notch of [53, 100, 120, 240]) {
      expect(gesture(2, 1, -notch, 0).state.stop, `moves ${notch}`).toBeGreaterThan(2)
    }
  })

  it('★ A PINCH ZOOMS. The 40 px pinch that moved the camera NOT AT ALL now moves a rung', () => {
    // Chrome delivers a macOS trackpad pinch as a wheel event with ctrlKey and 1-3 px deltas.
    const asPinch = gesture(1, 40, -1, 8, { pinch: true })
    expect(landedLadder(asPinch.events, 1)).toBe(1)              // the landed rule: NOTHING
    expect(asPinch.state.stop).toBe(2)                           // now: one rung in
  })

  it('★ and a PINCH is not a SCROLL — the same delta means more from a pinching hand', () => {
    // 180 px, not 40: at 40 `ZOOM_COMMIT_OCTAVES` carries either one rung, so the guard would
    // pass with the ctrlKey flag ignored entirely.
    expect(PINCH_PX_PER_OCTAVE).toBeLessThan(WHEEL_PX_PER_OCTAVE)
    const big = 180
    expect(gesture(1, big, -1, 6, { pinch: true }).state.stop).toBe(4)   // 2 octaves
    expect(gesture(1, big, -1, 6).state.stop).toBe(2)                    // 0.82 of one
    // stated as the ratio, so a retune of either constant keeps the two apart
    expect(gesture(1, big, -1, 6, { pinch: true }).state.stop)
      .toBeGreaterThan(gesture(1, big, -1, 6).state.stop)
  })

  it('a graze is not a gesture: under the commit threshold the camera goes back where it was', () => {
    const tiny = ZOOM_COMMIT_OCTAVES * WHEEL_PX_PER_OCTAVE * 0.5
    const g = gesture(2, 1, -tiny, 0)
    expect(g.state.stop).toBe(2)
    expect(zoomScaleAt(g.state, g.endMs + ZOOM_SETTLE_MS)).toBe(2)
  })

  it('a push and an equal push back return to the stop they started from', () => {
    let s = initialZoom(1)
    let t = 1000
    for (let i = 0; i < 20; i++) { s = zoomWheel(s, -15, t); t += 8 }
    const out = zoomRelease(s, t + WHEEL_GESTURE_GAP_MS + 1)
    expect(out.stop).not.toBe(1)
    let b = out
    t += 400
    for (let i = 0; i < 20; i++) { b = zoomWheel(b, 15, t); t += 8 }
    expect(zoomRelease(b, t + WHEEL_GESTURE_GAP_MS + 1).stop).toBe(1)
  })

  it('deltaY 0 is not an event at all', () => {
    const s = initialZoom(2)
    expect(zoomWheel(s, 0, 9999)).toBe(s)
  })

  it('scrolling down zooms out, scrolling up zooms in', () => {
    expect(zoomWheel(initialZoom(2), -100, 1000).live!).toBeGreaterThan(2)
    expect(zoomWheel(initialZoom(2), 100, 1000).live!).toBeLessThan(2)
  })
})

describe('★ the resting frame is EXACT — P18 is untouched by a continuous gesture', () => {
  it('every stop is a multiple of the live quantum, so a release is never a rounding', () => {
    for (const z of ZOOM_STOPS) expect(Number.isInteger(z / ZOOM_LIVE_QUANTUM)).toBe(true)
  })

  it('★ the quantum keeps a GROUND CHUNK a whole number of screen pixels at ANY live scale', () => {
    // read off the render lane's own constants, so a chunk that changes shape turns this red
    // rather than opening a hairline seam nobody is looking for
    expect(Number.isInteger(CHUNK_PX_W * ZOOM_LIVE_QUANTUM)).toBe(true)
    expect(Number.isInteger(CHUNK_PX_H * ZOOM_LIVE_QUANTUM)).toBe(true)
    // and therefore every scale the gesture can produce keeps both whole
    const r = rng(0x5eed)
    for (let i = 0; i < 400; i++) {
      const z = quantiseScale(0.25 + r() * 3.75)
      expect(Number.isInteger(Math.round(CHUNK_PX_W * z * 1e6) / 1e6), `w at ${z}`).toBe(true)
      expect(Number.isInteger(Math.round(CHUNK_PX_H * z * 1e6) / 1e6), `h at ${z}`).toBe(true)
    }
  })

  it('never rests off the ladder, over a 500-gesture seeded walk with real releases', () => {
    const r = rng(0xc12a3)
    let s = initialZoom(1)
    let now = 1000
    for (let i = 0; i < 500; i++) {
      const events = 1 + Math.floor(r() * 20)
      const dy = (r() < 0.5 ? -1 : 1) * (1 + Math.floor(r() * 140))
      for (let e = 0; e < events; e++) { now += 4 + Math.floor(r() * 30); s = zoomWheel(s, dy, now, r() < 0.3) }
      now += WHEEL_GESTURE_GAP_MS + 1
      s = zoomRelease(s, now)
      expect(ZOOM_STOPS as readonly number[]).toContain(s.stop)
      expect(zoomScaleAt(s, now + ZOOM_SETTLE_MS)).toBe(s.stop)
      expect(zoomSettled(s, now + ZOOM_SETTLE_MS)).toBe(true)
      now += Math.floor(r() * 600)
    }
  })

  it('a gesture in flight is NEVER settled, however long the hand holds it', () => {
    const s = zoomWheel(initialZoom(1), -40, 1000)
    expect(s.live).not.toBeNull()
    expect(zoomSettled(s, 1000 + 60_000)).toBe(false)
    expect(zoomScaleAt(s, 1000 + 60_000)).toBe(s.live)
  })

  it('holds at the floor however far out you push, and at the ceiling however far in', () => {
    expect(gesture(ZOOM_STOPS[0], 40, 200, 8).state.stop).toBe(ZOOM_STOPS[0])
    expect(gesture(4, 40, -200, 8).state.stop).toBe(4)
    // and the live scale is clamped too, so the world never scales past the ladder
    let s = initialZoom(4)
    for (let i = 0; i < 40; i++) s = zoomWheel(s, -200, 1000 + i * 8)
    expect(s.live).toBe(4)
  })

  it('the floor is a reciprocal of an integer, so NEAREST samples exactly', () => {
    expect(ZOOM_STOPS[0]).toBe(0.25)
    expect(ZOOM_STOPS.at(-1)).toBe(4)
    for (const z of ZOOM_STOPS) expect(Number.isInteger(z) || Number.isInteger(1 / z)).toBe(true)
    for (let i = 1; i < ZOOM_STOPS.length; i++) expect(ZOOM_STOPS[i]!).toBeGreaterThan(ZOOM_STOPS[i - 1]!)
  })
})

// ── WHAT A LONGER FRACTIONAL WINDOW DOES TO THE CULL AND THE SEAMS ────────────────────────
// The cull never sees the zoom: it is handed a view RECTANGLE in world space, so a fractional
// scale is the same float arithmetic on different numbers. Proved here rather than argued.
describe('★ the cull holds at every scale a gesture passes through', () => {
  const boxes = bigTown(2).map((s) => structureDepthBox(s.id, s))
  const STAGE_PX = { w: 1728, h: 824 }
  const viewAt = (z: number, camX: number, camY: number): ViewRect =>
    ({ x: -camX / z, y: -camY / z, w: STAGE_PX.w / z, h: STAGE_PX.h / z })

  it('nothing pops at a fractional scale, swept across a two-ring town', () => {
    const offenders: string[] = []
    // every scale the gesture can rest a frame on between two stops, at 1/32-octave steps
    for (let oct = -2; oct <= 2; oct += 1 / 32) {
      const z = quantiseScale(Math.pow(2, oct))
      for (let camX = -2400; camX <= 2400; camX += 311) {
        const view = viewAt(z, camX, camX / 2)
        for (const b of boxes) {
          if (drawnIntersectsView(b, view) && !boxInView(b, view)) offenders.push(`${b.id} z=${z}`)
        }
      }
    }
    expect(offenders.slice(0, 5), `${offenders.length} pops`).toEqual([])
  })

  it('the drawn count moves smoothly with the scale — no cliff between two stops', () => {
    const drawnAt = (z: number): number =>
      boxes.filter((b) => boxInView(b, viewAt(z, -400, -900))).length
    // walking 1 -> 2 in 32 steps, no single step may change the drawn set by more than the
    // whole 1 -> 2 change: a cliff would be the cull disagreeing with itself mid-gesture
    const span = Math.abs(drawnAt(1) - drawnAt(2))
    let worst = 0
    for (let i = 0; i < 32; i++) {
      const a = drawnAt(quantiseScale(Math.pow(2, i / 32)))
      const b = drawnAt(quantiseScale(Math.pow(2, (i + 1) / 32)))
      worst = Math.max(worst, Math.abs(a - b))
    }
    expect(worst).toBeLessThanOrEqual(span)
  })

  it('★ a ground chunk lands on whole screen pixels at every one of those scales', () => {
    // A chunk boundary sits at `n · CHUNK_PX_W · z` from the bake origin; if that is an integer
    // for every n, every chunk carries the same fractional part and `roundPixels` rounds alike.
    let worst = 0
    for (let oct = -2; oct <= 2; oct += 1 / 64) {
      const z = quantiseScale(Math.pow(2, oct))
      for (let n = 0; n <= 13; n++) {
        worst = Math.max(worst,
          Math.abs(n * CHUNK_PX_W * z - Math.round(n * CHUNK_PX_W * z)),
          Math.abs(n * CHUNK_PX_H * z - Math.round(n * CHUNK_PX_H * z)))
      }
    }
    expect(worst).toBeLessThan(1e-9)
  })

  it('and an UNQUANTISED live scale would break exactly that, so the quantum is not decoration', () => {
    let worst = 0
    for (let oct = -2; oct <= 2; oct += 1 / 64) {
      const z = Math.pow(2, oct)                      // the mutation: no quantiseScale
      for (let n = 0; n <= 13; n++) {
        worst = Math.max(worst, Math.abs(n * CHUNK_PX_W * z - Math.round(n * CHUNK_PX_W * z)))
      }
    }
    expect(worst).toBeGreaterThan(0.4)                // half a screen pixel of seam, or worse
  })
})

describe('nearestStop snaps in log space, because the rungs are ratios', () => {
  it('the boundary between 1 and 2 is sqrt(2), not 1.5', () => {
    expect(nearestStop(Math.SQRT2 - 0.01)).toBe(1)
    expect(nearestStop(Math.SQRT2 + 0.01)).toBe(2)
    expect(nearestStop(1.5)).toBe(2)             // linear would have said 1
  })

  it('always returns a member of the set, from any scale at all', () => {
    for (const s of [0, 1e-9, 0.3, 0.9, 1.4, 2.6, 9, 1e9]) {
      expect(ZOOM_STOPS as readonly number[]).toContain(nearestStop(s))
    }
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

  it('a stop chosen mid-gesture continues from the hand, so the camera never jumps', () => {
    const held = zoomWheel(initialZoom(1), -150, 1000)
    const to = zoomTo(held, 4, 1090)
    expect(to.from).toBe(held.live)
    expect(zoomScaleAt(to, 1090)).toBe(held.live)
    expect(to.live).toBeNull()                            // a named stop ends the gesture
  })

  it('★ reduced motion gets the exact stop AT ONCE, and keeps the tracking that was its hand', () => {
    let s2 = initialZoom(1)
    let t = 1000
    for (let i = 0; i < 10; i++) { s2 = zoomWheel(s2, -30, t); t += 8 }
    const tracked = s2.live!
    expect(tracked).toBeGreaterThan(1)                    // the hand still moved the picture
    const end = t + WHEEL_GESTURE_GAP_MS + 1
    expect(zoomScaleAt(zoomRelease(s2, end, true), end)).toBe(3)        // arrives, no ease
    expect(zoomScaleAt(zoomRelease(s2, end, false), end)).toBe(tracked) // eases from the hand
  })
})

describe('the gesture boundary', () => {
  it('a fresh event after the gap starts a new gesture from where the camera rests', () => {
    const first = gesture(1, 10, -30, 8)
    expect(first.state.stop).toBe(3)
    const second = zoomWheel(first.state, -30, first.endMs + ZOOM_SETTLE_MS + 5000)
    // the new gesture leaves from the RESTING stop, not from the old live scale
    expect(second.gestureFrom).toBe(3)
  })

  it('zoomGestureEnded is false while events keep arriving and true once they stop', () => {
    const s = zoomWheel(initialZoom(1), -30, 1000)
    expect(zoomGestureEnded(s, 1000 + WHEEL_GESTURE_GAP_MS)).toBe(false)
    expect(zoomGestureEnded(s, 1000 + WHEEL_GESTURE_GAP_MS + 1)).toBe(true)
    expect(zoomGestureEnded(initialZoom(1), 1e9)).toBe(false)   // no gesture, nothing to end
  })

  it('releasing twice is a no-op — the second release has nothing to do', () => {
    const s = zoomRelease(zoomWheel(initialZoom(1), -300, 1000), 1200)
    expect(zoomRelease(s, 1300)).toBe(s)
  })
})

describe('every function is pure', () => {
  it('same inputs, same outputs — twice', () => {
    const s = initialZoom(2)
    expect(zoomWheel(s, -130, 1000)).toEqual(zoomWheel(s, -130, 1000))
    expect(zoomTo(s, 4, 1000)).toEqual(zoomTo(s, 4, 1000))
    expect(zoomScaleAt(s, 1000)).toBe(zoomScaleAt(s, 1000))
    expect(initialZoom()).toEqual(initialZoom())
    const held = zoomWheel(s, -130, 1000)
    expect(zoomRelease(held, 2000)).toEqual(zoomRelease(held, 2000))
  })

  it('does not mutate the state it was given', () => {
    const s = initialZoom(2)
    const before = { ...s }
    zoomWheel(s, -300, 5000)
    zoomTo(s, 4, 5000)
    zoomRelease(zoomWheel(s, -300, 5000), 6000)
    expect(s).toEqual(before)
  })
})

// ── the camera knows the edges, and there is a view of the whole town ─────────────────────

const terrainOf = (w: number, h: number): TileId[][] =>
  Array.from({ length: h }, () => Array.from({ length: w }, () => 0 as TileId))

/** The showcase town rebuilt from the template, so this and `occlusion.test.ts` agree by construction rather than by a pasted number. */
const ANCHOR = { x: 8, y: 8 }        // gateway SHOWCASE_ANCHOR
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

  it('the 48x48 world fits at 1x; a 128x128 world takes the wider stop the lane added', () => {
    expect(fitStop(cameraBoundsOf(terrainOf(48, 48)), STAGE)).toBe(1)
    expect(fitStop(cameraBoundsOf(terrainOf(128, 128)), STAGE)).toBe(0.25)
    // 0.5 held a 128x128 world only by falling to a floor it did not fit at; 0.25 holds it
    expect(fitsAt(cameraBoundsOf(terrainOf(128, 128)), STAGE, 0.25)).toBe(true)
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

describe('resizeIntent — a resize keeps the view the viewer asked for', () => {
  // the bar moving from the bottom edge to the left edge: 56 px off the width, 56 px back on
  // the height, and the town no longer fits at the stop it was fitted to
  const NARROW = { w: 700, h: 880 }

  it('THE BUG, AS A TEST: a fitted camera stops fitting when the stage narrows', () => {
    expect(fitStop(TOWN_DRAWN, STAGE)).toBe(1)
    expect(fitStop(TOWN_DRAWN, NARROW)).toBe(0.5)
    // the landed behaviour is the clamp alone, which leaves the stop at 1 on a stage that
    // can no longer hold the town at 1
    expect((TOWN_DRAWN.maxX - TOWN_DRAWN.minX) * 1).toBeGreaterThan(NARROW.w - 2 * FIT_MARGIN_PX)
  })

  it('re-fits a fitted camera to the stop the new stage can hold', () => {
    expect(resizeIntent(true, TOWN_DRAWN, NARROW)).toEqual({ kind: 'refit', stop: 0.5 })
  })

  it('leaves a camera the viewer steered alone — a stage that resizes must not jump', () => {
    expect(resizeIntent(false, TOWN_DRAWN, NARROW)).toEqual({ kind: 'clamp' })
    expect(resizeIntent(false, TOWN_DRAWN, STAGE)).toEqual({ kind: 'clamp' })
  })

  it('a fitted camera whose stop still fits re-centres rather than moving stop', () => {
    expect(resizeIntent(true, TOWN_DRAWN, STAGE)).toEqual({ kind: 'refit', stop: 1 })
  })

  it('never leaves the stop set, over every stage a window can be', () => {
    for (const w of [320, 700, 1024, 1728, 3840]) {
      for (const h of [240, 500, 880, 2160]) {
        const r = resizeIntent(true, TOWN_DRAWN, { w, h })
        expect(r.kind).toBe('refit')
        if (r.kind === 'refit') expect(ZOOM_STOPS as readonly number[]).toContain(r.stop)
      }
    }
  })
})

describe('★ the fill floor is derived per town and per stage, because both terms are', () => {
  it('publishes the ceiling and the floor for the boxes this project measures', () => {
    const rows: Array<[string, typeof TOWN_DRAWN, { w: number; h: number }]> = [
      ['the eleven-building fixture, drawn', TOWN_DRAWN, STAGE],
      ['the same, its ground with no roofs', TOWN_BOX, STAGE],
    ]
    for (const rings of [1, 2, 3, 4, 5, 10]) {
      rows.push([`the ring grammar, ${rings} ring(s)`, drawnBoundsOf(bigTown(rings)), STAGE])
    }
    const out = rows.map(([name, box, stage]) => {
      const refused = tooBigToFit(box, stage)
      const fit = fitStop(box, stage)
      return `${name.padEnd(36)} aspect ${boxAspect(box).toFixed(3)}`
        + `  ceiling ${(stageFillCeiling(box, stage) * 100).toFixed(2).padStart(6)}%`
        + `  floor ${(stageFillFloor(box, stage) * 100).toFixed(2).padStart(6)}%`
        + (refused
          ? '  fits at NO stop — "as much of the town as fits", no floor applies'
          : `  fit ${fit}x -> ${(stageFill(box, fit, stage) * 100).toFixed(2)}%`)
    })
    // eslint-disable-next-line no-console
    console.log(
      'STAGE FILL — ceiling is what a FREE scale would reach; floor is that less the one rung\n'
      + `the ladder may cost it (${ZOOM_STOP_MAX_RATIO}x, so a quarter of the area). `
      + `Stage ${STAGE.w}x${STAGE.h}.\n${out.join('\n')}`)
    expect(out.length).toBeGreaterThan(4)
  })

  it('★ the worst rung is a factor of two, and it is read off the ladder', () => {
    expect(ZOOM_STOP_MAX_RATIO).toBe(2)
    for (const [i, z] of ZOOM_STOPS.entries()) {
      if (i === 0) continue
      expect(z / ZOOM_STOPS[i - 1]!).toBeLessThanOrEqual(ZOOM_STOP_MAX_RATIO)
    }
  })

  it('★ a fit gives away nothing the ladder did not take — over every ring count', () => {
    for (const rings of [1, 2, 3, 4, 5, 6, 10]) {
      const box = drawnBoundsOf(bigTown(rings))
      for (const stage of [STAGE, { w: 1280, h: 720 }]) {
        if (tooBigToFit(box, stage)) continue      // the ladder refuses it; no floor applies
        const fit = fitStop(box, stage)
        expect(stageFill(box, fit, stage), `${rings} rings on ${stage.w}x${stage.h}`)
          .toBeGreaterThanOrEqual(stageFillFloor(box, stage))
        expect(fitsAt(box, stage, fit)).toBe(true)
        const next = ZOOM_STOPS[ZOOM_STOPS.indexOf(fit) + 1]
        if (next !== undefined) expect(fitsAt(box, stage, next)).toBe(false)
      }
    }
  })

  it('the ceiling is the stage itself when a box is the stage’s own shape', () => {
    const stage = { w: 1728, h: 824 }
    const usable = { w: stage.w - 2 * FIT_MARGIN_PX, h: stage.h - 2 * FIT_MARGIN_PX }
    const shaped = { minX: 0, maxX: usable.w, minY: 0, maxY: usable.h }
    expect(stageFillCeiling(shaped, stage))
      .toBeCloseTo((usable.w * usable.h) / (stage.w * stage.h), 9)
  })

  it('a box with no extent has no ceiling and no floor', () => {
    const none = { minX: 0, maxX: 0, minY: 0, maxY: 0 }
    expect(stageFillCeiling(none, STAGE)).toBe(0)
    expect(stageFillFloor(none, STAGE)).toBe(0)
  })
})

describe('stageFill — the number R8 is about', () => {
  it('THE R8 MEASUREMENT: the town the grammar grows fills two and a half times the frame', () => {
    expect(TOWN_BOX).toEqual({ minX: -528, maxX: 528, minY: 448, maxY: 840 })
    expect(TOWN_DRAWN).toEqual(drawnBoundsOf(TOWN))
    expect([TOWN_DRAWN.maxX - TOWN_DRAWN.minX, TOWN_DRAWN.maxY - TOWN_DRAWN.minY]).toEqual([1136, 520])
    expect(stageFill(TOWN_DRAWN, 1, STAGE)).toBeCloseTo(0.3885, 4)
    expect(stageFill(TOWN_DRAWN, 1, STAGE) / 0.1485, 'against the 14.8 % R8 measured')
      .toBeGreaterThan(2.5)
  })

  it('takes the largest stop that fits, and no larger one does', () => {
    const at = fitStop(TOWN_DRAWN, STAGE)
    expect(at).toBe(1)
    expect(fitsAt(TOWN_DRAWN, STAGE, at)).toBe(true)
    expect(fitsAt(TOWN_DRAWN, STAGE, 2), 'a stop above the fit would cut the town off').toBe(false)
    expect(stageFill(TOWN_DRAWN, at, STAGE), 'a fit gives away nothing the ladder did not take')
      .toBeGreaterThanOrEqual(stageFillFloor(TOWN_DRAWN, STAGE))
  })

  // Measured on a wider stage: the default one no longer separates footprint from drawing,
  // because the town outgrew it.
  it('fitting the footprint instead of the drawing overshoots by a whole stop', () => {
    const WIDE = { w: 2400, h: 900 }
    expect(fitStop(TOWN_BOX, WIDE)).toBe(2)
    expect(fitStop(TOWN_DRAWN, WIDE)).toBe(1)
    expect((TOWN_DRAWN.maxY - TOWN_DRAWN.minY) * 2)
      .toBeGreaterThan(WIDE.h - 2 * FIT_MARGIN_PX)     // the roofs, off the stage. RED.
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
    expect(boundsCentre(TOWN_BOX)).toEqual({ sx: 0, sy: 644 })
    // the landed first frame centred on the middle of a 48x48 grid, which is not the town
    const landed = boundsCentre(cameraBoundsOf(terrainOf(48, 48)))
    expect(landed).not.toEqual(boundsCentre(TOWN_BOX))
  })
})
