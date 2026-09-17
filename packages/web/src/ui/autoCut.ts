import { useState, useSyncExternalStore } from 'react'
import { cameraActionFor } from '../render/cameraNav.js'
import { CUT_MIN_MS, QUIET_TURN_TICKS, quietSubject } from './directorCut.js'

/** How long the camera waits after the last input before the director takes it back. */
export const IDLE_HANDBACK_MS = 20_000

/** A hand on the camera: a pan, a zoom, a click, a key. */
const HAND_ON_CAMERA = ['pointerdown', 'keydown', 'wheel'] as const

/** The canvas. Every way a viewer drives the camera goes through it: the drag, the pinch and the
 *  wheel are on it, and StageMount binds the arrows and the stops on the mount around it. */
const STAGE = '.stage-mount'

/** Asked the way the camera is actually DRIVEN, rather than by naming the chrome to exempt: an
 *  exemption list counted muting the town as a pan and took the camera off auto for it. */
export function onCamera(e: Event): boolean {
  // Duck-typed, not `instanceof Element`: the director is asked this off a browser too.
  const el = e.target as { closest?: (sel: string) => unknown } | null
  if (typeof el?.closest !== 'function' || el.closest(STAGE) === null) return false
  return e.type !== 'keydown' || cameraActionFor((e as KeyboardEvent).key) !== null
}

/** What the chip says. Three states, because a hand on the lens with a clock behind it and a
 *  hand with none are not the same thing: the D key promises no return, so it names no second.
 *  A deadline that has passed names none either: the second it promised is spent. */
export function cameraHand(cutting: boolean, handbackAt: number | null, nowMs: number): string {
  if (cutting) return 'Camera on auto'
  const left = handbackAt === null ? 0 : Math.ceil((handbackAt - nowMs) / 1000)
  return left > 0 ? `Camera back in ${left}s` : 'Camera held by you'
}

/** The cut floor, holding the cut it refuses instead of dropping it: a refused cut used to be
 *  thrown away, and the moment it was announcing was never shown at all. */
export function cutFloor<T>(
  take: (cut: T | null) => void,
  keyOf: (cut: T) => string,
): {
  offer: (cut: T | null, nowMs: number) => void
  clear: () => void
} {
  // The first cut of a visit is free: the floor is about how fast the camera may cut AGAIN.
  let last = -CUT_MIN_MS
  let shown: T | null = null
  let pending: T | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = (): void => {
    pending = null
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const land = (cut: T, atMs: number): void => {
    last = atMs
    clear()
    shown = cut
    take(cut)
  }
  return {
    offer(cut, nowMs) {
      // The frame names the shot that is up, or names nothing at all. Either way nothing is
      // cutting, and a cut still waiting on the floor is one the gateway has already left.
      if (cut === null || (shown !== null && keyOf(cut) === keyOf(shown))) {
        clear()
        shown = cut
        take(cut)
        return
      }
      const wait = CUT_MIN_MS - (nowMs - last)
      if (wait <= 0) {
        land(cut, nowMs)
        return
      }
      // One waiting cut, never a queue: a newer one takes the waiting one's place.
      pending = cut
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        if (pending !== null) land(pending, nowMs + wait)
      }, wait)
    },
    clear,
  }
}

/** One face at a time while nothing scores, held for the whole turn: the round is ranked over
 *  whoever is outdoors, and anybody opening a door re-ranked it and threw the camera mid-turn. */
export function quietRound(): (people: readonly string[], nowTick: number) => string | null {
  let turn = -1
  let held: string | null = null
  return (people, nowTick) => {
    const t = Math.floor(nowTick / QUIET_TURN_TICKS)
    if (t !== turn || held === null || !people.includes(held)) {
      turn = t
      held = quietSubject(people, nowTick)
    }
    return held
  }
}

export type Director = {
  get: () => boolean
  /** When the camera comes back, on the wall clock, or null when nothing will hand it back.
   *  Read rather than published: a deadline in the tree would re-render the town on every pan. */
  handbackAt: () => number | null
  subscribe: (cb: () => void) => () => void
  /** the D key, and the only thing that arms or disarms the director for good */
  toggle: () => void
  hold: () => void
}

/** A store rather than hook state, with the listeners on the first subscriber: App holds the
 *  Pixi scene, and a timestamp in the tree would re-render all of it on every keystroke. */
export function director(target: EventTarget): Director {
  let armed = true
  let cutting = true
  let timer: ReturnType<typeof setTimeout> | null = null
  let handback: number | null = null
  const subs = new Set<() => void>()

  const publish = (next: boolean): void => {
    if (next === cutting) return
    cutting = next
    for (const cb of subs) cb()
  }
  const stopTimer = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    handback = null
  }
  const pause = (): void => {
    if (!armed) return
    publish(false)
    stopTimer()
    handback = Date.now() + IDLE_HANDBACK_MS
    timer = setTimeout(() => {
      stopTimer()
      publish(true)
    }, IDLE_HANDBACK_MS)
  }

  const hold = (e: Event): void => {
    if (onCamera(e)) pause()
  }

  return {
    get: () => cutting,
    hold: pause,
    handbackAt: () => handback,
    subscribe(cb) {
      subs.add(cb)
      if (subs.size === 1) {
        for (const e of HAND_ON_CAMERA) target.addEventListener(e, hold, { passive: true })
      }
      return () => {
        subs.delete(cb)
        if (subs.size > 0) return
        for (const e of HAND_ON_CAMERA) target.removeEventListener(e, hold)
        stopTimer()
      }
    },
    toggle() {
      stopTimer()
      // Pressed to ARM: the key answers the picture the viewer is looking at, so a camera that
      // is standing still is given back rather than switched off a second time.
      armed = !cutting
      publish(armed)
    },
  }
}

export function useAutoCut(): {
  autoCut: boolean
  handbackAt: () => number | null
  toggle: () => void
  hold: () => void
} {
  const [d] = useState(() => director(window))
  return {
    autoCut: useSyncExternalStore(d.subscribe, d.get),
    handbackAt: d.handbackAt,
    toggle: d.toggle,
    hold: d.hold,
  }
}
