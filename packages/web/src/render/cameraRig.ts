import type { Application, Container, FederatedPointerEvent } from 'pixi.js'
import {
  boundsCentre,
  type CameraBounds,
  clampCamera,
  fitStop,
  initialZoom,
  resizeIntent,
  tooBigToFit,
  WHEEL_GESTURE_GAP_MS,
  type ZoomState,
  type ZoomStop,
  zoomGestureEnded,
  zoomRelease,
  zoomScaleAt,
  zoomSettled,
  zoomTo,
  zoomPinch,
  zoomWheel,
} from './camera.js'
import { type DragTrack, type Fling, flingFrom, flingStep, isDrag, trackDrag } from './fling.js'
import { screenToTile, tileToScreen } from './iso.js'

/** What the rig has to ask the scene: the box the camera may reach, and what is standing. */
export type CameraRigDeps = {
  reachable: () => CameraBounds
  /** the settlement AS DRAWN, or the reachable box when nothing has been built yet */
  town: () => CameraBounds
}

/** Everything imperative about the camera. `place` is deliberately not on this surface. */
export type CameraRig = {
  /** Re-clamp where the camera already is — for a stage that changed size under it. */
  onResize: () => void
  panBy: (dx: number, dy: number) => void
  travelTo: (sx: number, sy: number) => void
  centerHome: () => void
  centerOn: (x: number, y: number) => void
  centerOnScreen: (sx: number, sy: number) => void
  setZoom: (stop: ZoomStop) => void
  setZoomAt: (stop: ZoomStop, screenX: number, screenY: number) => void
  getZoom: () => number
  getZoomStop: () => ZoomStop
  wantsMotion: () => boolean
  fitToTown: () => void
  fitsWholeTown: () => boolean
  onCamera: (cb: () => void) => () => void
  setFollow: (target: (() => { x: number; y: number } | null) | null) => void
  onFollowEnd: (cb: () => void) => () => void
  onTilePointer: (cb: (t: { x: number; y: number }) => void) => void
  destroy: () => void
}

export function createCameraRig(
  app: Application,
  world: Container,
  deps: CameraRigDeps,
): CameraRig {
  const screenBox = (): { w: number; h: number } => ({ w: app.screen.width, h: app.screen.height })

  const cameraCbs: (() => void)[] = []
  const notifyCamera = (): void => {
    for (const cb of cameraCbs) cb()
  }

  // The camera's own position is a float, so a lerp and a fling keep their curves; the world
  // container lands on a whole pixel, so `roundPixels` cannot snap the ground and the bodies
  // on different frames.
  const cam = { x: 0, y: 0 }

  /** The one writer of the camera's position, and therefore the one that fires `onCamera` —
   *  a mover added later cannot forget to announce itself. `announce: false` is for the one
   *  caller that changes the scale too and announces both at once. */
  function place(x: number, y: number, announce = true): void {
    const p = clampCamera({ x, y }, world.scale.x, deps.reachable(), screenBox())
    cam.x = p.x
    cam.y = p.y
    const rx = Math.round(p.x),
      ry = Math.round(p.y)
    if (rx === world.position.x && ry === world.position.y) return
    world.position.set(rx, ry)
    if (announce) notifyCamera()
  }

  function centerOnScreen(sx: number, sy: number): void {
    place(app.screen.width / 2 - sx * world.scale.x, app.screen.height / 2 - sy * world.scale.y)
  }

  function centerOn(x: number, y: number): void {
    const { sx, sy } = tileToScreen(x, y)
    centerOnScreen(sx, sy)
  }

  /** True while the camera shows the whole town, so a resize refits rather than reclamping. */
  let fitted = false

  function fitTo(stop: ZoomStop): void {
    stopGlide()
    breakFollow()
    const c = boundsCentre(deps.town())
    anchor = { sx: app.screen.width / 2, sy: app.screen.height / 2, wx: c.sx, wy: c.sy }
    fitted = true
    if (stop === zoom.stop) {
      centerOnScreen(c.sx, c.sy)
      notifyCamera()
      return
    }
    zoom = zoomTo(zoom, stop, performance.now())
  }

  function fitToTown(): void {
    fitTo(fitStop(deps.town(), screenBox()))
  }

  const fitsWholeTown = (): boolean => !tooBigToFit(deps.town(), screenBox())

  // smooth follow: eases the camera toward a moving world-space anchor each frame
  let followFn: (() => { x: number; y: number } | null) | null = null
  const followEndCbs: (() => void)[] = []
  const breakFollow = (): void => {
    if (followFn === null) return
    followFn = null
    for (const cb of followEndCbs) cb()
  }
  const followTick = (): void => {
    if (followFn === null) return
    const t = followFn()
    if (t === null) return
    const tx = app.screen.width / 2 - t.x * world.scale.x
    const ty = app.screen.height / 2 - t.y * world.scale.y
    // frame-rate independent lerp (~12%/frame at 60fps)
    const k = 1 - Math.pow(0.88, app.ticker.deltaMS / 16.7)
    place(cam.x + (tx - cam.x) * k, cam.y + (ty - cam.y) * k)
  }
  app.ticker.add(followTick)

  // Rest stops stay exact so the pixel grid stays exact; the eased transit turns about the
  // world point under the POINTER, so zooming toward a thing keeps that thing where it is.
  let zoom: ZoomState = initialZoom(1)
  let anchor = { sx: 0, sy: 0, wx: 0, wy: 0 }

  function captureAnchor(sx: number, sy: number): void {
    const k = world.scale.x || 1
    anchor = { sx, sy, wx: (sx - cam.x) / k, wy: (sy - cam.y) / k }
  }

  function setZoomAt(stop: ZoomStop, screenX: number, screenY: number): void {
    if (stop === zoom.stop && zoomSettled(zoom, performance.now())) return
    fitted = false
    captureAnchor(screenX, screenY)
    zoom = zoomTo(zoom, stop, performance.now())
  }

  const setZoom = (stop: ZoomStop): void => {
    setZoomAt(stop, app.screen.width / 2, app.screen.height / 2)
  }

  // The release lives here and not in `onWheel`, because the end of a gesture is the ABSENCE
  // of an event: nothing arrives to notice it, and the frame is the only thing still running.
  const zoomTick = (): void => {
    const now = performance.now()
    // reduced motion gets the exact stop immediately; the tracking during the gesture stays,
    // because that was the viewer's own hand and not motion we chose for them.
    // A pinch held still is still a hand on the camera; only a wheel goes quiet mid-gesture.
    if (pinch === null && zoomGestureEnded(zoom, now)) zoom = zoomRelease(zoom, now, !wantsMotion())
    const s = zoomScaleAt(zoom, now)
    if (s === world.scale.x) return
    world.scale.set(s)
    // While a follow is running it owns the position; otherwise the anchor stays put.
    if (followFn === null) place(anchor.sx - anchor.wx * s, anchor.sy - anchor.wy * s, false)
    else place(cam.x, cam.y, false)
    notifyCamera()
  }

  // camera: drag to pan, wheel steps integer zoom 1-4; the hand shows it
  app.stage.eventMode = 'static'
  app.stage.hitArea = app.screen
  app.renderer.events.cursorStyles.default = 'grab'
  // One tracker answers both questions the pointer raises: `isDrag` tells a tile pick from a
  // pan and is the same answer the throw reads, so a click can never become a fling.
  const wantsMotion = (): boolean =>
    typeof matchMedia !== 'function' || !matchMedia('(prefers-reduced-motion: reduce)').matches

  const tileCbs: ((t: { x: number; y: number }) => void)[] = []
  let drag: DragTrack | null = null
  let dragging = false
  let last = { x: 0, y: 0 }
  let glide: Fling | null = null

  // The touch screen's wheel. Without it `touch-action: none` on the mount leaves the six zoom
  // stops with no way in at all on a phone.
  const touches = new Map<number, { x: number; y: number }>()
  let pinch: { span: number; from: number } | null = null
  const twoOf = (): [{ x: number; y: number }, { x: number; y: number }] | null => {
    const both = [...touches.values()]
    return both.length === 2 ? [both[0]!, both[1]!] : null
  }
  const spanOf = (): number => {
    const both = twoOf()
    return both === null ? 0 : Math.hypot(both[0].x - both[1].x, both[0].y - both[1].y)
  }

  /** Anything that says where the camera should be outranks something still deciding. */
  const stopGlide = (): void => {
    glide = null
  }

  app.stage.on('pointerdown', (e: FederatedPointerEvent) => {
    stopGlide() // catching a moving camera stops it, as a hand would
    touches.set(e.pointerId, { x: e.global.x, y: e.global.y })
    const both = twoOf()
    if (both !== null) {
      dragging = false
      app.canvas.style.cursor = 'grab'
      fitted = false
      breakFollow()
      captureAnchor((both[0].x + both[1].x) / 2, (both[0].y + both[1].y) / 2)
      pinch = { span: spanOf(), from: zoomScaleAt(zoom, performance.now()) }
      return
    }
    dragging = true
    drag = trackDrag(null, e.global.x, e.global.y, performance.now())
    last = { x: e.global.x, y: e.global.y }
    app.canvas.style.cursor = 'grabbing'
  })
  app.stage.on('pointermove', (e: FederatedPointerEvent) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.global.x, y: e.global.y })
    if (pinch !== null) {
      const span = spanOf()
      if (span > 0) zoom = zoomPinch(zoom, pinch.from * (span / pinch.span), performance.now())
      return
    }
    if (!dragging) return
    drag = trackDrag(drag, e.global.x, e.global.y, performance.now())
    if (isDrag(drag)) {
      fitted = false
      breakFollow() // the viewer takes the camera back
    }
    place(cam.x + (e.global.x - last.x), cam.y + (e.global.y - last.y))
    last = { x: e.global.x, y: e.global.y }
  })
  const endDrag = (e?: FederatedPointerEvent): void => {
    if (e !== undefined) touches.delete(e.pointerId)
    // The second finger leaving ends the pinch, and the first one left is not a new pan.
    if (touches.size < 2) pinch = null
    if (dragging && wantsMotion()) glide = flingFrom(drag, performance.now())
    dragging = false
    app.canvas.style.cursor = 'grab'
  }
  app.stage.on('pointerup', endDrag)
  app.stage.on('pointerupoutside', endDrag)
  app.stage.on('pointercancel', endDrag)
  // The screen-sized `app.stage.hitArea` must stay: drag-to-pan, the fling and the wheel-zoom
  // anchor are all `app.stage` handlers and each needs a target under the pointer.
  app.stage.on('pointertap', (e: FederatedPointerEvent) => {
    if (isDrag(drag)) return // a drag is not a tile pick
    if (e.target !== app.stage) return // nor is a click that landed on a body or a building
    const wx = (e.global.x - world.position.x) / world.scale.x
    const wy = (e.global.y - world.position.y) / world.scale.y
    const t = screenToTile(wx, wy)
    for (const cb of tileCbs) cb(t)
  })

  // The glide, one frame at a time. A throw that reaches the edge of the world is over: the
  // clamp refused the move, and a camera grinding against a wall it cannot cross is not motion.
  const glideTick = (): void => {
    if (glide === null) return
    const step = flingStep(glide, app.ticker.deltaMS)
    glide = step.next
    const before = { x: cam.x, y: cam.y }
    place(before.x + step.dx, before.y + step.dy)
    if (cam.x === before.x && cam.y === before.y) stopGlide()
  }
  app.ticker.add(glideTick)

  // Read the delta, ask the pure rule, store. The DOM half has no logic (P6) — except for the
  // one thing only the DOM knows: `ctrlKey` is how the platform says "this was a pinch".
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    // A zoom pins the world point under the cursor; a camera still gliding would tear it out
    // from under the anchor, which is the class of defect the wheel gate already exists for.
    stopGlide()
    const now = performance.now()
    // Once per gesture, not once per step: a continuous zoom moves the scale on every event,
    // and re-pinning each time makes the town swim under the cursor instead of growing.
    if (zoom.live === null || now - zoom.lastWheelMs > WHEEL_GESTURE_GAP_MS) {
      fitted = false
      captureAnchor(e.offsetX, e.offsetY)
    }
    zoom = zoomWheel(zoom, e.deltaY, now, e.ctrlKey)
  }
  app.canvas.addEventListener('wheel', onWheel, { passive: false })
  app.ticker.add(zoomTick)

  return {
    onResize: () => {
      const intent = resizeIntent(fitted, deps.town(), screenBox())
      if (intent.kind === 'refit') fitTo(intent.stop)
      else place(cam.x, cam.y)
    },
    panBy: (dx, dy) => {
      stopGlide()
      fitted = false
      breakFollow()
      place(cam.x + dx, cam.y + dy)
    },
    travelTo: (sx, sy) => {
      stopGlide()
      fitted = false
      breakFollow()
      centerOnScreen(sx, sy)
      notifyCamera()
    },
    centerHome: () => {
      stopGlide()
      fitted = false
      breakFollow()
      const c = boundsCentre(deps.town())
      centerOnScreen(c.sx, c.sy)
      notifyCamera()
    },
    centerOn,
    centerOnScreen,
    setZoom,
    setZoomAt,
    getZoom: () => world.scale.x,
    getZoomStop: () => zoom.stop,
    wantsMotion,
    fitToTown,
    fitsWholeTown,
    onCamera: (cb) => {
      cameraCbs.push(cb)
      return () => {
        const i = cameraCbs.indexOf(cb)
        if (i >= 0) cameraCbs.splice(i, 1)
      }
    },
    setFollow: (target) => {
      if (target !== null) {
        fitted = false
        stopGlide() // a follow owns the camera; a leftover throw would fight it
      }
      followFn = target
    },
    onFollowEnd: (cb) => {
      followEndCbs.push(cb)
      return () => {
        const i = followEndCbs.indexOf(cb)
        if (i >= 0) followEndCbs.splice(i, 1)
      }
    },
    onTilePointer: (cb) => {
      tileCbs.push(cb)
    },
    destroy: () => {
      app.ticker.remove(followTick)
      app.ticker.remove(zoomTick)
      app.ticker.remove(glideTick)
      app.canvas.removeEventListener('wheel', onWheel)
    },
  }
}
