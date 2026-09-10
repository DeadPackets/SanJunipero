import { Container } from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CameraBounds, ZOOM_SETTLE_MS, ZOOM_STOPS, type ZoomStop } from './camera.js'
import { createCameraRig } from './cameraRig.js'
import { driveKey } from './StageMount.js'

type Tick = () => void

function fakeApp(): {
  app: Parameters<typeof createCameraRig>[0]
  ticks: Tick[]
  dt: { ms: number }
  wheels: ((e: WheelEvent) => void)[]
} {
  const ticks: Tick[] = []
  const wheels: ((e: WheelEvent) => void)[] = []
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
    stage: new Container(),
    renderer: { events: { cursorStyles: { default: '' } } },
    canvas: {
      style: {},
      addEventListener: (_type: string, fn: (e: WheelEvent) => void) => {
        wheels.push(fn)
      },
      removeEventListener: (_type: string, fn: (e: WheelEvent) => void) => {
        const i = wheels.indexOf(fn)
        if (i >= 0) wheels.splice(i, 1)
      },
    },
  }
  return { app: app as unknown as Parameters<typeof createCameraRig>[0], ticks, dt, wheels }
}

const WIDE = { minX: -20000, maxX: 20000, minY: -20000, maxY: 20000 }

function rigAt(zoom: ZoomStop, bounds: CameraBounds = WIDE) {
  const clock = { now: 1000 }
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
  const { app, ticks, dt, wheels } = fakeApp()
  const world = new Container()
  // stacked as the scene stacks them: the world, and the lit screen layers over it
  const lights = new Container()
  app.stage.addChild(world, lights)
  const rig = createCameraRig(app, world, { reachable: () => bounds, town: () => bounds })
  const frame = (ms = 16.7): void => {
    clock.now += ms
    for (const t of [...ticks]) t()
  }
  // `ctrlKey` is the trackpad pinch, which is how a laptop takes the camera.
  const wheel = (deltaY: number, sx = 720, sy = 450): void => {
    const e = {
      deltaY,
      offsetX: sx,
      offsetY: sy,
      ctrlKey: true,
      preventDefault: () => undefined,
    } as unknown as WheelEvent
    for (const fn of [...wheels]) fn(e)
  }
  rig.setZoom(zoom)
  frame(ZOOM_SETTLE_MS)
  return { rig, world, lights, frame, dt, ticks, wheel }
}

/** What the renderer will actually draw this node at: the alpha may be written on any ancestor. */
const lit = (c: Container): number => c.getGlobalAlpha()

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

// Every assertion below drives the real rig over a fake clock and reads the container: where
// the camera ended up, what it did on the way, and whether it moved at all.
describe('★ a follow holds its subject, and chooses its move by how far it is', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const onScreen = (world: Container, t: { x: number; y: number }): { sx: number; sy: number } => ({
    sx: world.position.x + t.x * world.scale.x,
    sy: world.position.y + t.y * world.scale.y,
  })

  it('★ a zoom taken during a follow leaves the subject where it is on screen', () => {
    const { rig, world, frame } = rigAt(1)
    const target = { x: 900, y: 600 }
    rig.setFollow(() => target)
    for (let i = 0; i < 60; i++) frame()
    const before = onScreen(world, target)
    rig.setZoom(3)
    for (let i = 0; i < 20; i++) {
      frame()
      const now = onScreen(world, target)
      expect(Math.abs(now.sx - before.sx), `x on frame ${i}`).toBeLessThanOrEqual(1)
      expect(Math.abs(now.sy - before.sy), `y on frame ${i}`).toBeLessThanOrEqual(1)
    }
    expect(world.scale.x).toBe(3)
  })

  it('★ half a viewport is an eased reframe: it is part way at 300 ms and exact by 620', () => {
    const { rig, world, frame } = rigAt(1)
    rig.setFollow(() => ({ x: 0, y: 450 }))
    frame()
    frame(300)
    expect(lit(world), 'a reframe never blacks the picture out').toBe(1)
    expect(world.position.x).toBeGreaterThan(0)
    expect(world.position.x).toBeLessThan(720)
    frame(400)
    expect(world.position.x).toBe(720)
  })

  it('★ three viewports is a cut: it holds, goes black, and is simply there', () => {
    const { rig, world, frame } = rigAt(1)
    rig.setFollow(() => ({ x: -3600, y: 450 }))
    const middle = (): number => (1440 / 2 - world.position.x) / world.scale.x
    frame()
    const held = middle()
    frame(45)
    expect(lit(world), 'the picture falls away').toBeLessThan(1)
    expect(middle(), 'and it does not travel while it does').toBeCloseTo(held, 0)
    frame(60)
    expect(lit(world), 'then there is nothing to see').toBe(0)
    expect(middle()).toBeCloseTo(held, 0)
    frame(40)
    expect(middle(), 'and it is simply somewhere else').not.toBeCloseTo(held, 0)
    for (let i = 0; i < 30; i++) frame()
    expect(lit(world)).toBe(1)
    expect(world.position.x).toBe(4320)
  })
})

describe('★ a cut is the whole picture, and a hand on the camera ends it', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const farAway = { x: -3600, y: 450 }

  it('★ a pan taken mid-cut puts the picture back at once and leaves it there', () => {
    const { rig, world, frame } = rigAt(1)
    rig.setFollow(() => farAway)
    frame()
    frame(45)
    expect(lit(world), 'the cut is under way').toBeLessThan(1)
    const middle = (): number => (1440 / 2 - world.position.x) / world.scale.x
    const held = middle()
    rig.panBy(0, 0)
    expect(lit(world), 'the viewer has the camera, so the fade is over').toBe(1)
    frame()
    expect(world.scale.x, 'and the punch goes with it').toBe(1)
    for (let i = 0; i < 30; i++) frame()
    expect(lit(world), 'it does not black out again behind them').toBe(1)
    expect(middle(), 'nor does the move finish itself under the hand').toBeCloseTo(held, 0)
  })

  it('★ a trackpad pinch mid-cut puts the picture back on the frame it arrives on', () => {
    const { rig, world, frame, wheel } = rigAt(1)
    rig.setFollow(() => farAway)
    frame()
    frame(45)
    expect(lit(world), 'the cut is under way').toBeLessThan(1)
    wheel(-40)
    expect(lit(world), 'the picture is back before another frame is drawn').toBe(1)
    for (let i = 0; i < 40; i++) frame()
    expect(lit(world), 'it does not black out again behind the hand').toBe(1)
    expect(Math.abs(world.position.x), 'and the cut never lands them in the middle').toBeLessThan(
      1000,
    )
  })

  it('★ a zoom key mid-cut puts the picture back, where the director own push may not', () => {
    const { rig, world, frame } = rigAt(1)
    rig.setFollow(() => farAway)
    frame()
    frame(45)
    expect(lit(world), 'the cut is under way').toBeLessThan(1)
    rig.setZoom(2)
    expect(lit(world), 'the director pushing mid-cut does not end its own cut').toBeLessThan(1)
    rig.takeZoom(2)
    expect(lit(world), 'a hand on the zoom does, on the frame it arrives on').toBe(1)
    for (let i = 0; i < 30; i++) frame()
    expect(lit(world), 'and it does not black out again behind them').toBe(1)
  })

  it('★ a subject that blinks out of the snapshot mid-cut is still cut TO', () => {
    const { rig, world, frame } = rigAt(1)
    let there = true
    rig.setFollow(() => (there ? farAway : null))
    frame()
    frame(45)
    expect(lit(world), 'the cut is under way').toBeLessThan(1)
    there = false // the body leaves the snapshot for the rest of the move
    for (let i = 0; i < 20; i++) frame(20)
    expect(lit(world), 'the picture comes back').toBe(1)
    expect(world.position.x, 'and it comes back somewhere else').toBe(4320)
  })

  it('★ standing the follow down mid-cut leaves no fade running', () => {
    const { rig, world, frame } = rigAt(1)
    rig.setFollow(() => farAway)
    frame()
    frame(45)
    rig.setFollow(null)
    expect(lit(world)).toBe(1)
    for (let i = 0; i < 30; i++) frame()
    expect(lit(world)).toBe(1)
  })

  it('★ everything over the world falls with it, so nothing floats lit over the black', () => {
    const { rig, world, lights, frame } = rigAt(1)
    rig.setFollow(() => farAway)
    frame()
    frame(45)
    expect(lit(world), 'the picture falls away').toBeLessThan(1)
    expect(lit(lights), 'and the lights over it fall with it').toBeLessThan(1)
    frame(60)
    expect(lit(lights), 'nothing is lit over the black frame').toBe(0)
  })

  it('★ the cut punches the picture and never the scale everything else reads', () => {
    const { rig, world, frame } = rigAt(2)
    rig.setFollow(() => farAway)
    frame()
    frame(45)
    expect(world.scale.x, 'the picture itself kicks').toBeLessThan(2)
    expect(rig.getZoom(), 'and the stop everything else reads holds still').toBe(2)
    frame(100)
    expect(world.scale.x, 'it comes back in over the rise').toBeGreaterThan(2)
    expect(rig.getZoom()).toBe(2)
    for (let i = 0; i < 30; i++) frame()
    expect(world.scale.x).toBe(2)
    expect(rig.getZoom()).toBe(2)
  })

  it('★ teardown mid-cut hands back every ticker slot and leaves nothing half faded', () => {
    const { rig, world, frame, ticks } = rigAt(1)
    rig.setFollow(() => farAway)
    frame()
    frame(45)
    expect(lit(world), 'the cut is under way').toBeLessThan(1)
    rig.destroy()
    expect(ticks.length, 'no tick of the rig is left running').toBe(0)
    expect(lit(world), 'and the picture is not left dark').toBe(1)
    const at = world.position.x
    frame()
    expect(world.position.x, 'a frame after teardown moves nothing').toBe(at)
  })

  it('★ a subject the clamp cannot reach is not cut to over and over', () => {
    const { rig, world, frame } = rigAt(1, { minX: 0, maxX: 400, minY: 0, maxY: 300 })
    rig.setFollow(() => farAway)
    let cuts = 0
    let was = 1
    for (let i = 0; i < 200; i++) {
      frame()
      const now = lit(world)
      if (was === 1 && now < 1) cuts++
      was = now
    }
    expect(cuts, 'the clamp refused the move, so there was nothing to cut to').toBe(0)
    expect(world.position.x, 'and the camera rests where the clamp put it').toBe(520)
  })
})

describe('★ the keyboard steps off the stop the camera is going to', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('★ a second press mid-transit takes the next rung, not the one already left', () => {
    const { rig, world, frame } = rigAt(1)
    driveKey(rig, '+')
    frame(10)
    expect(rig.getZoom(), 'the scale is still between two rungs').toBeGreaterThan(1)
    expect(rig.getZoom()).toBeLessThan(2)
    driveKey(rig, '+')
    expect(rig.getZoomStop(), 'the second press climbs').toBe(3)
    for (let i = 0; i < 20; i++) frame(20)
    expect(world.scale.x).toBe(3)
  })

  it('a press on a settled camera still steps one rung', () => {
    const { rig, frame } = rigAt(2)
    driveKey(rig, '-')
    expect(rig.getZoomStop()).toBe(1)
    for (let i = 0; i < 20; i++) frame(20)
    driveKey(rig, '+')
    expect(rig.getZoomStop()).toBe(2)
  })
})
