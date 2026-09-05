import { Container } from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZOOM_SETTLE_MS, ZOOM_STOPS, type ZoomStop } from './camera.js'
import { createCameraRig } from './cameraRig.js'

type Tick = () => void

function fakeApp(): {
  app: Parameters<typeof createCameraRig>[0]
  ticks: Tick[]
  dt: { ms: number }
} {
  const ticks: Tick[] = []
  const dt = { ms: 16.7 }
  const app = {
    screen: { width: 1440, height: 900 },
    ticker: {
      add: (fn: Tick) => ticks.push(fn),
      remove: (fn: Tick) => ticks.splice(ticks.indexOf(fn), 1),
      get deltaMS() {
        return dt.ms
      },
    },
    stage: { eventMode: 'none', hitArea: null, on: () => undefined },
    renderer: { events: { cursorStyles: { default: '' } } },
    canvas: { style: {}, addEventListener: () => undefined, removeEventListener: () => undefined },
  }
  return { app: app as unknown as Parameters<typeof createCameraRig>[0], ticks, dt }
}

const WIDE = { minX: -20000, maxX: 20000, minY: -20000, maxY: 20000 }

function rigAt(zoom: ZoomStop) {
  const clock = { now: 1000 }
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
  const { app, ticks, dt } = fakeApp()
  const world = new Container()
  const rig = createCameraRig(app, world, { reachable: () => WIDE, town: () => WIDE })
  const frame = (ms = 16.7): void => {
    clock.now += ms
    for (const t of [...ticks]) t()
  }
  rig.setZoom(zoom)
  frame(ZOOM_SETTLE_MS)
  return { rig, world, frame, dt }
}

const whole = (world: Container): boolean =>
  Number.isInteger(world.position.x) && Number.isInteger(world.position.y)

describe('★ D10 — the camera lands on a whole pixel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a pan by a fraction is drawn on a whole pixel, at every stop', () => {
    for (const z of ZOOM_STOPS) {
      const { rig, world } = rigAt(z)
      rig.panBy(0.3, 0.7)
      rig.panBy(-10.49, 3.51)
      expect(whole(world), `zoom ${z}`).toBe(true)
    }
  })

  it('★ a follow eases on its own curve and every frame of it is drawn on whole pixels', () => {
    for (const z of ZOOM_STOPS) {
      const { rig, world, frame } = rigAt(z)
      const target = { x: 123.37, y: 77.91 }
      rig.setFollow(() => target)
      const seen: number[] = []
      for (let i = 0; i < 400; i++) {
        frame()
        expect(whole(world), `zoom ${z}, frame ${i}`).toBe(true)
        seen.push(world.position.x)
      }
      // the easing survived the rounding: the camera moved through many frames, not one jump
      expect(new Set(seen).size).toBeGreaterThan(5)
      // and the rest is exactly the target, rounded — not a lerp stalled a few pixels short
      expect(world.position.x).toBe(Math.round(1440 / 2 - target.x * z))
      expect(world.position.y).toBe(Math.round(900 / 2 - target.y * z))
    }
  })

  it('a zoom transit settles on the stop AND on a whole pixel', () => {
    const { rig, world, frame } = rigAt(1)
    rig.panBy(-333.3, -222.2)
    for (const stop of ZOOM_STOPS) {
      rig.setZoomAt(stop, 617, 401)
      for (let i = 0; i < 20; i++) frame(20)
      expect(world.scale.x).toBe(stop)
      expect(whole(world), `stop ${stop}`).toBe(true)
    }
  })

  it('a follow held across a zoom transit keeps its whole-pixel landing', () => {
    const { rig, world, frame } = rigAt(1)
    rig.setFollow(() => ({ x: 640.25, y: 318.75 }))
    rig.setZoom(3)
    for (let i = 0; i < 30; i++) {
      frame(ZOOM_SETTLE_MS / 10)
      expect(whole(world), `frame ${i}`).toBe(true)
    }
    expect(world.scale.x).toBe(3)
  })

  it('D28: a zoom frame announces the camera exactly once', () => {
    const { rig, frame } = rigAt(1)
    let calls = 0
    rig.onCamera(() => calls++)
    rig.setZoom(2)
    calls = 0
    frame(ZOOM_SETTLE_MS / 2)
    expect(calls).toBe(1)
  })
})

// ★ The eased transit re-pins the world point captured at `setZoom` time on every frame it
// runs, so whatever the caller wants kept has to be at screen centre BEFORE it asks for a stop.
describe('★ a zoom transit keeps whatever was at screen centre when it was asked for', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const centreOf = (world: Container): { sx: number; sy: number } => ({
    sx: (1440 / 2 - world.position.x) / world.scale.x,
    sy: (900 / 2 - world.position.y) / world.scale.y,
  })

  it('★ centring and THEN zooming lands on the point that was centred', () => {
    const { rig, world, frame } = rigAt(3)
    const want = { sx: 300, sy: -180 }
    rig.centerOnScreen(want.sx, want.sy)
    rig.setZoom(0.5)
    for (let i = 0; i < 20; i++) frame()

    expect(world.scale.x).toBe(0.5)
    expect(centreOf(world).sx).toBeCloseTo(want.sx, 0)
    expect(centreOf(world).sy).toBeCloseTo(want.sy, 0)
  })

  it('★ zooming first throws the centring away — the transit re-pins where it started', () => {
    const { rig, world, frame } = rigAt(3)
    const door = { sx: 900, sy: 420 }
    rig.centerOnScreen(door.sx, door.sy)
    rig.setZoom(0.5)
    rig.centerOnScreen(300, -180)
    for (let i = 0; i < 20; i++) frame()

    expect(centreOf(world).sx).toBeCloseTo(door.sx, 0)
  })
})
