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

type Placed = { x: number; y: number; shown: boolean }

/**
 * The keyboard's way to a figure: one focusable box over each person the camera can see, in
 * nearest-first order, so Tab and Shift-Tab walk the town the way a pointer would. The boxes
 * take no clicks — the canvas owns the pointer — and show nothing but their focus ring.
 */
export function Figures({
  scene,
  store,
  onFocus,
  onOpen,
}: {
  scene: Scene | null
  store: WorldStore
  /** the figure the keyboard is on, or null when it has left the layer */
  onFocus: (subject: Subject | null) => void
  /** Enter on a figure: the ring opens round it */
  onOpen: (subject: Subject) => void
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  // The order is read once a world snapshot, not once a frame: a tab order that re-sorted
  // under the finger would move the next stop between two presses.
  const figures = useMemo(() => (scene === null ? [] : figuresInView(scene, state)), [scene, state])
  const nodes = useRef(new Map<string, HTMLButtonElement>())
  const placed = useRef(new Map<string, Placed>())

  useEffect(() => {
    if (scene === null) return
    return joinStageLoop(() => {
      const view = scene.viewRect()
      const zoom = scene.getZoom()
      for (const [id, node] of nodes.current) {
        const at = scene.pointOf('agent', id)
        const a =
          at === null ? { x: 0, y: 0, onScreen: false } : screenAnchor(view, zoom, at.sx, at.sy)
        const was = placed.current.get(id)
        if (was?.x === a.x && was.y === a.y && was.shown === a.onScreen) continue
        placed.current.set(id, { x: a.x, y: a.y, shown: a.onScreen })
        node.style.transform = `translate(${a.x}px, ${a.y}px)`
        // A body that has walked out of the picture is not a stop on the way to the signpost.
        node.style.visibility = a.onScreen ? 'visible' : 'hidden'
        node.tabIndex = a.onScreen ? 0 : -1
      }
    })
  }, [scene])

  if (scene === null) return null
  return (
    <div className="stage-figures">
      {figures.map((f) => (
        <button
          key={f.id}
          type="button"
          className="stage-figure"
          tabIndex={-1}
          aria-label={f.name}
          ref={(el) => {
            if (el === null) {
              nodes.current.delete(f.id)
              placed.current.delete(f.id)
            } else nodes.current.set(f.id, el)
          }}
          onFocus={() => {
            onFocus(f)
          }}
          onBlur={() => {
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
