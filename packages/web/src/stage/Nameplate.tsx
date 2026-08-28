import { useEffect, useRef } from 'react'
import type { Scene } from '../render/scene.js'
import type { Rect } from '../render/tooltip.js'
import type { WorldStore } from '../state/worldStore.js'
import {
  joinStageLoop,
  subjectPoint,
  useSubjectAnchor,
  type Subject,
  type WorldPoint,
} from './anchor.js'

/** `.stage-plate` is `translate(-50%, 4px)` off the anchor — chromeCss.test.ts pins it. */
export const PLATE_DROP_PX = 4

/** The plate in the view's own space. It is drawn in the DOM, in CSS pixels the camera does
 *  not scale, so its world footprint shrinks as the town is zoomed in. */
function plateRect(scene: Scene, at: WorldPoint, size: { w: number; h: number }): Rect {
  const k = scene.getZoom()
  return {
    x: at.sx - size.w / 2 / k,
    y: at.sy + PLATE_DROP_PX / k,
    w: size.w / k,
    h: size.h / k,
  }
}

/** A plate nailed under the figure, the way a name is written on a thing in the town — not a
 *  tooltip about it. */
export function Nameplate({
  subject,
  scene,
  store,
}: {
  subject: Subject | null
  scene: Scene | null
  /** only a `structure` subject needs it — a body carries its own sprite anchor */
  store?: WorldStore
}) {
  const ref = useSubjectAnchor(scene, subject, store)
  // Measured once a name, not once a frame: reading a layout box inside the loop would force
  // a reflow every frame.
  const size = useRef({ w: 0, h: 0 })
  const name = subject?.name ?? null
  useEffect(() => {
    const el = ref.current
    if (el !== null) size.current = { w: el.offsetWidth, h: el.offsetHeight }
  }, [name, ref])

  // Nothing on the canvas can see a DOM label, so the plate publishes its box to the one
  // occupancy every label reads — otherwise a bubble pushed below a figure lands on the plate.
  useEffect(() => {
    if (scene === null || subject === null) return
    const off = joinStageLoop(() => {
      const at = subjectPoint(scene, subject, store)
      scene.tags.setOccupied('plate', at === null ? [] : [plateRect(scene, at, size.current)])
    })
    return () => {
      off()
      scene.tags.setOccupied('plate', [])
    }
  }, [scene, subject, store])

  if (subject === null) return null
  return (
    <div ref={ref} className="stage-plate" aria-hidden="true">
      {subject.name}
    </div>
  )
}
