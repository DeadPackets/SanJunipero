import { TILE_H, TILE_W } from './iso.js'

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

// 0.25 JOINS THE LADDER, AND NOTHING BELOW IT DOES. Measured on the ring grammar, 0.5 holds
// two rings of blocks and no more, and the town keeps going. 0.25 is 1/4 — four world px
// become one screen px with no resampling, so P18 holds exactly as it does at 0.5 — and it
// holds a four-ring town, 640 buildings, in one view.
//
// The ladder stops there because the INTERFACE fails before the picture does: the >=24 screen
// px hit floor is a WORLD size of 24 / z, so at 0.125 a door's target is 192 world px, six
// tiles wide, swallowing its neighbours. Past four rings the answer is not a wider view, it is
// navigation, and `tooBigToFit` is how the control says so out loud.
export const ZOOM_STOPS = [0.25, 0.5, 1, 2, 3, 4] as const
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

// ── THE CAMERA KNOWS THE EDGES (U19, audit R8, plan task 76) ─────────────────────────────
//
// THE DEFECT: nothing clamped the camera. `panBy` and the drag handler added pixels without
// bound, so one drag pushed the town entirely off screen with no way back but `Center`. And
// the first frame centred on the middle of the TERRAIN ARRAY, which on a town anchored at
// y 13 is not the town — the settlement occupied 8.9 % of a 1728 x 880 stage, the rest
// blank field. That is the number R8 is about.

/** A box in world-screen space: the same coordinates `tileToScreen` produces. */
export type CameraBounds = { minX: number; maxX: number; minY: number; maxY: number }

/** The world-space box the map occupies. Recomputed on terrain change, never stored. */
export function cameraBoundsOf(terrain: readonly (readonly unknown[])[]): CameraBounds {
  const h = terrain.length
  const w = terrain[0]?.length ?? 0
  return { minX: -h * (TILE_W / 2), maxX: w * (TILE_W / 2), minY: 0, maxY: (w + h) * (TILE_H / 2) }
}

/** The settlement's OWN box — the thing the first frame is of, and the thing `stageFill`
 *  measures. A map is mostly field; a town is what a viewer came for. */
export function structureBoundsOf(
  list: ReadonlyArray<{ x: number; y: number; w: number; h: number }>,
): CameraBounds {
  if (list.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const s of list) {
    for (const [x, y] of [
      [s.x - 0.5, s.y - 0.5], [s.x + s.w - 0.5, s.y - 0.5],
      [s.x + s.w - 0.5, s.y + s.h - 0.5], [s.x - 0.5, s.y + s.h - 0.5],
    ]) {
      const sx = (x! - y!) * (TILE_W / 2), sy = (x! + y!) * (TILE_H / 2)
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx)
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy)
    }
  }
  return { minX, maxX, minY, maxY }
}

/**
 * The settlement as it is DRAWN, which is not the ground it stands on.
 *
 * WHAT THE BROWSER CAUGHT: fitting the footprint box put the camera at 3× and cut the roofs
 * off the top and right of the stage. A building sprite is drawn to a `(w + h) · 32 px`
 * square anchored at its base diamond, so it overhangs its own ground by about 1.85× upward
 * and reaches half that square to each side. A fit that ignores the overhang is not a fit.
 *
 * The same geometry `depth.structureDepthBox` uses for its screen AABB, kept here rather than
 * imported so the camera stays free of the renderer.
 */
export const BUILDING_OVERHANG_PX_PER_TILE = 32   // textures.BUILDING_PX_PER_TILE

export function drawnBoundsOf(
  list: ReadonlyArray<{ x: number; y: number; w: number; h: number }>,
): CameraBounds {
  if (list.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const s of list) {
    const cx = s.x + s.w / 2 - 0.5, cy = s.y + s.h / 2 - 0.5
    const gsx = (cx - cy) * (TILE_W / 2), gsy = (cx + cy) * (TILE_H / 2)
    const side = (s.w + s.h) * BUILDING_OVERHANG_PX_PER_TILE
    minX = Math.min(minX, gsx - side / 2); maxX = Math.max(maxX, gsx + side / 2)
    minY = Math.min(minY, gsy - side); maxY = Math.max(maxY, gsy + ((s.w + s.h) * TILE_H) / 2)
  }
  return { minX, maxX, minY, maxY }
}

/**
 * ★ THE BOX THE CAMERA MAY TRAVEL OVER, ON A TOWN WITH NO FIXED SIZE.
 *
 * `cameraBoundsOf` measures the TILE ARRAY, and every write to the camera goes through a clamp
 * against it. That was right while the town was a 48 × 48 fixture. Under the ring grammar the
 * built area is sparse and unbounded — blocks plat outward and agents claim plots forever — so
 * a building can stand past the end of the array, and a clamp that knows only the array does
 * not make that building hard to reach, it makes it UNREACHABLE.
 *
 * So the reachable box is the ground that EXISTS union the town as it is DRAWN, and only the
 * first half has a size anybody wrote down. Drawn, not footprint: the clamp has to admit the
 * roof, or the outermost building is cut in half at the limit of travel.
 */
export const REACH_MARGIN_PX = 96

export function reachableBoundsOf(
  terrain: readonly (readonly unknown[])[],
  structures: ReadonlyArray<{ x: number; y: number; w: number; h: number }>,
): CameraBounds {
  const t = cameraBoundsOf(terrain)
  if (structures.length === 0) return t
  const d = drawnBoundsOf(structures)
  return {
    minX: Math.min(t.minX, d.minX - REACH_MARGIN_PX),
    maxX: Math.max(t.maxX, d.maxX + REACH_MARGIN_PX),
    minY: Math.min(t.minY, d.minY - REACH_MARGIN_PX),
    maxY: Math.max(t.maxY, d.maxY + REACH_MARGIN_PX),
  }
}

export function boundsCentre(b: CameraBounds): { sx: number; sy: number } {
  return { sx: (b.minX + b.maxX) / 2, sy: (b.minY + b.maxY) / 2 }
}

/** One axis of the clamp. `pos` is the world container's offset in screen px, so the visible
 *  span is `[-pos, -pos + size] / scale`. When the world is SMALLER than the viewport at this
 *  scale it is CENTRED instead of clamped, which is the only sane reading of "in bounds" for
 *  a small map. */
function clampAxis(pos: number, scale: number, lo: number, hi: number, size: number): number {
  const min = size - hi * scale       // the far edge may not come inside the viewport
  const max = -lo * scale             // nor the near edge
  if (min > max) return (size - (lo + hi) * scale) / 2
  return Math.min(max, Math.max(min, pos))
}

/** Clamp a camera position so the world box always covers the viewport. */
export function clampCamera(
  pos: { x: number; y: number }, scale: number, bounds: CameraBounds,
  screen: { w: number; h: number },
): { x: number; y: number } {
  const k = scale > 0 ? scale : 1
  return {
    x: clampAxis(pos.x, k, bounds.minX, bounds.maxX, screen.w),
    y: clampAxis(pos.y, k, bounds.minY, bounds.maxY, screen.h),
  }
}

/**
 * The breathing room a fitted view keeps on every side.
 *
 * WHAT THE BROWSER CAUGHT: task 77's bar takes 56 px off the bottom of the stage, and at 48
 * the fit fell a WHOLE STOP — the town went back to the small overview R8 is about, with
 * 62 px of the stage left unused. 24 px is a real edge on a subject 376 px tall; 48 was a
 * margin that cost more than it bought.
 */
export const FIT_MARGIN_PX = 24

/** Does the whole of `bounds` sit inside the stage at this scale, margin kept? The one
 *  predicate the fit and its refusal are both derived from, so they cannot disagree. */
export function fitsAt(
  bounds: CameraBounds, screen: { w: number; h: number }, scale: number,
): boolean {
  const w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY
  return w * scale <= Math.max(1, screen.w - 2 * FIT_MARGIN_PX)
    && h * scale <= Math.max(1, screen.h - 2 * FIT_MARGIN_PX)
}

/** The largest stop at which `bounds` fits inside the stage with a margin — the overview
 *  control, and the first frame. Falls to the smallest stop when nothing fits. */
export function fitStop(bounds: CameraBounds, screen: { w: number; h: number }): ZoomStop {
  let best: ZoomStop = ZOOM_STOPS[0]
  for (const z of ZOOM_STOPS) if (fitsAt(bounds, screen, z)) best = z
  return best
}

/**
 * The town has outgrown the widest stop: "The whole town" will show as much of it as the
 * ladder can and the rest is off screen. A control that quietly does most of what it says is
 * worse than one that says what it cannot do, so the bar reads this and tells the viewer.
 */
export function tooBigToFit(bounds: CameraBounds, screen: { w: number; h: number }): boolean {
  return !fitsAt(bounds, screen, ZOOM_STOPS[0])
}

/**
 * WHAT A RESIZE SHOULD DO TO THE CAMERA.
 *
 * The stage changes size when the control bar docks to another edge or a panel opens, and the
 * landed observer only re-CLAMPED: a viewer who had asked for the whole town was left at a stop
 * the new stage cannot hold it at, with part of the town outside the view until they pressed
 * "The whole town" again.
 *
 * The rule is STICKY, not automatic. A camera the viewer steered is never moved — a stage that
 * jumps when a panel opens is worse than one that does not. A camera that is showing the whole
 * town keeps showing the whole town, which is the thing that was asked for in the first place.
 */
export function resizeIntent(
  fitted: boolean, box: CameraBounds, screen: { w: number; h: number },
): { kind: 'refit'; stop: ZoomStop } | { kind: 'clamp' } {
  return fitted ? { kind: 'refit', stop: fitStop(box, screen) } : { kind: 'clamp' }
}

/** The fraction of the stage AREA the settlement occupies AS DRAWN. The audit measured this
 *  "under 15 %" at the old `ZOOM_MIN = 1`, and on the real eleven-building town it reproduces
 *  at 14.4 %; the gate asserts it on the first frame. */
export function stageFill(
  drawnBounds: CameraBounds, scale: number, screen: { w: number; h: number },
): number {
  const w = (drawnBounds.maxX - drawnBounds.minX) * scale
  const h = (drawnBounds.maxY - drawnBounds.minY) * scale
  if (w <= 0 || h <= 0 || screen.w <= 0 || screen.h <= 0) return 0
  return (w * h) / (screen.w * screen.h)
}

export const STAGE_FILL_MIN = 0.45
