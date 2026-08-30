import { MOTION, easeFn, type Motion } from './motion.js'

/** OUT THEN IN, NEVER BOTH AT ONCE: a crossfade of two live scenes doubles the frame cost and reads
 *  as a smear at this pixel density, so the outgoing leaves before the incoming arrives. */
export const SCENES = ['lens', 'interior', 'follow', 'daybreak', 'nightfall'] as const
export type SceneName = (typeof SCENES)[number]
type ScenePhase = 'idle' | 'out' | 'in'
export type SceneState = {
  name: SceneName
  phase: ScenePhase
  /** when the WHOLE transition began — a retarget keeps it, so mashing the lens bar does not
   *  stutter the town by restarting the clock on every keystroke. */
  startedMs: number
  from: string
  to: string
}

export const SCENE_OUT_MS = 120
export const SCENE_IN_MS = 180
export const SCENE_TOTAL_MS = SCENE_OUT_MS + SCENE_IN_MS

export function idleScene(name: SceneName, at: string): SceneState {
  return { name, phase: 'idle', startedMs: 0, from: at, to: at }
}

export type SceneEvent =
  | { kind: 'go'; name: SceneName; to: string; atMs: number }
  | { kind: 'tick'; atMs: number }

export function sceneReducer(prev: SceneState, ev: SceneEvent): SceneState {
  if (ev.kind === 'go') {
    if (prev.phase === 'out') {
      // RETARGET. Same clock, new destination: the view is already on its way out, and
      // starting again would freeze the outgoing panel under a fast hand.
      return prev.to === ev.to ? prev : { ...prev, name: ev.name, to: ev.to }
    }
    if (prev.phase === 'idle' && prev.to === ev.to) return prev
    return { name: ev.name, phase: 'out', startedMs: ev.atMs, from: prev.to, to: ev.to }
  }
  if (prev.phase === 'idle') return prev
  const elapsed = ev.atMs - prev.startedMs
  if (elapsed >= SCENE_TOTAL_MS) return { ...prev, phase: 'idle', from: prev.to }
  if (elapsed >= SCENE_OUT_MS) return prev.phase === 'in' ? prev : { ...prev, phase: 'in' }
  return prev
}

/** The outgoing scene's opacity and the incoming one's, at this instant. Under reduced motion the
 *  STATE MACHINE IS IDENTICAL and only the curve becomes a step, so nothing can desynchronise. */
export function sceneAlpha(
  s: SceneState,
  nowMs: number,
  reducedMotion = false,
): { out: number; in: number } {
  if (s.phase === 'idle') return { out: 0, in: 1 }
  return transitionAlpha(nowMs - s.startedMs, reducedMotion)
}

/** The curve itself, for a caller with its own phase machine: the outgoing opacity over the
 *  first `SCENE_OUT_MS`, the incoming over the `SCENE_IN_MS` after. */
export function transitionAlpha(
  elapsedMs: number,
  reducedMotion = false,
): { out: number; in: number } {
  if (elapsedMs < SCENE_OUT_MS) {
    if (reducedMotion) return { out: 1, in: 0 }
    return { out: 1 - easeFn('scene')(Math.max(0, elapsedMs / SCENE_OUT_MS)), in: 0 }
  }
  if (reducedMotion) return { out: 0, in: 1 }
  const t = Math.min(1, (elapsedMs - SCENE_OUT_MS) / SCENE_IN_MS)
  return { out: 0, in: easeFn('scene')(t) }
}

/** Grave tone gets the QUIET variant of every transition, not the absence of one (P10): the
 *  same move, longer, on a linear curve, with the queue of arrivals dropped. */
export const GRAVE_STRETCH = 1.5
const GRAVE_EASE = MOTION.ambient.ease

const SCENE_BASE: Readonly<Record<SceneName, Motion>> = {
  lens: { ms: SCENE_IN_MS, ease: MOTION.move.ease, stagger: MOTION.enter.stagger },
  interior: { ms: SCENE_IN_MS, ease: MOTION.scene.ease },
  follow: { ms: MOTION.move.ms, ease: MOTION.move.ease },
  daybreak: MOTION.ambient,
  nightfall: MOTION.ambient,
}

export function sceneMotion(name: SceneName, grave: boolean): Motion {
  const base = SCENE_BASE[name]
  if (!grave) return base
  return { ms: Math.round(base.ms * GRAVE_STRETCH), ease: GRAVE_EASE }
}

/** The tint the atmosphere should paint this frame: the clock's value eased toward the next
 *  one over the ambient motion, so a minute ticking every 2.5s crosses instead of stepping. */
export function crossTint(fromRgb: number, toRgb: number, t: number): number {
  const k = Math.min(1, Math.max(0, t))
  const ch = (shift: number): number => {
    const a = (fromRgb >> shift) & 0xff,
      b = (toRgb >> shift) & 0xff
    return Math.round(a + (b - a) * k)
  }
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
