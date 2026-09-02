import { useState, useSyncExternalStore } from 'react'

/** How long the camera waits after the last input before the director takes it back. */
export const IDLE_HANDBACK_MS = 20_000

/** A hand on the camera: a pan, a zoom, a click, a key. */
const HAND_ON_CAMERA = ['pointerdown', 'keydown', 'wheel'] as const

export type Director = {
  get(): boolean
  subscribe(cb: () => void): () => void
  /** the D key, and the only thing that arms or disarms the director for good */
  toggle(): void
}

/** The director is armed for every viewer, desk and stream alike: a town nobody is steering is
 *  a town the camera has to find the story in. Any input hands it back for `IDLE_HANDBACK_MS`,
 *  which is long enough to look at something and short enough that the show resumes.
 *
 *  A store rather than hook state, and the listeners land on the first subscriber: App holds
 *  the Pixi scene, and a timestamp in the tree would re-render all of it on every keystroke. */
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
  const hold = (): void => {
    if (!armed) return
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
