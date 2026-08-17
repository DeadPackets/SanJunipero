// SMOOTH, DAMPED, BOUNDED ZOOM (U19, plan task 75).
//
// THE COMPLAINT, verbatim: "sometimes I zoom way too much by accident and I can't control my
// zoom at all."
//
// THE DEFECT (F-4): `scene.onWheel` took ONE integer step per wheel EVENT — no accumulation,
// no time gate, no animation, anchored on the screen centre. A trackpad flick is thirty
// events, so a flick crossed the whole zoom range in a tenth of a second.
//
// The law this obeys and the law it amends: P18. REST STOPS STAY EXACT so the pixel grid
// stays exact; the TRANSIT between them is animated. `0.5` joins the stop set because a
// reciprocal of an integer samples NEAREST exactly — every 2 world px become 1 screen px with
// no resampling — and because the audit measured the settlement occupying a small fraction of
// the stage at the old `ZOOM_MIN = 1` (R8).

export const ZOOM_STOPS = [0.5, 1, 2, 3, 4] as const
export type ZoomStop = (typeof ZOOM_STOPS)[number]

export const ZOOM_SETTLE_MS = 180

/**
 * A trackpad sends many small deltas; a mouse sends one notch. Steps fire on ACCUMULATED
 * delta crossing the threshold WITHIN a gesture, and the accumulator resets between gestures.
 *
 * WHAT THE BROWSER CAUGHT: "one notch of a wheel is 120" is a convention, not a fact — Chrome
 * commonly reports 100, and some mice report 53. With a 120 threshold and nothing else, a
 * real mouse never zoomed AT ALL: each notch arrived as its own gesture, 100 < 120, and the
 * accumulator reset before the next one. So a gesture's FIRST event is itself a deliberate
 * act and takes one step, whatever that mouse calls a notch; the threshold governs continued
 * travel inside one gesture, and the cooldown governs the rate.
 */
export const WHEEL_STEP_DELTA = 120
export const WHEEL_GESTURE_GAP_MS = 140
/** Below this, a fresh event is a graze rather than a gesture: it accumulates, it never steps. */
export const WHEEL_MIN_DELTA = 8

/** No second step may fire inside this window however hard the wheel is spun. This is the
 *  line that makes "I can't control my zoom at all" impossible. */
export const ZOOM_STEP_COOLDOWN_MS = 200

export type ZoomState = {
  /** where it is going, and where it will be at rest */
  stop: ZoomStop
  /** the scale it left */
  from: number
  startedMs: number
  /** wheel delta since the gesture began */
  accum: number
  lastWheelMs: number
  lastStepMs: number
}

export function initialZoom(stop: ZoomStop = 1): ZoomState {
  return { stop, from: stop, startedMs: 0, accum: 0, lastWheelMs: -Infinity, lastStepMs: -Infinity }
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

/** The scale to apply this frame. EXACTLY `stop` at and after `startedMs + ZOOM_SETTLE_MS` —
 *  the pixel law holds at rest, and only at rest. */
export function zoomScaleAt(s: ZoomState, nowMs: number): number {
  const t = (nowMs - s.startedMs) / ZOOM_SETTLE_MS
  if (t >= 1) return s.stop
  if (t <= 0) return s.from
  return s.from + (s.stop - s.from) * easeOutCubic(t)
}

export function zoomSettled(s: ZoomState, nowMs: number): boolean {
  return nowMs - s.startedMs >= ZOOM_SETTLE_MS
}

/** A move to a named stop, leaving from wherever the camera is at this instant — so a stop
 *  chosen mid-transit continues rather than jumps. */
export function zoomTo(prev: ZoomState, stop: ZoomStop, nowMs: number): ZoomState {
  return {
    stop, from: zoomScaleAt(prev, nowMs), startedMs: nowMs,
    accum: 0, lastWheelMs: prev.lastWheelMs, lastStepMs: nowMs,
  }
}

export function zoomWheel(prev: ZoomState, deltaY: number, nowMs: number): ZoomState {
  if (deltaY === 0) return prev
  // a new gesture starts with a clean accumulator, so a flick cannot inherit the last one
  const fresh = nowMs - prev.lastWheelMs > WHEEL_GESTURE_GAP_MS
  const accum = (fresh ? 0 : prev.accum) + deltaY
  const cooling = nowMs - prev.lastStepMs < ZOOM_STEP_COOLDOWN_MS
  const wants = (fresh && Math.abs(deltaY) >= WHEEL_MIN_DELTA) || Math.abs(accum) >= WHEEL_STEP_DELTA
  if (cooling || !wants) {
    return { ...prev, accum, lastWheelMs: nowMs }
  }
  const dir = accum < 0 ? 1 : -1                        // wheel up zooms in
  const i = ZOOM_STOPS.indexOf(prev.stop)
  const next = ZOOM_STOPS[Math.min(ZOOM_STOPS.length - 1, Math.max(0, i + dir))]!
  if (next === prev.stop) return { ...prev, accum: 0, lastWheelMs: nowMs }
  return {
    stop: next, from: zoomScaleAt(prev, nowMs), startedMs: nowMs,
    accum: 0, lastWheelMs: nowMs, lastStepMs: nowMs,
  }
}

/** The nearest named stop to an arbitrary scale — the bridge from a landed integer zoom. */
export function nearestStop(scale: number): ZoomStop {
  let best: ZoomStop = ZOOM_STOPS[0]
  for (const z of ZOOM_STOPS) if (Math.abs(z - scale) < Math.abs(best - scale)) best = z
  return best
}

/** One index along the stop set, clamped. The keyboard and the bar's buttons share it with
 *  the wheel, so `+` and a notch mean exactly the same thing. */
export function stepStop(stop: ZoomStop, dir: 1 | -1): ZoomStop {
  const i = ZOOM_STOPS.indexOf(stop)
  return ZOOM_STOPS[Math.min(ZOOM_STOPS.length - 1, Math.max(0, i + dir))]!
}
