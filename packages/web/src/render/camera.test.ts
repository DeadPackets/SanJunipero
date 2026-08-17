import { describe, expect, it } from 'vitest'
import {
  WHEEL_GESTURE_GAP_MS, WHEEL_MIN_DELTA, WHEEL_STEP_DELTA, ZOOM_SETTLE_MS, ZOOM_STEP_COOLDOWN_MS, ZOOM_STOPS,
  easeOutCubic, initialZoom, zoomScaleAt, zoomSettled, zoomTo, zoomWheel, type ZoomStop,
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
