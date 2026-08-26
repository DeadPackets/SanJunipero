import { useEffect, useRef } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from './scene.js'
import {
  MINIMAP_H,
  MINIMAP_W,
  dotOps,
  minimapActionFor,
  minimapFit,
  minimapPixels,
  pageTarget,
  peopleDots,
  travelTargetAt,
  viewHoldsTown,
  viewOps,
  type MapOp,
  type MapPerson,
  type MinimapFit,
} from './minimap.js'

// Every number is minimap.ts's; this file owns a 2D context, a pointer and a keyboard. It adds
// NO ticker callback — the map repaints on a camera move or a terrain change, so a camera at
// rest costs nothing.

/** The whole instrument, spoken. The keyboard half is not a fallback — an arrow travels a
 *  screenful, which the pointer cannot do at all. */
export const MINIMAP_LABEL =
  'The little map of the town. Press anywhere on it to take the camera there, or drag across it ' +
  'to sweep. The arrow keys travel a screenful at a time and Home shows the whole town.'

const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`

export function Minimap({
  scene,
  store,
  focusAgentId,
}: {
  scene: Scene | null
  /** `null` while the town is still arriving — the map draws nothing rather than a lie */
  store: WorldStore
  /** whose dot is drawn large: the person the viewer has open, and nobody by default */
  focusAgentId: string | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fitRef = useRef<MinimapFit | null>(null)
  const groundRef = useRef<ImageData | null>(null)
  const dotsRef = useRef<MapOp[]>([])
  const sceneRef = useRef<Scene | null>(scene)
  sceneRef.current = scene
  const focusRef = useRef(focusAgentId)
  focusRef.current = focusAgentId
  const paintRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (scene === null) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d') ?? null
    if (canvas === null || ctx === null) return

    let lastTerrain: unknown = null
    let lastSig = ''

    const paint = (): void => {
      const f = fitRef.current,
        ground = groundRef.current
      if (f === null || ground === null) return
      // The map leaves when the view already holds the whole town. The attribute drives the
      // sheet and React is not told: this runs on every frame of a zoom.
      const idle = viewHoldsTown(scene.viewRect(), f)
      canvas.parentElement?.setAttribute('data-idle', idle ? 'true' : 'false')
      if (idle) return
      ctx.putImageData(ground, 0, 0)
      for (const op of viewOps(scene.viewRect(), f)) {
        ctx.fillStyle = css(op.color)
        ctx.fillRect(op.x, op.y, op.w, op.h)
      }
      for (const op of dotsRef.current) {
        ctx.fillStyle = css(op.color)
        ctx.fillRect(op.x, op.y, op.w, op.h)
      }
    }
    paintRef.current = paint

    /** The ground, and the buildings on it. Rebuilt only when one of them actually moved. */
    const rebuild = (force: boolean): void => {
      const s = store.getState()
      if (s === null) return
      const b = scene.reachableBox()
      const structures = Object.values(s.structures)
      const sig = `${b.minX},${b.maxX},${b.minY},${b.maxY}|${structures.length}`
      if (!force && s.terrain === lastTerrain && sig === lastSig) return
      lastTerrain = s.terrain
      lastSig = sig
      const f = minimapFit(b)
      fitRef.current = f
      const px = minimapPixels(s.terrain, structures, f)
      groundRef.current = new ImageData(px, f.w, f.h)
    }

    /** People walk on a tick, not on a frame, so their dots are built on one. */
    const rebuildDots = (): void => {
      const s = store.getState(),
        f = fitRef.current
      if (s === null || f === null) return
      const people = Object.values(s.agents) as MapPerson[]
      dotsRef.current = dotOps(peopleDots(people, f, focusRef.current), f)
    }

    const onWorld = (): void => {
      rebuild(false)
      rebuildDots()
      paint()
    }
    // The bake is gated on the terrain array; a tile that changed under an unchanged array is
    // announced instead. `scene.ts` reads both for exactly this reason, and so does the map.
    const offEvents = store.onEvents((evts) => {
      if (!evts.some((e) => e.type === 'terrain_changed' || e.type === 'tile_changed')) return
      rebuild(true)
      paint()
    })
    const offStore = store.subscribe(onWorld)
    const offCamera = scene.onCamera(paint)
    onWorld()

    return () => {
      offEvents()
      offStore()
      offCamera()
      paintRef.current = () => {}
    }
  }, [scene, store])

  // The subject changed without the world changing: redraw her dot, do not rebuild the ground.
  useEffect(() => {
    const s = store.getState(),
      f = fitRef.current
    if (s === null || f === null) return
    const people = Object.values(s.agents) as MapPerson[]
    dotsRef.current = dotOps(peopleDots(people, f, focusAgentId), f)
    paintRef.current()
  }, [focusAgentId, store])

  /** Where on the map a pointer is, in the canvas's own pixels whatever the display scale. */
  const at = (e: React.PointerEvent): { mx: number; my: number } | null => {
    const canvas = canvasRef.current
    if (canvas === null) return null
    const r = canvas.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    return {
      mx: ((e.clientX - r.left) / r.width) * MINIMAP_W,
      my: ((e.clientY - r.top) / r.height) * MINIMAP_H,
    }
  }

  /** Press or sweep: both are one call to the guarded mover, never a write of our own. */
  const travel = (e: React.PointerEvent): void => {
    const f = fitRef.current,
      s = sceneRef.current
    const p = at(e)
    if (f === null || s === null || p === null) return
    const t = travelTargetAt(p.mx, p.my, f)
    s.travelTo(t.sx, t.sy)
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    travel(e)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    travel(e)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const s = sceneRef.current
    if (s === null) return
    const action = minimapActionFor(e.key)
    if (action === null) return
    e.preventDefault()
    if (action.kind === 'whole') {
      s.fitToTown()
      return
    }
    const t = pageTarget(s.viewRect(), action.dx, action.dy)
    s.travelTo(t.sx, t.sy)
  }

  return (
    <div
      className="minimap"
      data-idle="true"
      // `App`'s lens walk yields Left and Right to anything inside `[role="application"]`,
      // which is what lets an arrow here mean a screenful of town instead of the next lens.
      role="application"
      tabIndex={0}
      aria-label={MINIMAP_LABEL}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <canvas
        ref={canvasRef}
        className="minimap-canvas"
        width={MINIMAP_W}
        height={MINIMAP_H}
        aria-hidden="true"
      />
    </div>
  )
}
