import { useEffect, useRef, type RefObject } from 'react'
import type { Scene } from '../render/scene.js'

/** Who a stage mark is about. `structure` has no live sprite anchor, so a mark over one takes
 *  its `point` from the caller (see `useStageAnchor`). */
export type StageSubject = { id: string; kind: 'agent' | 'structure'; name: string }

/** A point in the space `tileToScreen` returns. */
export type WorldPoint = { sx: number; sy: number }

export type StageAnchor = { x: number; y: number; onScreen: boolean }

/** World point → CSS pixels inside the stage element, and whether the camera can see it.
 *  `viewRect` is that world space and `zoom` is the scale it is drawn at. */
export function screenAnchor(
  view: { x: number; y: number; w: number; h: number },
  zoom: number,
  sx: number,
  sy: number,
): StageAnchor {
  return {
    x: Math.round((sx - view.x) * zoom),
    y: Math.round((sy - view.y) * zoom),
    onScreen: sx >= view.x && sx <= view.x + view.w && sy >= view.y && sy <= view.y + view.h,
  }
}

/** Where a subject stands, from the scene's own sprite anchor — the interpolated step, not the
 *  record's tile. */
export function subjectPoint(scene: Scene, subject: StageSubject): WorldPoint | null {
  const at = scene.anchorOf?.(subject.id) ?? null
  return at === null ? null : { sx: at.x, sy: at.y }
}

/**
 * Puts a DOM mark over a world point, every frame, by writing the node's own style. A camera
 * moving at 60 fps through React state would re-render the whole overlay 60 times a second.
 */
export function useStageAnchor(
  scene: Scene | null,
  point: () => WorldPoint | null,
): RefObject<HTMLDivElement | null> {
  const el = useRef<HTMLDivElement | null>(null)
  const latest = useRef(point)
  useEffect(() => {
    latest.current = point
  })
  useEffect(() => {
    if (scene === null) return
    let raf = 0
    const step = (): void => {
      raf = requestAnimationFrame(step)
      const node = el.current
      if (node === null) return
      const at = latest.current()
      if (at === null) {
        node.style.visibility = 'hidden'
        return
      }
      const a = screenAnchor(scene.viewRect(), scene.getZoom(), at.sx, at.sy)
      node.style.visibility = a.onScreen ? 'visible' : 'hidden'
      node.style.transform = `translate(${a.x}px, ${a.y}px)`
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [scene])
  return el
}
