import { easeOutCubic, TWO_SHOT_MAX_STOP, ZOOM_STOPS, type ZoomStop } from '../render/camera.js'
import { type Facing, TILE_H, TILE_W } from '../render/iso.js'
import { CUT_MIN_MS } from './directorCut.js'

// The shot the camera is running: what it is on, how close, since when, and why. No React, no
// Pixi and no clock of its own. Every answer here is a function of a `nowMs` handed in.

/** `single` is the quiet round's turn: one body standing, which the camera frames the way it
 *  frames a follow and holds the way it holds a scene. */
export type ShotKind =
  | 'establish'
  | 'twoShot'
  | 'close'
  | 'follow'
  | 'single'
  | 'interior'
  | 'overview'

/** What the camera is on. A room is a structure id because the exterior view has nothing to
 *  point at while a council sits: the interior renderer draws that shot, not the street. */
export type ShotTarget =
  | { at: 'cast'; ids: readonly string[] }
  | { at: 'body'; id: string }
  | { at: 'room'; structureId: string }
  | { at: 'town' }

export type Shot = {
  kind: ShotKind
  target: ShotTarget
  stop: ZoomStop
  startedMs: number
  minHoldMs: number
  /** one plain sentence a viewer could read */
  why: string
  beatId: string | null
}

// ── the grammar ────────────────────────────────────────────────────────────────────────────

export const SHOT_STOP: Readonly<Record<ShotKind, ZoomStop>> = {
  establish: 1,
  twoShot: TWO_SHOT_MAX_STOP,
  close: 4,
  follow: 2,
  single: 2,
  interior: 3,
  overview: 0.5,
}

export const ESTABLISH_HOLD_MS = 3200
export const CLOSE_MAX_MS = 6000
export const PEAK_PUSH_MS = 2400

/** How long a shot may not be cut away from. A scene-length shot takes the town's own cut floor;
 *  a follow ends at its handover and an overview at the viewer, so neither holds on a clock. */
export const SHOT_MIN_HOLD_MS: Readonly<Record<ShotKind, number>> = {
  establish: ESTABLISH_HOLD_MS,
  twoShot: CUT_MIN_MS,
  close: PEAK_PUSH_MS,
  follow: 0,
  single: CUT_MIN_MS,
  interior: CUT_MIN_MS,
  overview: 0,
}

/** Only the close has a ceiling. Everything else ends because the world moved on. */
export const SHOT_MAX_HOLD_MS: Readonly<Partial<Record<ShotKind, number>>> = { close: CLOSE_MAX_MS }

export type ShotSpec = {
  kind: ShotKind
  target: ShotTarget
  why: string
  beatId?: string | null
  /** the stop the framing box fits at, which a two-shot caps */
  fitted?: ZoomStop
}

export function takeShot(spec: ShotSpec, nowMs: number): Shot {
  const fitted = spec.fitted
  const stop =
    spec.kind === 'twoShot' && fitted !== undefined && fitted < TWO_SHOT_MAX_STOP
      ? fitted
      : SHOT_STOP[spec.kind]
  return {
    kind: spec.kind,
    target: spec.target,
    stop,
    startedMs: nowMs,
    minHoldMs: SHOT_MIN_HOLD_MS[spec.kind],
    why: spec.why,
    beatId: spec.beatId ?? null,
  }
}

/** `locked` refuses a cut, `free` allows one, `over` demands one. */
export type HoldState = 'locked' | 'free' | 'over'

export function holdState(shot: Shot, nowMs: number): HoldState {
  const held = nowMs - shot.startedMs
  const max = SHOT_MAX_HOLD_MS[shot.kind]
  if (max !== undefined && held >= max) return 'over'
  return held >= shot.minHoldMs ? 'free' : 'locked'
}

/** Which shot a live scene asks for. The overview is never in the answer: it is the viewer's
 *  shot and the day's, and a camera that took it by itself mid-day would be looking at nothing. */
export function shotKindFor(scene: {
  opening: boolean
  peak: boolean
  indoors: boolean
  walking: boolean
  cast: number
}): Exclude<ShotKind, 'overview'> {
  if (scene.indoors) return 'interior'
  if (scene.opening) return 'establish'
  if (scene.peak) return 'close'
  if (scene.cast <= 1) return scene.walking ? 'follow' : 'single'
  return 'twoShot'
}

const targetKey = (t: ShotTarget): string =>
  t.at === 'cast' ? `cast ${t.ids.join(' ')}` : t.at === 'body' ? `body ${t.id}` : t.at

/** The shot that stays on screen. A shot inside its own `minHoldMs` is not replaced, so a round
 *  turn and a stand-down wait on the same floor a cut waits on. `force` is a hand on the lens,
 *  which no floor may refuse. */
export function nextShot(
  prev: Shot | null,
  spec: ShotSpec | null,
  nowMs: number,
  force = false,
): Shot | null {
  if (
    prev !== null &&
    spec !== null &&
    spec.kind === prev.kind &&
    targetKey(spec.target) === targetKey(prev.target)
  ) {
    return prev
  }
  if (!force && prev !== null && holdState(prev, nowMs) === 'locked') return prev
  return spec === null ? null : takeShot(spec, nowMs)
}

// ── the motion, chosen by distance ─────────────────────────────────────────────────────────

export const REFRAME_MS = 620
export const CUT_VIEWPORTS = 1.2
export const CUT_FALL_MS = 90
export const CUT_BLACK_MS = 40
export const CUT_RISE_MS = 180
export const CUT_FALL_SCALE = 0.86
export const CUT_RISE_SCALE = 1.04
export const CUT_MS = CUT_FALL_MS + CUT_BLACK_MS + CUT_RISE_MS

export type Move = { how: 'reframe' | 'cut'; ms: number }

/** How far the camera is about to travel, in screens. One full screen sideways is one. */
export function travelViewports(dx: number, dy: number, screen: { w: number; h: number }): number {
  if (screen.w <= 0 || screen.h <= 0) return 0
  return Math.hypot(dx / screen.w, dy / screen.h)
}

export function planMove(dx: number, dy: number, screen: { w: number; h: number }): Move {
  return travelViewports(dx, dy, screen) < CUT_VIEWPORTS
    ? { how: 'reframe', ms: REFRAME_MS }
    : { how: 'cut', ms: CUT_MS }
}

/** `at` is how far along the travel the camera is. A cut jumps it across the black frame, which
 *  is the whole difference between a cut and a reframe. */
export type MoveFrame = { at: number; scale: number; alpha: number; done: boolean }

export function moveFrame(move: Move, startedMs: number, nowMs: number): MoveFrame {
  const t = nowMs - startedMs
  if (t >= move.ms) return { at: 1, scale: 1, alpha: 1, done: true }
  if (move.how === 'reframe') {
    const k = t <= 0 ? 0 : easeOutCubic(t / REFRAME_MS)
    return { at: k, scale: 1, alpha: 1, done: false }
  }
  if (t < CUT_FALL_MS) {
    const k = t <= 0 ? 0 : easeOutCubic(t / CUT_FALL_MS)
    return { at: 0, scale: 1 + (CUT_FALL_SCALE - 1) * k, alpha: 1 - k, done: false }
  }
  if (t < CUT_FALL_MS + CUT_BLACK_MS) {
    return { at: 0, scale: CUT_FALL_SCALE, alpha: 0, done: false }
  }
  const k = easeOutCubic((t - CUT_FALL_MS - CUT_BLACK_MS) / CUT_RISE_MS)
  return { at: 1, scale: CUT_RISE_SCALE + (1 - CUT_RISE_SCALE) * k, alpha: k, done: false }
}

// ── what a held shot does while it holds ───────────────────────────────────────────────────

export const DRIFT_PX_PER_S = 3.5

/** A minute-long hold would travel 210 px on an unbounded drift, which walks the subject out of
 *  frame. One tile is the most a held camera may give away. */
export const DRIFT_MAX_PX = TILE_W

const ISO_LEN = Math.hypot(TILE_W, TILE_H)

/** A facing is a screen name, so its drift is the screen direction of a step that way. */
const DRIFT: Readonly<Record<Facing, { dx: number; dy: number }>> = {
  se: { dx: TILE_W / ISO_LEN, dy: TILE_H / ISO_LEN },
  sw: { dx: -TILE_W / ISO_LEN, dy: TILE_H / ISO_LEN },
  ne: { dx: TILE_W / ISO_LEN, dy: -TILE_H / ISO_LEN },
  nw: { dx: -TILE_W / ISO_LEN, dy: -TILE_H / ISO_LEN },
}

/** How far the shot has drifted from where it was taken, in world px. A body with no facing
 *  has no direction to drift along, so the camera stands still. */
export function driftAt(
  shot: Shot,
  facing: Facing | null,
  nowMs: number,
): { dx: number; dy: number } {
  if (facing === null) return { dx: 0, dy: 0 }
  const px = Math.min(DRIFT_MAX_PX, (Math.max(0, nowMs - shot.startedMs) / 1000) * DRIFT_PX_PER_S)
  const d = DRIFT[facing]
  return { dx: d.dx * px, dy: d.dy * px }
}

export const PEAK_PUSH_STOPS = 1 / 5

/** The push over a peak, in stops, eased in and then held. `pushedStop` is what reads it. */
export function peakPushAt(shot: Shot, nowMs: number): number {
  const t = (nowMs - shot.startedMs) / PEAK_PUSH_MS
  if (t <= 0) return 0
  return PEAK_PUSH_STOPS * (t >= 1 ? 1 : easeOutCubic(t))
}

/** The stop a shot is on this instant. The stop ladder is rungs, not a dial, so the eased fifth
 *  of a stop lands as the rung it eases toward: a peak opens one rung wide and arrives at 4. */
export function pushedStop(shot: Shot, nowMs: number): ZoomStop {
  if (shot.kind !== 'close' || peakPushAt(shot, nowMs) >= PEAK_PUSH_STOPS) return shot.stop
  return ZOOM_STOPS[Math.max(0, ZOOM_STOPS.indexOf(shot.stop) - 1)]!
}
