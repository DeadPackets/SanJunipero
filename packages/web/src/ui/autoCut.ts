import { useState, useSyncExternalStore } from 'react'

/** How long the camera waits after the last input before the director takes it back. */
export const IDLE_HANDBACK_MS = 20_000

/** A hand on the camera: a pan, a zoom, a click, a key. */
const HAND_ON_CAMERA = ['pointerdown', 'keydown', 'wheel'] as const

/** The town's own chrome. A click on the paper or the signpost is a hand on the PAPER: taking
 *  the camera away for it disabled the director on the very click that asks for a shot. */
const CHROME = '.paper, .signpost'

export function onChrome(target: EventTarget | null): boolean {
  // Duck-typed, not `instanceof Element`: the director is asked this off a browser too.
  const el = target as { closest?: (sel: string) => unknown } | null
  return typeof el?.closest === 'function' && el.closest(CHROME) !== null
}

export type Director = {
  get: () => boolean
  subscribe: (cb: () => void) => () => void
  /** the D key, and the only thing that arms or disarms the director for good */
  toggle: () => void
}

/** A store rather than hook state, with the listeners on the first subscriber: App holds the
 *  Pixi scene, and a timestamp in the tree would re-render all of it on every keystroke. */
export function director(target: EventTarget): Director {
  let armed = true
  let cutting = true
  let timer: ReturnType<typeof setTimeout> | null = null
  const subs = new Set<() => void>()

  const publish = (next: boolean): void => {
    if (next === cutting) return
    cutting = next
    for (const cb of subs) cb()
  }
  const stopTimer = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const hold = (e: Event): void => {
    if (!armed || onChrome(e.target)) return
    publish(false)
    stopTimer()
    timer = setTimeout(() => {
      publish(true)
    }, IDLE_HANDBACK_MS)
  }

  return {
    get: () => cutting,
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
      armed = !armed
      publish(armed)
    },
  }
}

export function useAutoCut(): { autoCut: boolean; toggle: () => void } {
  const [d] = useState(() => director(window))
  return { autoCut: useSyncExternalStore(d.subscribe, d.get), toggle: d.toggle }
}
