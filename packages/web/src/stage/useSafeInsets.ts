import { useEffect } from 'react'
import type { Scene } from '../render/scene.js'

/** The chrome that stands over the canvas at its top edge and at its bottom edge. */
export const TOP_BAND: readonly string[] = ['.sky-bar']
export const BOTTOM_BAND: readonly string[] = ['.stage-cue', '.lower-third']

type Box = { top: number; bottom: number; height: number }

/** How far each band reaches into the canvas, in screen px, from the boxes the marks draw: an
 *  empty or hidden mark has no height and reserves nothing. */
export function insetsOf(
  canvas: Box,
  tops: readonly Box[],
  bottoms: readonly Box[],
): { top: number; bottom: number } {
  const top = Math.max(0, ...tops.filter((r) => r.height > 0).map((r) => r.bottom - canvas.top))
  const bottom = Math.max(
    0,
    ...bottoms.filter((r) => r.height > 0).map((r) => canvas.bottom - r.top),
  )
  return { top: Math.min(top, canvas.height), bottom: Math.min(bottom, canvas.height) }
}

/** Writes the bands onto the scene handle the way `textScale` is written: the label layers live
 *  in a Pixi closure React never re-renders. Measured again whenever the chrome changes shape or
 *  words, once a frame at most. */
export function useSafeInsets(scene: Scene | null): void {
  useEffect(() => {
    if (scene === null || typeof ResizeObserver === 'undefined') return
    const root = scene.app.canvas.closest<HTMLElement>('.app')
    if (root === null) return
    const boxOf = (el: Element): Box => {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, height: r.height }
    }
    const boxes = (band: readonly string[]): Box[] =>
      band.flatMap((sel) => [...root.querySelectorAll(sel)].map(boxOf))
    let raf = 0
    const measure = (): void => {
      raf = 0
      // eslint-disable-next-line react-hooks/immutability -- Scene is an external Pixi handle; this writes to the canvas, not to React data.
      scene.safeInsets = insetsOf(boxOf(scene.app.canvas), boxes(TOP_BAND), boxes(BOTTOM_BAND))
    }
    const ask = (): void => {
      if (raf === 0) raf = requestAnimationFrame(measure)
    }
    const ro = new ResizeObserver(ask)
    ro.observe(root)
    const mo = new MutationObserver(ask)
    mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true })
    ask()
    return () => {
      ro.disconnect()
      mo.disconnect()
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [scene])
}
