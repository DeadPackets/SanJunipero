import { useEffect, useRef, type RefObject } from 'react'
import { rectInView } from '../render/cull.js'
import type { Scene } from '../render/scene.js'

export type Subject = { id: string; kind: 'agent' | 'structure'; name: string }

/** A point in the space `tileToScreen` returns. */
export type WorldPoint = { sx: number; sy: number }

export type StageAnchor = { x: number; y: number; onScreen: boolean }

/** How much room a mark needs on each side of its anchor to stay whole. */
export type Reach = { x: number; y: number }

/** A mark wider than the body it hangs off runs out of the picture near an edge: the ring round
 *  a figure at x = 20 puts its left arm at x = -55. It slides in far enough to stay whole. */
export function keepOnStage(a: StageAnchor, w: number, h: number, reach: Reach): StageAnchor {
  const hold = (v: number, span: number, pad: number): number =>
    span < pad * 2 ? span / 2 : Math.min(Math.max(v, pad), span - pad)
  return { ...a, x: hold(a.x, w, reach.x), y: hold(a.y, h, reach.y) }
}

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

/** Where a subject stands. The scene answers for both kinds, so a mark over a person and a
 *  mark over a place read the same point from the same place. */
export function subjectPoint(scene: Scene, subject: Subject): WorldPoint | null {
  return scene.pointOf(subject.kind, subject.id)
}

// ONE loop for every stage mark. A private rAF per mark let a plate land on a frame the ring
// beside it had not reached yet, and cost a scheduler slot per mounted mark.
const steps = new Set<() => void>()
let raf = 0

export function joinStageLoop(step: () => void): () => void {
  steps.add(step)
  if (raf === 0) {
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      for (const s of steps) s()
    }
    raf = requestAnimationFrame(tick)
  }
  return () => {
    steps.delete(step)
    if (steps.size > 0) return
    cancelAnimationFrame(raf)
    raf = 0
  }
}

/** Written to the node's own style every frame: a camera moving at 60 fps through React state
 *  would re-render the whole overlay 60 times a second. */
function useStageAnchor(
  scene: Scene | null,
  point: (() => WorldPoint | null) | null,
  reach?: Reach,
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
    return joinStageLoop(() => {
      const node = el.current
      const at = latest.current === null ? null : latest.current()
      if (node === null) return
      let a: StageAnchor = { x: 0, y: 0, onScreen: false }
      if (at !== null) {
        // `viewRect()` allocates, so it is read only when there is a point to place
        const view = scene.viewRect()
        const zoom = scene.getZoom()
        a = screenAnchor(view, zoom, at.sx, at.sy)
        if (reach !== undefined && a.onScreen) {
          a = keepOnStage(a, view.w * zoom, view.h * zoom, reach)
        }
      }
      const was = last.current
      if (a.x === was.x && a.y === was.y && a.onScreen === was.shown) return
      last.current = { x: a.x, y: a.y, shown: a.onScreen }
      node.style.visibility = a.onScreen ? 'visible' : 'hidden'
      node.style.transform = `translate(${a.x}px, ${a.y}px)`
    })
  }, [scene, idle, reach])
  return el
}

export function useSubjectAnchor(
  scene: Scene | null,
  subject: Subject | null,
  reach?: Reach,
): RefObject<HTMLDivElement | null> {
  return useStageAnchor(
    scene,
    scene === null || subject === null ? null : () => subjectPoint(scene, subject),
    reach,
  )
}
