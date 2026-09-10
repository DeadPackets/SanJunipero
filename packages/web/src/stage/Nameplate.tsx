import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { personAt } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import type { Scene } from '../render/scene.js'
import type { Rect } from '../render/tooltip.js'
import type { WorldStore } from '../state/worldStore.js'
import {
  joinStageLoop,
  screenAnchor,
  subjectPoint,
  type Subject,
  type WorldPoint,
} from './anchor.js'

/** `.stage-plate` is `translate(-50%, 60px)` off the anchor — chromeCss.test.ts pins it. */
export const PLATE_DROP_PX = 60

export type PlateSize = { w: number; h: number }

const UNMEASURED: PlateSize = { w: 0, h: 0 }

/** Where one plate goes this frame, and the box it takes off the labels that read the same
 *  occupancy. `box` is null while the map draws nobody there. */
export type PlatePlace = { id: string; x: number; y: number; shown: boolean; box: Rect | null }

/** The plate in the view's own space. It is drawn in the DOM, in CSS pixels the camera does
 *  not scale, so its world footprint shrinks as the town is zoomed in. */
function plateRect(zoom: number, at: WorldPoint, size: PlateSize): Rect {
  return {
    x: at.sx - size.w / 2 / zoom,
    y: at.sy + PLATE_DROP_PX / zoom,
    w: size.w / zoom,
    h: size.h / zoom,
  }
}

/** Who wears a plate: the people the camera is framing, named as the world names them, plus
 *  whoever the keyboard or the ring is on. A cast id the world does not hold gets none, because
 *  a guessed name is worse than no name. */
export function platedCast(
  agents: WorldState['agents'] | undefined,
  cast: readonly string[],
  focus: Subject | null,
): Subject[] {
  const out: Subject[] = focus === null ? [] : [focus]
  for (const id of cast) {
    const a = personAt(agents, id)
    if (a === undefined || out.some((s) => s.id === id)) continue
    out.push({ id, kind: 'agent', name: a.name })
  }
  return out
}

const plateLine = (plates: readonly Subject[]): string =>
  plates.map((s) => `${s.id} ${s.name}`).join('\n')

/** The same plate list back while the names read the same. The world state is a new object every
 *  tick, and a list rebuilt off that would re-render every plate in the DOM as often. */
export function platedReader(
  agentsOf: () => WorldState['agents'] | undefined,
  cast: readonly string[],
  focus: Subject | null,
): () => Subject[] {
  let line = ''
  let held: Subject[] = []
  return () => {
    const next = platedCast(agentsOf(), cast, focus)
    const said = plateLine(next)
    if (said !== line) {
      line = said
      held = next
    }
    return held
  }
}

/** One frame of the plate layer, read off the camera the shot is actually drawn through. */
export function platePlaces(
  scene: Scene,
  plates: readonly Subject[],
  sizeOf: (id: string) => PlateSize,
): PlatePlace[] {
  // `viewRect()` allocates, so it is read only when there is a plate to place
  if (plates.length === 0) return []
  const view = scene.viewRect()
  const zoom = scene.getZoom()
  return plates.map((s) => {
    const at = subjectPoint(scene, s)
    if (at === null) return { id: s.id, x: 0, y: 0, shown: false, box: null }
    const a = screenAnchor(view, zoom, at.sx, at.sy)
    return { id: s.id, x: a.x, y: a.y, shown: a.onScreen, box: plateRect(zoom, at, sizeOf(s.id)) }
  })
}

/** Where a plate was last told to stand. */
type PlateAt = { x: number; y: number; shown: boolean }

/** Only the two things a frame writes, so a frame can be driven without a browser. */
type PlateNode = { style: { visibility: string; transform: string } }

/** Writes the plates that moved and no others: a style write per plate per frame is a layout
 *  the browser never needed, and under a standing camera nothing moves at all. */
export function writePlates(
  places: readonly PlatePlace[],
  nodeOf: (id: string) => PlateNode | undefined,
  last: Map<string, PlateAt>,
): void {
  for (const at of places) {
    const node = nodeOf(at.id)
    if (node === undefined) continue
    const was = last.get(at.id)
    if (was?.x === at.x && was.y === at.y && was.shown === at.shown) continue
    last.set(at.id, { x: at.x, y: at.y, shown: at.shown })
    node.style.visibility = at.shown ? 'visible' : 'hidden'
    node.style.transform = `translate(${at.x}px, ${at.y}px)`
  }
}

export function Nameplate({
  store,
  scene,
  cast,
  focus,
}: {
  store: WorldStore
  scene: Scene | null
  /** who the director put in frame */
  cast: readonly string[]
  /** the figure the keyboard is on, or the one the ring is open round */
  focus: Subject | null
}) {
  const readPlates = useMemo(
    () => platedReader(() => store.getState()?.agents, cast, focus),
    [store, cast, focus],
  )
  const plates = useSyncExternalStore(store.subscribe, readPlates, readPlates)
  const nodes = useRef(new Map<string, HTMLDivElement>())
  // Measured once a name, not once a frame: reading a layout box inside the loop would force
  // a reflow every frame.
  const size = useRef(new Map<string, PlateSize>())
  useEffect(() => {
    for (const [id, el] of nodes.current)
      size.current.set(id, { w: el.offsetWidth, h: el.offsetHeight })
  }, [plates])

  // The cast changes with every snapshot, so the loop reads it off a ref: joining and leaving
  // the one stage loop several times a second would drop a frame of every other mark with it.
  const latest = useRef(plates)
  useEffect(() => {
    latest.current = plates
  })

  // Nothing on the canvas can see a DOM label, so the plates publish their boxes to the one
  // occupancy every label reads — otherwise a bubble pushed below a figure lands on a plate.
  useEffect(() => {
    if (scene === null) return
    const sizeOf = (id: string): PlateSize => size.current.get(id) ?? UNMEASURED
    const last = new Map<string, PlateAt>()
    const off = joinStageLoop(() => {
      const places = platePlaces(scene, latest.current, sizeOf)
      const boxes: Rect[] = []
      for (const place of places) if (place.box !== null) boxes.push(place.box)
      writePlates(places, (id) => nodes.current.get(id), last)
      scene.tags.setOccupied('plate', boxes)
    })
    return () => {
      off()
      scene.tags.setOccupied('plate', [])
    }
  }, [scene])

  if (scene === null) return null
  return (
    <>
      {plates.map((s) => (
        <div
          key={s.id}
          ref={(el) => {
            if (el === null) nodes.current.delete(s.id)
            else nodes.current.set(s.id, el)
          }}
          className="stage-plate"
          aria-hidden="true"
        >
          {s.name}
        </div>
      ))}
    </>
  )
}
