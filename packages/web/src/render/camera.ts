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

// ── ★ THE HAND ASKS CONTINUOUSLY; THE CAMERA MUST ANSWER CONTINUOUSLY ──────────────────────
//
// THE COMPLAINT, verbatim: "Zooming is not smooth at all and very hard to control."
//
// THE DEFECT, MEASURED on the landed handler in the running page. The ladder was climbed one
// rung per COOLDOWN WINDOW, so what the camera did was a function of how LONG the gesture took
// rather than how FAR the hand moved:
//
//   322 px of deltaY over  297 ms (34 events)  ->  ONE rung; 22 of the 34 events did nothing
//   322 px of deltaY over 1400 ms (34 events)  ->  THREE rungs, to the top of the ladder
//   500 px of deltaY over  360 ms (5 notches)  ->  ONE rung; 4 of the 5 notches did nothing
//    40 px of pinch over   320 ms (40 events)  ->  NOTHING AT ALL
//
// Same hand distance, one rung or the whole range. That is what "can't control it" means, and
// no amount of tuning a cooldown fixes it: a rate limiter cannot make a response proportional.
//
// ★ AND THE CRISP-VERSUS-SMOOTH TENSION, RESOLVED RATHER THAN TRADED.
//
// P18 needs EXACT stops so every texture lands on a whole-pixel grid under NEAREST, and three
// lanes have paid for that: the camera lane refused a continuous FIT scale ("it would resample
// every sprite into shimmer"), the render lane refused a new rung, the minimap lane found the
// hit floor that killed 0.125. All of that is about where the camera COMES TO REST.
//
// This is about where it is WHILE A HAND IS ON IT, which is a different question, and the
// renderer already answers it: an eased transit has always passed through fractional scales,
// and `groundChunks` carries a bleed pixel that exists for exactly "the fractional scales an
// eased zoom passes through". So the machinery for fractional scale IN MOTION is landed and
// proved. What changes is how long it lasts — a gesture rather than 180 ms — and the resting
// frame is untouched: it is a member of ZOOM_STOPS, always, by construction.
//
// The one thing that does NOT survive a longer fractional window is the ground seam, so the
// live scale is quantised — see ZOOM_LIVE_QUANTUM.

/**
 * ★ HOW FAR THE HAND MOVES FOR A FACTOR OF TWO.
 *
 * This is the ONE number in this lane chosen from feel rather than derived, and it is stated
 * as such. It cannot be measured without a hand on a real trackpad and this lane had no way
 * to produce one — a CDP-synthesised wheel is not a device. What it IS calibrated against:
 * the ladder spans four octaves (0.25 to 4), and one comfortable two-finger swipe on a Mac
 * trackpad delivers roughly 300-500 px of deltaY, so 220 px/octave puts "most of the range"
 * inside one decisive swipe and one rung inside a small one. Retune here, nowhere else.
 */
export const WHEEL_PX_PER_OCTAVE = 220

/**
 * A PINCH IS NOT A SCROLL, and the landed handler could not tell them apart.
 *
 * On macOS and Windows, Chrome delivers a trackpad pinch as a `wheel` event with `ctrlKey`
 * set, `deltaMode` 0, and per-event deltas of one to three pixels at gesture rate. Against
 * `WHEEL_MIN_DELTA = 8` every one of those was a graze, and against `WHEEL_STEP_DELTA = 120`
 * a whole comfortable pinch was under the bar: measured, 40 px of pinch moved the camera NOT
 * AT ALL. A pinch spends far less delta than a scroll for the same intent, so it gets its own
 * gain. (The ctrlKey contract is the platform's; the magnitudes here are the same calibration
 * the constant above is, and carry the same caveat.)
 */
export const PINCH_PX_PER_OCTAVE = 90

/** No wheel event for this long and the hand has left: the camera settles onto a stop. */
export const WHEEL_GESTURE_GAP_MS = 140

/**
 * A gesture that moved the scale less than this was a GRAZE and the camera returns to the stop
 * it started from. Above it the gesture COMMITS: it lands at least one rung away in the
 * direction it was going, even when the nearest stop is the one it left.
 *
 * That second half is what keeps the landed guarantee the browser bought — "ONE NOTCH IS ONE
 * STEP, whatever that mouse calls a notch". A 53 px notch is 0.24 of an octave, which snaps
 * back to where it started on nearest-stop alone; a mouse whose notch does nothing is the
 * defect the landed code already fixed once, and it is not being reintroduced.
 */
export const ZOOM_COMMIT_OCTAVES = 1 / 8

/**
 * ★ THE LIVE SCALE IS QUANTISED, AND THIS IS WHAT KEEPS THE GROUND SEAMS SHUT.
 *
 * The render-at-scale lane proved 0 px of seam error at all six stops, and the first of its
 * three mechanisms is that a chunk is a WHOLE NUMBER OF SCREEN PIXELS at every rest stop, so
 * the renderer's global `roundPixels` rounds two neighbours by the same fraction and they stay
 * exactly a chunk apart. At a fractional scale that does not hold, which is why the second
 * mechanism — one pixel of bleed — exists to cover the ~200 ms an eased transit spends there.
 *
 * A GESTURE IS NOT 200 MS, so this lane may not lean on the bleed. It restores the first
 * mechanism instead: the live scale is snapped to a multiple of 1/512, which makes a chunk of
 * 1024 x 512 world px an exact whole number of screen pixels again at EVERY scale the gesture
 * passes through. `camera.test.ts` reads `CHUNK_PX_W`/`CHUNK_PX_H` off `groundChunks.ts` and
 * asserts this quantum divides both, so a chunk that changes shape turns the law red rather
 * than opening a hairline nobody is looking for.
 *
 * The cost to the hand is nothing: 1/512 is 0.2 % of scale at 1x, far under the eye and far
 * under the finest movement a trackpad reports. Every rest stop is already a multiple of it.
 */
export const ZOOM_LIVE_QUANTUM = 1 / 512

export const ZOOM_SCALE_MIN: number = ZOOM_STOPS[0]
export const ZOOM_SCALE_MAX: number = ZOOM_STOPS[ZOOM_STOPS.length - 1]!

export type ZoomState = {
  /** where it comes to rest — always a member of ZOOM_STOPS, and what the chrome reads */
  stop: ZoomStop
  /** the scale the current settle left from */
  from: number
  startedMs: number
  /**
   * The scale a hand is holding it at RIGHT NOW, or null when no gesture is in flight. While
   * this is set it outranks the eased transit entirely: the camera is not going anywhere, it
   * is where the hand put it.
   */
  live: number | null
  /** the scale the gesture in flight started from, so a graze knows where to go back to */
  gestureFrom: number
  lastWheelMs: number
}

export function initialZoom(stop: ZoomStop = 1): ZoomState {
  return { stop, from: stop, startedMs: 0, live: null, gestureFrom: stop, lastWheelMs: -Infinity }
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

/** The scale to apply this frame. A hand on the camera wins; otherwise the eased transit,
 *  which is EXACTLY `stop` at and after `startedMs + ZOOM_SETTLE_MS` — the pixel law holds at
 *  rest, and only at rest. */
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
    stop, from: at, startedMs: nowMs,
    live: null, gestureFrom: at, lastWheelMs: prev.lastWheelMs,
  }
}

const clampScale = (v: number): number => Math.min(ZOOM_SCALE_MAX, Math.max(ZOOM_SCALE_MIN, v))

/** Snap to the grid that keeps a ground chunk a whole number of screen pixels, then clamp. */
export function quantiseScale(v: number): number {
  return clampScale(Math.round(v / ZOOM_LIVE_QUANTUM) * ZOOM_LIVE_QUANTUM)
}

/**
 * One wheel event, applied CONTINUOUSLY. `pinch` is `e.ctrlKey` — the platform's own flag for
 * a trackpad pinch, which spends a different amount of delta for the same intent.
 *
 * Scale moves in LOG space, so the same push zooms by the same FACTOR wherever you are: from
 * 0.25 and from 2 a swipe feels identical, which it does not when a step is a rung of a ladder
 * whose rungs are 2x apart at the bottom and 1.33x apart at the top.
 */
export function zoomWheel(
  prev: ZoomState, deltaY: number, nowMs: number, pinch = false,
): ZoomState {
  if (deltaY === 0) return prev
  const fresh = prev.live === null || nowMs - prev.lastWheelMs > WHEEL_GESTURE_GAP_MS
  const base = fresh ? zoomScaleAt(prev, nowMs) : prev.live!
  const gestureFrom = fresh ? base : prev.gestureFrom
  const perOctave = pinch ? PINCH_PX_PER_OCTAVE : WHEEL_PX_PER_OCTAVE
  const octaves = -deltaY / perOctave              // wheel up (negative deltaY) zooms in
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

/**
 * ★ THE HAND LETS GO, AND THE FRAME BECOMES EXACT AGAIN.
 *
 * `instant` is what `prefers-reduced-motion: reduce` gets: the camera arrives at the stop
 * rather than easing to it. The tracking during the gesture is NOT removed for that viewer —
 * it is their own hand, the same ground the fling exemption stands on — only the 180 ms of
 * motion they did not ask for.
 */
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
    stop, from: at, startedMs: instant ? nowMs - ZOOM_SETTLE_MS : nowMs,
    live: null, gestureFrom: stop, lastWheelMs: prev.lastWheelMs,
  }
}

/**
 * The nearest named stop to an arbitrary scale, measured in LOG space — the bridge from a
 * landed integer zoom and the landing point of every gesture.
 *
 * Log, not linear, because the rungs are ratios: linearly, 1.9 is "nearer" to 2 than 1.4 is to
 * 1, but the halfway point between 1 and 2 that the eye agrees with is sqrt(2) = 1.414, not
 * 1.5. A linear snap biases every release downward on the wide rungs and upward on the narrow
 * ones, which reads as the camera arguing with the hand.
 */
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

/**
 * ★ 0.45 WAS UNREACHABLE, AND THE REASON IS THE LADDER RATHER THAN THE CAMERA.
 *
 * The generator lane stood the real plotted town and measured **38.85 %** at the only stop it
 * fits at — 2.5× what R8 measured on the hand-placed town, and still under a threshold nobody
 * had derived. It declined to nudge the constant, which was right. This is the resolution, and
 * it is a re-derivation rather than a smaller number: **a fixed area fraction cannot be a law,
 * because neither term in it is the camera's to choose.**
 *
 * THE FIRST TERM — the town's aspect. `tileToScreen` maps any rectangle of tiles to a box of
 * exactly `TILE_W : TILE_H` = 2:1, and then `drawnBoundsOf` adds `(w+h)·32` of roof upward and
 * half that to each side, so a DRAWN town is always taller than 2:1 and how much taller depends
 * on how large the town is against its own buildings. A town cannot be asked to be a shape.
 *
 * THE SECOND TERM — the ladder's own coarseness. `fitStop` returns the largest rest stop that
 * fits, and the rungs below 1× are a FACTOR OF TWO apart. A town wanting 1.99 gets 1, and area
 * goes as the square, so it lands at a quarter of the fill it asked for. **That gap cannot be
 * closed by adding a stop**: P18 requires exact stops so the pixel grid stays exact, which
 * leaves only integers above 1 (the ladder already has 1, 2, 3, 4) and halvings below it, and
 * the camera lane refused 0.125 on the ≥24 px hit floor. The ladder is as fine as the laws allow.
 *
 * So the floor is computed, per town and per stage, from those two terms — and what it asserts
 * is the thing that IS the camera's to get right: **the fit gives away nothing the ladder did
 * not take.** On the C12 audit stage it is 0.21 for a large town and 0.16 for the
 * eleven-building fixture, and R8's unfitted first frame is below both.
 */

/** How far short of the scale it wanted a fit can land, because the ladder has no rung there.
 *  Derived from the stops, so a new rung raises the floor by itself. */
export const ZOOM_STOP_MAX_RATIO: number = ZOOM_STOPS.reduce<number>(
  (worst, z, i) => (i === 0 ? worst : Math.max(worst, z / ZOOM_STOPS[i - 1]!)), 1)

export function boxAspect(bounds: CameraBounds): number {
  const w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY
  return h <= 0 ? 0 : w / h
}

/** The most of the stage this box could ever cover, if the scale were free: it touches the
 *  binding side of the usable stage exactly, and the margin and its own aspect take the rest. */
export function stageFillCeiling(
  bounds: CameraBounds, screen: { w: number; h: number },
): number {
  const a = boxAspect(bounds)
  if (a <= 0 || screen.w <= 0 || screen.h <= 0) return 0
  const uw = Math.max(1, screen.w - 2 * FIT_MARGIN_PX)
  const uh = Math.max(1, screen.h - 2 * FIT_MARGIN_PX)
  const [dw, dh] = a >= uw / uh ? [uw, uw / a] : [a * uh, uh]
  return (dw * dh) / (screen.w * screen.h)
}

/** The fill a fit is guaranteed to reach for THIS box on THIS stage: the ceiling, less the one
 *  rung the ladder may cost it. A first frame below this is a camera fault, not a town fault. */
export function stageFillFloor(
  bounds: CameraBounds, screen: { w: number; h: number },
): number {
  return stageFillCeiling(bounds, screen) / (ZOOM_STOP_MAX_RATIO * ZOOM_STOP_MAX_RATIO)
}
