import { TILE_H, TILE_W } from './iso.js'

// A stop is a reciprocal of an integer or an integer, so NEAREST resamples exactly. The ladder
// stops at 0.25 because the >=24 screen px hit floor is 24/z WORLD px: at 0.125 a door's target
// would be six tiles wide. Past that the answer is navigation, and `tooBigToFit` says so.
export const ZOOM_STOPS = [0.25, 0.5, 1, 2, 3, 4] as const
export type ZoomStop = (typeof ZOOM_STOPS)[number]

export const ZOOM_SETTLE_MS = 180

// Zoom is damped continuously and only the rest stops are exact, so the pixel grid stays exact
// at rest and nowhere else.

/** How far the hand moves for a factor of two — chosen from feel, not derived: a comfortable trackpad swipe is 300-500 px of deltaY across a four-octave ladder. Retune here, nowhere else. */
export const WHEEL_PX_PER_OCTAVE = 220

/** Chrome delivers a trackpad pinch as a `wheel` with `ctrlKey` set and per-event deltas of 1-3 px, so it spends far less delta than a scroll for the same intent and needs its own gain. */
export const PINCH_PX_PER_OCTAVE = 90

/** No wheel event for this long and the hand has left: the camera settles onto a stop. */
export const WHEEL_GESTURE_GAP_MS = 140

/** Below this a gesture was a GRAZE and returns to the stop it left; above it the gesture commits one rung its way, so a mouse whose notch is only 0.24 of an octave still moves the camera. */
export const ZOOM_COMMIT_OCTAVES = 1 / 8

/** Snapping the live scale to 1/512 keeps a ground chunk a whole number of screen pixels at every scale a gesture passes through; a gesture lasts too long to lean on the chunk bleed instead. */
export const ZOOM_LIVE_QUANTUM = 1 / 512

export const ZOOM_SCALE_MIN: number = ZOOM_STOPS[0]
export const ZOOM_SCALE_MAX: number = ZOOM_STOPS[ZOOM_STOPS.length - 1]!

export type ZoomState = {
  /** where it comes to rest — always a member of ZOOM_STOPS, and what the chrome reads */
  stop: ZoomStop
  /** the scale the current settle left from */
  from: number
  startedMs: number
  /** The scale a hand is holding it at right now, or null; while set it outranks the eased transit entirely. */
  live: number | null
  /** the scale the gesture in flight started from, so a graze knows where to go back to */
  gestureFrom: number
  lastWheelMs: number
}

export function initialZoom(stop: ZoomStop = 1): ZoomState {
  return { stop, from: stop, startedMs: 0, live: null, gestureFrom: stop, lastWheelMs: -Infinity }
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

/** The scale to apply this frame: a hand on the camera wins, else the eased transit, which is EXACTLY `stop` at and after `startedMs + ZOOM_SETTLE_MS`. */
export function zoomScaleAt(s: ZoomState, nowMs: number): number {
  if (s.live !== null) return s.live
  const t = (nowMs - s.startedMs) / ZOOM_SETTLE_MS
  if (t >= 1) return s.stop
  if (t <= 0) return s.from
  return s.from + (s.stop - s.from) * easeOutCubic(t)
}

/** At rest on an exact stop. A gesture in flight is never settled, however long it is held. */
export function zoomSettled(s: ZoomState, nowMs: number): boolean {
  return s.live === null && nowMs - s.startedMs >= ZOOM_SETTLE_MS
}

/** A move to a named stop, leaving from wherever the camera is at this instant — so a stop
 *  chosen mid-transit, or mid-gesture, continues rather than jumps. */
export function zoomTo(prev: ZoomState, stop: ZoomStop, nowMs: number): ZoomState {
  const at = zoomScaleAt(prev, nowMs)
  return {
    stop,
    from: at,
    startedMs: nowMs,
    live: null,
    gestureFrom: at,
    lastWheelMs: prev.lastWheelMs,
  }
}

const clampScale = (v: number): number => Math.min(ZOOM_SCALE_MAX, Math.max(ZOOM_SCALE_MIN, v))

/** Snap to the grid that keeps a ground chunk a whole number of screen pixels, then clamp. */
export function quantiseScale(v: number): number {
  return clampScale(Math.round(v / ZOOM_LIVE_QUANTUM) * ZOOM_LIVE_QUANTUM)
}

/** One wheel event applied continuously; `pinch` is `e.ctrlKey`. Scale moves in LOG space, so the same push zooms by the same factor wherever the ladder's rungs happen to be. */
export function zoomWheel(
  prev: ZoomState,
  deltaY: number,
  nowMs: number,
  pinch = false,
): ZoomState {
  if (deltaY === 0) return prev
  const fresh = prev.live === null || nowMs - prev.lastWheelMs > WHEEL_GESTURE_GAP_MS
  const base = fresh ? zoomScaleAt(prev, nowMs) : prev.live!
  const gestureFrom = fresh ? base : prev.gestureFrom
  const perOctave = pinch ? PINCH_PX_PER_OCTAVE : WHEEL_PX_PER_OCTAVE
  const octaves = -deltaY / perOctave // wheel up (negative deltaY) zooms in
  return {
    ...prev,
    live: quantiseScale(base * Math.pow(2, octaves)),
    gestureFrom,
    lastWheelMs: nowMs,
  }
}

/** The hand has been off the camera for longer than a gesture's own gap. */
export function zoomGestureEnded(s: ZoomState, nowMs: number): boolean {
  return s.live !== null && nowMs - s.lastWheelMs > WHEEL_GESTURE_GAP_MS
}

/** The hand lets go and the frame becomes exact again. `instant` is what `prefers-reduced-motion: reduce` gets — the in-gesture tracking stays, only the easing goes. */
export function zoomRelease(prev: ZoomState, nowMs: number, instant = false): ZoomState {
  if (prev.live === null) return prev
  const at = prev.live
  const nearest = nearestStop(at)
  const moved = Math.abs(Math.log2(at / prev.gestureFrom))
  let stop = nearest
  if (moved >= ZOOM_COMMIT_OCTAVES && nearest === nearestStop(prev.gestureFrom)) {
    // a deliberate push that nearest-stop alone would throw away: commit one rung its way
    stop = stepStop(nearest, at > prev.gestureFrom ? 1 : -1)
  }
  return {
    stop,
    from: at,
    startedMs: instant ? nowMs - ZOOM_SETTLE_MS : nowMs,
    live: null,
    gestureFrom: stop,
    lastWheelMs: prev.lastWheelMs,
  }
}

/** The nearest named stop, measured in LOG space because the rungs are ratios: the midpoint between 1 and 2 is sqrt(2), and a linear snap biases every release. */
export function nearestStop(scale: number): ZoomStop {
  const l = Math.log2(Math.max(1e-9, scale))
  let best: ZoomStop = ZOOM_STOPS[0]
  for (const z of ZOOM_STOPS) {
    if (Math.abs(Math.log2(z) - l) < Math.abs(Math.log2(best) - l)) best = z
  }
  return best
}

/** One index along the stop set, clamped. The keyboard and the bar's buttons share it with
 *  the wheel, so `+` and a notch mean exactly the same thing. */
export function stepStop(stop: ZoomStop, dir: 1 | -1): ZoomStop {
  const i = ZOOM_STOPS.indexOf(stop)
  return ZOOM_STOPS[Math.min(ZOOM_STOPS.length - 1, Math.max(0, i + dir))]!
}

// ── THE CAMERA KNOWS THE EDGES ───────────────────────────────────────────────────────────

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
  list: readonly { x: number; y: number; w: number; h: number }[],
): CameraBounds {
  if (list.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (const s of list) {
    for (const [x, y] of [
      [s.x - 0.5, s.y - 0.5],
      [s.x + s.w - 0.5, s.y - 0.5],
      [s.x + s.w - 0.5, s.y + s.h - 0.5],
      [s.x - 0.5, s.y + s.h - 0.5],
    ]) {
      const sx = (x! - y!) * (TILE_W / 2),
        sy = (x! + y!) * (TILE_H / 2)
      minX = Math.min(minX, sx)
      maxX = Math.max(maxX, sx)
      minY = Math.min(minY, sy)
      maxY = Math.max(maxY, sy)
    }
  }
  return { minX, maxX, minY, maxY }
}

/** A building sprite is drawn to a `(w + h) · 32 px` square anchored at its base diamond, so it overhangs its own ground upward and to each side; a fit that ignores that cuts the roofs off. */
export const BUILDING_OVERHANG_PX_PER_TILE = 32 // textures.BUILDING_PX_PER_TILE

export function drawnBoundsOf(
  list: readonly { x: number; y: number; w: number; h: number }[],
): CameraBounds {
  if (list.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (const s of list) {
    const cx = s.x + s.w / 2 - 0.5,
      cy = s.y + s.h / 2 - 0.5
    const gsx = (cx - cy) * (TILE_W / 2),
      gsy = (cx + cy) * (TILE_H / 2)
    const side = (s.w + s.h) * BUILDING_OVERHANG_PX_PER_TILE
    minX = Math.min(minX, gsx - side / 2)
    maxX = Math.max(maxX, gsx + side / 2)
    minY = Math.min(minY, gsy - side)
    maxY = Math.max(maxY, gsy + ((s.w + s.h) * TILE_H) / 2)
  }
  return { minX, maxX, minY, maxY }
}

/** The reachable box is the ground that exists union the town as DRAWN: a building can stand past the end of the terrain array, and a clamp that knows only the array makes it unreachable. */
export const REACH_MARGIN_PX = 96

export function reachableBoundsOf(
  terrain: readonly (readonly unknown[])[],
  structures: readonly { x: number; y: number; w: number; h: number }[],
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

/** One axis of the clamp; `pos` is the world container's offset in screen px. A world SMALLER
 *  than the viewport at this scale is CENTRED rather than clamped. */
function clampAxis(pos: number, scale: number, lo: number, hi: number, size: number): number {
  const min = size - hi * scale // the far edge may not come inside the viewport
  const max = -lo * scale // nor the near edge
  if (min > max) return (size - (lo + hi) * scale) / 2
  return Math.min(max, Math.max(min, pos))
}

/** Clamp a camera position so the world box always covers the viewport. */
export function clampCamera(
  pos: { x: number; y: number },
  scale: number,
  bounds: CameraBounds,
  screen: { w: number; h: number },
): { x: number; y: number } {
  const k = scale > 0 ? scale : 1
  return {
    x: clampAxis(pos.x, k, bounds.minX, bounds.maxX, screen.w),
    y: clampAxis(pos.y, k, bounds.minY, bounds.maxY, screen.h),
  }
}

/** The breathing room a fitted view keeps on every side. At 48 px the fit fell a whole stop on a stage the control bar already takes 56 px from. */
export const FIT_MARGIN_PX = 24

/** Does the whole of `bounds` sit inside the stage at this scale, margin kept? The one
 *  predicate the fit and its refusal are both derived from, so they cannot disagree. */
export function fitsAt(
  bounds: CameraBounds,
  screen: { w: number; h: number },
  scale: number,
): boolean {
  const w = bounds.maxX - bounds.minX,
    h = bounds.maxY - bounds.minY
  return (
    w * scale <= Math.max(1, screen.w - 2 * FIT_MARGIN_PX) &&
    h * scale <= Math.max(1, screen.h - 2 * FIT_MARGIN_PX)
  )
}

/** The largest stop at which `bounds` fits inside the stage with a margin — the overview
 *  control, and the first frame. Falls to the smallest stop when nothing fits. */
export function fitStop(bounds: CameraBounds, screen: { w: number; h: number }): ZoomStop {
  let best: ZoomStop = ZOOM_STOPS[0]
  for (const z of ZOOM_STOPS) if (fitsAt(bounds, screen, z)) best = z
  return best
}

/** The town has outgrown the widest stop, so the bar can say so rather than quietly showing part of it. */
export function tooBigToFit(bounds: CameraBounds, screen: { w: number; h: number }): boolean {
  return !fitsAt(bounds, screen, ZOOM_STOPS[0])
}

/** Sticky, not automatic: a resize never moves a camera the viewer steered, but one showing the whole town keeps showing the whole town. */
export function resizeIntent(
  fitted: boolean,
  box: CameraBounds,
  screen: { w: number; h: number },
): { kind: 'refit'; stop: ZoomStop } | { kind: 'clamp' } {
  return fitted ? { kind: 'refit', stop: fitStop(box, screen) } : { kind: 'clamp' }
}

/** The fraction of the stage AREA the settlement occupies AS DRAWN. */
export function stageFill(
  drawnBounds: CameraBounds,
  scale: number,
  screen: { w: number; h: number },
): number {
  const w = (drawnBounds.maxX - drawnBounds.minX) * scale
  const h = (drawnBounds.maxY - drawnBounds.minY) * scale
  if (w <= 0 || h <= 0 || screen.w <= 0 || screen.h <= 0) return 0
  return (w * h) / (screen.w * screen.h)
}

// The stop ladder is quantised, so a fit target between stops is unreachable by construction —
// 38.85 % was measured at the nearest one. The floor below is derived rather than fixed.

/** How far short of the scale it wanted a fit can land, because the ladder has no rung there.
 *  Derived from the stops, so a new rung raises the floor by itself. */
export const ZOOM_STOP_MAX_RATIO: number = ZOOM_STOPS.reduce<number>(
  (worst, z, i) => (i === 0 ? worst : Math.max(worst, z / ZOOM_STOPS[i - 1]!)),
  1,
)

export function boxAspect(bounds: CameraBounds): number {
  const w = bounds.maxX - bounds.minX,
    h = bounds.maxY - bounds.minY
  return h <= 0 ? 0 : w / h
}

/** The most of the stage this box could ever cover, if the scale were free: it touches the
 *  binding side of the usable stage exactly, and the margin and its own aspect take the rest. */
export function stageFillCeiling(bounds: CameraBounds, screen: { w: number; h: number }): number {
  const a = boxAspect(bounds)
  if (a <= 0 || screen.w <= 0 || screen.h <= 0) return 0
  const uw = Math.max(1, screen.w - 2 * FIT_MARGIN_PX)
  const uh = Math.max(1, screen.h - 2 * FIT_MARGIN_PX)
  const [dw, dh] = a >= uw / uh ? [uw, uw / a] : [a * uh, uh]
  return (dw * dh) / (screen.w * screen.h)
}

/** The fill a fit is guaranteed to reach for THIS box on THIS stage: the ceiling, less the one
 *  rung the ladder may cost it. A first frame below this is a camera fault, not a town fault. */
export function stageFillFloor(bounds: CameraBounds, screen: { w: number; h: number }): number {
  return stageFillCeiling(bounds, screen) / (ZOOM_STOP_MAX_RATIO * ZOOM_STOP_MAX_RATIO)
}
