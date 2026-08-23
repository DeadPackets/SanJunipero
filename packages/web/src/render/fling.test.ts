import { describe, expect, it } from 'vitest'
import { PAN_STEP_PX } from './cameraNav.js'
import {
  FLING_MAX_MS, FLING_MIN_PX_PER_MS, FLING_SAMPLE_MS, FLING_STOP_PX_PER_MS,
  FLING_STOP_TAIL_PX, TAP_SLOP_PX,
  flingFrom, flingStep, flingTravel, isDrag, trackDrag, type DragTrack, type Fling,
} from './fling.js'

const at = (vx: number, vy: number): Fling => ({ vx, vy, ms: 0 })

const track = (pts: ReadonlyArray<[number, number, number]>): DragTrack => {
  let t: DragTrack = trackDrag(null, pts[0]![0], pts[0]![1], pts[0]![2])
  for (const [x, y, ms] of pts.slice(1)) t = trackDrag(t, x, y, ms)
  return t
}

// ── ★ 48 PX OF KEYBOARD WILL NOT CROSS A 1900 PX TOWN ─────────────────────────────────────
//
// Drag-to-pan already existed; what it had no answer for was distance. Forty flicks of a wheel
// or forty presses of an arrow is not a camera control, it is a chore. A throw carries.
//
// It must not fight the two gestures that share the same pointer. A TAP is a tile pick and has
// always been told apart by TAP_SLOP_PX of total travel; a fling asks the same question and
// gets the same answer, so a click can never become a throw. And a wheel is a zoom that pins a
// world point under the cursor, which a moving camera would tear out from under it — so any
// zoom kills the glide rather than composing with it.

describe('telling a tap from a drag — one threshold, both questions', () => {
  it('a still finger is not a drag however long it rests', () => {
    expect(isDrag(track([[100, 100, 0], [100, 100, 500], [101, 100, 900]]))).toBe(false)
  })

  it('crossing the slop is a drag, and stays one even if it comes back', () => {
    const there = track([[100, 100, 0], [140, 100, 60]])
    expect(isDrag(there)).toBe(true)
    expect(isDrag(trackDrag(there, 100, 100, 120))).toBe(true)
  })

  it('the threshold is the landed one, so a click is picked exactly as it was', () => {
    expect(TAP_SLOP_PX).toBe(2)
    expect(isDrag(track([[0, 0, 0], [1, 1, 20]]))).toBe(false)
    expect(isDrag(track([[0, 0, 0], [2, 1, 20]]))).toBe(true)
  })
})

describe('flingFrom — the speed a gesture was let go at', () => {
  it('★ refuses to throw anything a tap released', () => {
    expect(flingFrom(track([[100, 100, 0], [101, 100, 40]]), 40)).toBeNull()
  })

  it('refuses a slow drag that was placed rather than thrown', () => {
    const slow = track([[0, 0, 0], [10, 0, 100], [20, 0, 200]])   // 0.1 px/ms
    expect(FLING_MIN_PX_PER_MS).toBeGreaterThan(0.1)
    expect(flingFrom(slow, 200)).toBeNull()
  })

  it('reads a real throw, in the direction it was thrown', () => {
    const fast = track([[0, 0, 0], [60, 30, 30], [120, 60, 60]])  // 2 px/ms east, 1 south
    const f = flingFrom(fast, 60)!
    expect(f).not.toBeNull()
    expect(f.vx).toBeCloseTo(2, 5)
    expect(f.vy).toBeCloseTo(1, 5)
  })

  it('★ reads the END of the gesture, not its average — a stop is a stop', () => {
    // thrown hard, then held still for a moment before release: that is a placement
    const stopped = track([[0, 0, 0], [400, 0, 100], [402, 0, 260], [402, 0, 300]])
    expect(flingFrom(stopped, 300)).toBeNull()
  })

  it('only looks back FLING_SAMPLE_MS, whatever came before', () => {
    expect(FLING_SAMPLE_MS).toBeGreaterThan(0)
    const old = track([[0, 0, 0], [1000, 0, 10], [1010, 0, 500], [1012, 0, 560]])
    expect(flingFrom(old, 560)).toBeNull()
  })
})

describe('flingStep — the glide, and where it ends', () => {
  const thrown = at(2, 0)

  it('moves the camera the way the finger was going', () => {
    const s = flingStep(thrown, 16)
    expect(s.dx).toBeGreaterThan(0)
    expect(s.dy).toBe(0)
  })

  it('slows every frame and never speeds up', () => {
    let f: Fling | null = thrown
    let last = Infinity
    for (let i = 0; i < 40 && f !== null; i++) {
      const s = flingStep(f, 16)
      expect(s.dx).toBeLessThanOrEqual(last + 1e-9)
      last = s.dx
      f = s.next
    }
  })

  it('★ always stops — a glide that never ends is a camera nobody owns', () => {
    let f: Fling | null = at(40, 40)
    let ms = 0
    while (f !== null && ms < 10_000) {
      f = flingStep(f, 16).next
      ms += 16
    }
    expect(f).toBeNull()
    expect(ms).toBeLessThanOrEqual(FLING_MAX_MS + 16)
  })

  it('stops below the eye: the last frame moves less than a pixel at 60 fps', () => {
    expect(FLING_STOP_PX_PER_MS * 16.7).toBeLessThan(1)
    expect(FLING_STOP_TAIL_PX).toBeLessThan(9)
  })

  it('is frame-rate independent: 30 fps and 120 fps travel the same distance', () => {
    const run = (dt: number): number => {
      let f: Fling | null = at(3, 0)
      let d = 0
      while (f !== null) {
        const s = flingStep(f, dt)
        d += s.dx
        f = s.next
      }
      return d
    }
    // they stop on different frames, so they differ by at most the tail the stop rule costs
    expect(Math.abs(run(8) - run(33))).toBeLessThanOrEqual(FLING_STOP_TAIL_PX)
  })
})

describe('flingTravel — how far a throw carries, stated in pixels', () => {
  it('★ crosses a town the keyboard cannot: one hard throw beats ten arrow presses', () => {
    // 4 px/ms is a hard flick; it carries 682 px, against 48 px for one press of an arrow
    expect(flingTravel(at(4, 0)).dx).toBeGreaterThan(12 * PAN_STEP_PX)
  })

  it('is linear in the speed it was thrown at, off by exactly the stop tail', () => {
    // travel = (v - v_stop) / k, so doubling the throw doubles all of it but the tail
    expect(flingTravel(at(4, 0)).dx - 2 * flingTravel(at(2, 0)).dx)
      .toBeCloseTo(FLING_STOP_TAIL_PX, 9)
  })

  it('agrees with what the steps actually add up to', () => {
    let f: Fling | null = at(2.5, -1)
    let dx = 0, dy = 0
    while (f !== null) {
      const s = flingStep(f, 4)
      dx += s.dx
      dy += s.dy
      f = s.next
    }
    const t = flingTravel(at(2.5, -1))
    expect(Math.abs(dx - t.dx)).toBeLessThanOrEqual(FLING_STOP_TAIL_PX)
    expect(Math.abs(dy - t.dy)).toBeLessThanOrEqual(FLING_STOP_TAIL_PX)
  })
})

describe('every function is pure', () => {
  it('does not mutate what it is given, and answers the same twice', () => {
    const f = at(2, 1)
    const before = { ...f }
    expect(flingStep(f, 16)).toEqual(flingStep(f, 16))
    expect(f).toEqual(before)
    const t = track([[0, 0, 0], [60, 0, 30]])
    const snapshot = JSON.stringify(t)
    expect(flingFrom(t, 30)).toEqual(flingFrom(t, 30))
    expect(JSON.stringify(t)).toBe(snapshot)
  })
})
