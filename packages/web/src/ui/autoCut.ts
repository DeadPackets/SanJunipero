import { useEffect, useState } from 'react'

/** How long the camera waits after the last input before the director takes it back. */
export const IDLE_HANDBACK_MS = 20_000

/**
 * The director owns the camera by default; any pointer or key input takes it, and twenty quiet
 * seconds hand it back. `D` toggles the hold outright — a viewer who wants to drive keeps it.
 */
export function useAutoCut(): { autoCut: boolean; toggle: () => void } {
  const [heldAtMs, setHeldAtMs] = useState<number | null>(null)

  useEffect(() => {
    const take = (): void => {
      setHeldAtMs(performance.now())
    }
    window.addEventListener('pointerdown', take)
    window.addEventListener('keydown', take)
    window.addEventListener('wheel', take, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', take)
      window.removeEventListener('keydown', take)
      window.removeEventListener('wheel', take)
    }
  }, [])

  useEffect(() => {
    if (heldAtMs === null) return
    const t = setTimeout(() => {
      setHeldAtMs(null)
    }, IDLE_HANDBACK_MS)
    return () => {
      clearTimeout(t)
    }
  }, [heldAtMs])

  return {
    autoCut: heldAtMs === null,
    toggle: () => {
      setHeldAtMs((prev) => (prev === null ? performance.now() : null))
    },
  }
}
