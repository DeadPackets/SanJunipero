import { useEffect, useRef, useState } from 'react'
import { cameraHand } from '../ui/autoCut.js'

/** How long the town's own name for the camera stands after a hand comes off the lens. */
export const HANDBACK_CHIP_MS = 2500

/** Auto is what the town does when nobody touches it, so the chip names it for the moment the
 *  camera comes back and never before a hand has been on it. */
export function chipLabel(
  autoCut: boolean,
  handbackAt: number | null,
  autoSinceMs: number | null,
  nowMs: number,
): string | null {
  if (!autoCut) return cameraHand(false, handbackAt, nowMs)
  if (autoSinceMs === null || nowMs - autoSinceMs >= HANDBACK_CHIP_MS) return null
  return cameraHand(true, null, nowMs)
}

/** Whose hand is on the lens, and when the town gets it back. The clock runs on the chip's own
 *  second so that a pan is one line of chrome redrawn and not a re-render of the town. */
export function CameraChip({
  autoCut,
  handbackAt,
}: {
  autoCut: boolean
  handbackAt: () => number | null
}) {
  const held = useRef(false)
  const [autoSince, setAutoSince] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = (): void => {
      const at = Date.now()
      setAutoSince(autoCut ? at : null)
      setNow(at)
    }
    if (autoCut && !held.current) return
    held.current = true
    tick()
    if (!autoCut) {
      const id = setInterval(() => {
        setNow(Date.now())
      }, 1000)
      return () => {
        clearInterval(id)
      }
    }
    const id = setTimeout(() => {
      setNow(Date.now())
    }, HANDBACK_CHIP_MS)
    return () => {
      clearTimeout(id)
    }
  }, [autoCut])
  const label = chipLabel(autoCut, handbackAt(), autoSince, now)
  if (label === null) return null
  return (
    <p className="camera-chip" data-hand={autoCut ? undefined : 'on'}>
      {label}
    </p>
  )
}
