import { useEffect, useRef } from 'react'

/** Coalesces calls to one a frame, keeping the LAST argument. A pointer that moves reports
 *  faster than the screen redraws — a 1000Hz mouse fires eight samples between two frames — and
 *  a scrub that commits each one re-renders the whole app eight times to draw once. */
export function useFrameCoalesced<T>(run: (value: T) => void): (value: T) => void {
  const latest = useRef(run)
  useEffect(() => {
    latest.current = run
  })
  const pending = useRef<{ value: T } | null>(null)
  const raf = useRef(0)

  useEffect(
    () => () => {
      if (raf.current !== 0) cancelAnimationFrame(raf.current)
    },
    [],
  )

  return (value: T) => {
    pending.current = { value }
    if (raf.current !== 0) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      const held = pending.current
      pending.current = null
      if (held !== null) latest.current(held.value)
    })
  }
}
