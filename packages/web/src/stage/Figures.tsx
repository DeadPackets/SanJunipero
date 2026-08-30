import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { WorldState } from '@sj/engine/state'
import { rectInView } from '../render/cull.js'
import type { Scene } from '../render/scene.js'
import type { WorldStore } from '../state/worldStore.js'
import { joinStageLoop, screenAnchor, type Subject } from './anchor.js'

/** Every living body the camera can see, nearest the middle of the picture first — the order
 *  Tab walks them in. Ties break on id, so two people equally far out never swap places. */
export function figuresInView(scene: Scene, state: WorldState | null): Subject[] {
  if (state === null) return []
  const view = scene.viewRect()
  const cx = view.x + view.w / 2
  const cy = view.y + view.h / 2
  const found: { subject: Subject; away: number }[] = []
  for (const a of Object.values(state.agents)) {
    if (!a.alive) continue
    const at = scene.pointOf('agent', a.id)
    if (at === null || !rectInView(at.sx, at.sy, at.sx, at.sy, view, 0)) continue
    const away = (at.sx - cx) ** 2 + (at.sy - cy) ** 2
    found.push({ subject: { id: a.id, kind: 'agent', name: a.name }, away })
  }
  found.sort((p, q) => p.away - q.away || p.subject.id.localeCompare(q.subject.id))
  return found.map((f) => f.subject)
}

/** The box a body fills at zoom 1, and the smallest the ring may get: at the overview stop a
 *  figure is a few pixels tall, and a ring nobody can see is not a focus ring. */
const FIGURE_W = 28,
  FIGURE_H = 44
const RING_MIN_W = 14,
  RING_MIN_H = 22

type Placed = { x: number; y: number; w: number; shown: boolean }

/**
 * The keyboard's way to a figure: one focusable box over each person the camera can see, in
 * nearest-first order, so Tab and Shift-Tab walk the town the way a pointer would. The boxes
 * take no clicks — the canvas owns the pointer — and show nothing but their focus ring.
 */
export function Figures({
  scene,
  store,
  paperOpen,
  onFocus,
  onOpen,
}: {
  scene: Scene | null
  store: WorldStore
  /** with the sheet up, Tab out of it must not land on forty invisible figure buttons */
  paperOpen: boolean
  /** the figure the keyboard is on, or null when it has left the layer */
  onFocus: (subject: Subject | null) => void
  /** Enter on a figure: the ring opens round it */
  onOpen: (subject: Subject) => void
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  // The order is read once a world snapshot, not once a frame: a tab order that re-sorted
  // under the finger would move the next stop between two presses.
  const figures = useMemo(() => (scene === null ? [] : figuresInView(scene, state)), [scene, state])
  const layer = useRef<HTMLDivElement>(null)
  const nodes = useRef(new Map<string, HTMLButtonElement>())
  const placed = useRef(new Map<string, Placed>())

  useEffect(() => {
    if (scene === null) return
    return joinStageLoop(() => {
      const view = scene.viewRect()
      const zoom = scene.getZoom()
      // The ring frames the body, so it is the size the body is DRAWN, not a fixed CSS box.
      const w = Math.max(RING_MIN_W, Math.round(FIGURE_W * zoom))
      const h = Math.max(RING_MIN_H, Math.round(FIGURE_H * zoom))
      for (const [id, node] of nodes.current) {
        const at = scene.pointOf('agent', id)
        const a =
          at === null ? { x: 0, y: 0, onScreen: false } : screenAnchor(view, zoom, at.sx, at.sy)
        const was = placed.current.get(id)
        if (was?.x === a.x && was.y === a.y && was.w === w && was.shown === a.onScreen) continue
        placed.current.set(id, { x: a.x, y: a.y, w, shown: a.onScreen })
        node.style.transform = `translate(${a.x}px, ${a.y}px)`
        node.style.width = `${w}px`
        node.style.height = `${h}px`
        // the anchor is where a body stands, so the box rises from its feet
        node.style.margin = `${-h}px 0 0 ${-Math.round(w / 2)}px`
        // A body that has walked out of the picture is not a stop on the way to the signpost.
        // `visibility` takes the walked-off body out of the tab order too, so the stop set
        // moves with the snapshot rather than 60 times a second under the finger.
        node.style.visibility = a.onScreen ? 'visible' : 'hidden'
      }
    })
  }, [scene])

  if (scene === null) return null
  return (
    <div className="stage-figures" role="group" aria-label="People the camera can see" ref={layer}>
      {figures.map((f) => (
        <button
          key={f.id}
          type="button"
          className="stage-figure"
          tabIndex={paperOpen ? -1 : 0}
          aria-label={f.name}
          ref={(el) => {
            // `placed` is keyed by agent and bounded by the town, and every entry is
            // overwritten on the next frame: dropping it re-wrote 200 styles per sheet open.
            if (el === null) nodes.current.delete(f.id)
            else nodes.current.set(f.id, el)
          }}
          onFocus={() => {
            onFocus(f)
          }}
          onBlur={(e) => {
            // Tabbing between two figures fired blur before focus, which unmounted the plate
            // and replayed its fade on every press.
            if (layer.current?.contains(e.relatedTarget) === true) return
            onFocus(null)
          }}
          onClick={() => {
            onOpen(f)
          }}
        />
      ))}
    </div>
  )
}
