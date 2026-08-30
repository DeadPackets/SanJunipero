import { useCallback, useEffect, useRef, useState } from 'react'

/** How long the camera waits after the last input before the director takes it back. */
const IDLE_HANDBACK_MS = 20_000

/** The state is the BOOLEAN, never the moment of the last input: App holds the Pixi scene,
 *  and a timestamp in state would re-render the whole tree on every keystroke. */
export function useAutoCut(): { autoCut: boolean; toggle: () => void } {
  const [autoCut, setAutoCut] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hold = useCallback(() => {
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
      if (autoCut) hold()
      else setAutoCut(true)
    },
  }
}
