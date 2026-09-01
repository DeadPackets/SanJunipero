import { useCallback, useEffect, useRef, useState } from 'react'

/** How long the camera waits after the last input before the director takes it back. */
const IDLE_HANDBACK_MS = 20_000

/** ★ Who the director is for. A broadcast has no operator and no hand on it, so it is cut for
 *  a viewer who is only watching; a person at a desk came to look for themselves, and a camera
 *  that took itself back twenty seconds after every click was taking the town off them. */
export function directorArmedBy(broadcast: boolean): boolean {
  return broadcast
}

/** The state is the BOOLEAN, never the moment of the last input: App holds the Pixi scene,
 *  and a timestamp in state would re-render the whole tree on every keystroke. */
export function useAutoCut(broadcast: boolean): { autoCut: boolean; toggle: () => void } {
  const armed = directorArmedBy(broadcast)
  const [autoCut, setAutoCut] = useState(armed)
  // What the viewer last ASKED for, which is what an idle camera is handed back to. A ref, not
  // state: it decides nothing about this render, it only outlives it.
  const armedRef = useRef(armed)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hold = useCallback(() => {
    if (!armedRef.current) return // nothing to hold off, and no re-render to spend on saying so
    setAutoCut(false)
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setAutoCut(true)
    }, IDLE_HANDBACK_MS)
  }, [])

  useEffect(() => {
    window.addEventListener('pointerdown', hold)
    window.addEventListener('keydown', hold)
    window.addEventListener('wheel', hold, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', hold)
      window.removeEventListener('keydown', hold)
      window.removeEventListener('wheel', hold)
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [hold])

  return {
    autoCut,
    toggle: () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      armedRef.current = !armedRef.current
      setAutoCut(armedRef.current)
    },
  }
}
