import { useEffect } from 'react'
import type { Scene } from '../render/scene.js'

/** The chrome that stands over the canvas at its top edge and at its bottom edge. The arms are
 *  a top mark on a short or a narrow window and a bottom-right corner mark otherwise, and
 *  `insetsOf` reads which edge they actually reached rather than being told. */
export const TOP_BAND: readonly string[] = [
  '.day-bar',
  '.camera-bookmark',
  '.signpost',
  '.stage-exit',
  '.stage-live',
  '.interior-hud',
]
export const BOTTOM_BAND: readonly string[] = [
  '.stage-cue',
  '.lower-third',
  '.signpost',
  '.keepsake',
]
const DOCK = '.paper[data-dock="on"]'

type Box = { top: number; bottom: number; height: number }

/** How far each band reaches into the canvas, in screen px, from the boxes the marks draw: an
 *  empty or hidden mark has no height and reserves nothing, and a mark listed for an edge it is
 *  not standing at this size reserves nothing either. */
export function insetsOf(
  canvas: Box,
  tops: readonly Box[],
  bottoms: readonly Box[],
): { top: number; bottom: number } {
  const middle = canvas.top + canvas.height / 2
  const top = Math.max(
    0,
    ...tops.filter((r) => r.height > 0 && r.top < middle).map((r) => r.bottom - canvas.top),
  )
  const bottom = Math.max(
    0,
    ...bottoms.filter((r) => r.height > 0 && r.bottom > middle).map((r) => canvas.bottom - r.top),
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

      const dock = root.querySelector(`${DOCK}[data-open="yes"][aria-modal="false"]`)
      scene.safeInsets = {
        ...insetsOf(boxOf(scene.app.canvas), boxes(TOP_BAND), boxes(BOTTOM_BAND)),
        right: dock?.getBoundingClientRect().width ?? 0,
      }
    }
    const ask = (): void => {
      if (raf === 0) raf = requestAnimationFrame(measure)
    }
    const ro = new ResizeObserver(ask)
    const selector = [...TOP_BAND, ...BOTTOM_BAND, DOCK].join(',')
    const observed = new Set<Element>()
    const observeBands = (): void => {
      const bands = new Set<Element>([root, ...root.querySelectorAll(selector)])
      for (const el of observed) {
        if (!bands.has(el)) {
          ro.unobserve(el)
          observed.delete(el)
        }
      }
      for (const el of bands) {
        if (!observed.has(el)) {
          ro.observe(el)
          observed.add(el)
        }
      }
    }
    observeBands()
    const mo = new MutationObserver((changes) => {
      const bandChanged = changes.some((change) => {
        const target = change.target
        if (change.type === 'attributes')
          return target === root || (target instanceof Element && target.closest(selector) !== null)
        return [...change.addedNodes, ...change.removedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.matches(selector) || node.querySelector(selector) !== null),
        )
      })
      if (bandChanged) {
        observeBands()
        ask()
      }
    })
    mo.observe(root, { childList: true, subtree: true, attributes: true })
    ask()
    return () => {
      ro.disconnect()
      mo.disconnect()
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [scene])
}
