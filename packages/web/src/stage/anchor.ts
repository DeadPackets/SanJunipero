import { useEffect, useRef, type RefObject } from 'react'
import { rectInView } from '../render/cull.js'
import { tileToScreen } from '../render/iso.js'
import type { Scene } from '../render/scene.js'
import type { WorldStore } from '../state/worldStore.js'

/** Who a stage mark is about. */
export type StageSubject = { id: string; kind: 'agent' | 'structure'; name: string }

/** A point in the space `tileToScreen` returns. */
export type WorldPoint = { sx: number; sy: number }

export type StageAnchor = { x: number; y: number; onScreen: boolean }

/** World point → CSS pixels inside the stage element, and whether the camera can see it.
 *  `view` is that world space and `zoom` is the scale it is drawn at. */
export function screenAnchor(
  view: { x: number; y: number; w: number; h: number },
  zoom: number,
  sx: number,
  sy: number,
): StageAnchor {
  return {
    x: Math.round((sx - view.x) * zoom),
    y: Math.round((sy - view.y) * zoom),
    onScreen: rectInView(sx, sy, sx, sy, view, 0),
  }
}

/** Where a subject stands: a body's own sprite anchor (the interpolated step, not the record's
 *  tile), and a building's site. A structure needs the store — `Scene.anchorOf` is bodies only. */
export function subjectPoint(
  scene: Scene,
  subject: StageSubject,
  store?: WorldStore,
): WorldPoint | null {
  if (subject.kind === 'structure') {
    const s = store?.getState()?.structures[subject.id]
    return s === undefined ? null : tileToScreen(s.x, s.y)
  }
  const at = scene.anchorOf?.(subject.id) ?? null
  return at === null ? null : { sx: at.x, sy: at.y }
}

/**
 * Puts a DOM mark over a world point, every frame, by writing the node's own style. A camera
 * moving at 60 fps through React state would re-render the whole overlay 60 times a second.
 */
export function useStageAnchor(
  scene: Scene | null,
  point: (() => WorldPoint | null) | null,
): RefObject<HTMLDivElement | null> {
  const el = useRef<HTMLDivElement | null>(null)
  const latest = useRef(point)
  const last = useRef({ x: 0, y: 0, shown: false })
  const idle = scene === null || point === null
  useEffect(() => {
    latest.current = point
  })
  useEffect(() => {
    if (idle) return
    let raf = 0
    const step = (): void => {
      raf = requestAnimationFrame(step)
      const node = el.current
      const at = latest.current === null ? null : latest.current()
      if (node === null) return
      const a =
        at === null
          ? { x: 0, y: 0, onScreen: false }
          : screenAnchor(scene.viewRect(), scene.getZoom(), at.sx, at.sy)
      const was = last.current
      if (a.x === was.x && a.y === was.y && a.onScreen === was.shown) return
      last.current = { x: a.x, y: a.y, shown: a.onScreen }
      node.style.visibility = a.onScreen ? 'visible' : 'hidden'
      node.style.transform = `translate(${a.x}px, ${a.y}px)`
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [scene, idle])
  return el
}

/** The anchor every mark about a person or a building uses. */
export function useSubjectAnchor(
  scene: Scene | null,
  subject: StageSubject | null,
  store?: WorldStore,
): RefObject<HTMLDivElement | null> {
  return useStageAnchor(
    scene,
    scene === null || subject === null ? null : () => subjectPoint(scene, subject, store),
  )
}
