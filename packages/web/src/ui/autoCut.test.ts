import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  IDLE_HANDBACK_MS,
  cameraHand,
  cutFloor,
  director,
  onCamera,
  quietRound,
} from './autoCut.js'
import {
  DIRECTOR_ZOOM,
  DIRECTOR_ZOOM_WIDE,
  type ShotCamera,
  WIDE_VIEWPORT_PX,
  directorZoom,
  driveShot,
} from './DirectorMode.js'
import { CUT_MIN_MS } from './directorCut.js'
import { ZOOM_STOPS } from '../render/camera.js'
import { sceneShot } from '../render/sceneFraming.js'

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')

/** The canvas, and a button of the town's chrome, as the director asks about them. */
const CANVAS = { closest: (sel: string): unknown => (sel === '.stage-mount' ? {} : null) }
const CHROME = { closest: (): unknown => null }

/** `dispatchEvent` names the object it is dispatched ON as the target, and the director asks
 *  what the hand LANDED on, so the test says which that was. */
function hand(
  target: EventTarget,
  type: string,
  on: typeof CANVAS | typeof CHROME = CANVAS,
  key = 'ArrowLeft',
): void {
  const e = new Event(type)
  Object.defineProperty(e, 'target', { value: on })
  Object.defineProperty(e, 'key', { value: key })
  target.dispatchEvent(e)
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ★ The owner's 2026-08-28 pick — auto-director by default — reached the broadcast frame and
// never the desk, so a viewer at a laptop watched one static overview of a town.
describe('★ the camera goes to the story by itself, for every viewer', () => {
  const APP = src('../App.tsx')

  it('★ is armed by nothing at all: the desk gets the same director the stream does', () => {
    expect(APP).toContain('useAutoCut()')
    expect(APP).not.toContain('useAutoCut(route.broadcast)')
  })

  it('keeps ONE hand on it: the D key', () => {
    expect(APP).toContain('onDirector: toggleDirector')
  })
})

// ★ A hand on the camera used to be every event that was not the paper or the signpost, so
// muting the town, opening the key map or picking a person took the camera off auto.
describe('★ a hand on the camera is a hand on the CAMERA', () => {
  it('★ takes a pointer on the canvas and refuses one on the sound button', () => {
    expect(onCamera({ type: 'pointerdown', target: CANVAS } as unknown as Event)).toBe(true)
    expect(onCamera({ type: 'pointerdown', target: CHROME } as unknown as Event)).toBe(false)
  })

  it('takes a wheel over the canvas and refuses one over the chrome', () => {
    expect(onCamera({ type: 'wheel', target: CANVAS } as unknown as Event)).toBe(true)
    expect(onCamera({ type: 'wheel', target: CHROME } as unknown as Event)).toBe(false)
  })

  it('★ takes the camera keys and refuses every other letter typed over the town', () => {
    for (const key of ['ArrowLeft', 'ArrowDown', '+', '-', 'Home'])
      expect(onCamera({ type: 'keydown', target: CANVAS, key } as unknown as Event), key).toBe(true)
    for (const key of ['s', 'd', 't', 'Escape'])
      expect(onCamera({ type: 'keydown', target: CANVAS, key } as unknown as Event), key).toBe(
        false,
      )
  })

  it('answers an event with no element behind it at all', () => {
    expect(onCamera(new Event('pointerdown'))).toBe(false)
  })
})

describe('★ the director hands back twenty seconds after the last input', () => {
  const armed = (): { target: EventTarget; d: ReturnType<typeof director>; off: () => void } => {
    const target = new EventTarget()
    const d = director(target)
    return { target, d, off: d.subscribe(() => {}) }
  }

  it('★ cuts before anybody has touched anything', () => {
    const { d, off } = armed()
    expect(d.get()).toBe(true)
    expect(d.handbackAt()).toBeNull()
    off()
  })

  it('★ a pan, a zoom or a click suspends it', () => {
    vi.useFakeTimers()
    for (const kind of ['pointerdown', 'keydown', 'wheel']) {
      const { target, d, off } = armed()
      hand(target, kind)
      expect(d.get(), kind).toBe(false)
      off()
    }
  })

  it('★ a click on the town’s own chrome is not one: muting the town keeps the camera', () => {
    vi.useFakeTimers()
    const { target, d, off } = armed()
    hand(target, 'pointerdown', CHROME)
    expect(d.get()).toBe(true)
    expect(d.handbackAt()).toBeNull()
    off()
  })

  it('★ takes the camera back exactly IDLE_HANDBACK_MS after the LAST input', () => {
    vi.useFakeTimers()
    const { target, d, off } = armed()
    expect(IDLE_HANDBACK_MS).toBe(20_000)
    hand(target, 'wheel')
    vi.advanceTimersByTime(IDLE_HANDBACK_MS - 1)
    expect(d.get()).toBe(false)
    hand(target, 'wheel') // the clock restarts on the second hand
    vi.advanceTimersByTime(IDLE_HANDBACK_MS - 1)
    expect(d.get()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(d.get()).toBe(true)
    off()
  })

  it('★ says WHEN it hands back, on the same clock it hands back on', () => {
    vi.useFakeTimers()
    const { target, d, off } = armed()
    hand(target, 'pointerdown')
    expect(d.handbackAt()).toBe(Date.now() + IDLE_HANDBACK_MS)
    vi.advanceTimersByTime(IDLE_HANDBACK_MS)
    expect(d.get()).toBe(true)
    expect(d.handbackAt()).toBeNull()
    off()
  })

  it('publishes each change once, so a keystroke is not a re-render', () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    const d = director(target)
    const seen = vi.fn()
    const off = d.subscribe(seen)
    hand(target, 'keydown')
    hand(target, 'keydown')
    hand(target, 'keydown')
    expect(seen).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(IDLE_HANDBACK_MS)
    expect(seen).toHaveBeenCalledTimes(2)
    off()
  })

  it('★ what the D key switched off stays off, however long the viewer sits still', () => {
    vi.useFakeTimers()
    const { target, d, off } = armed()
    d.toggle()
    expect(d.get()).toBe(false)
    hand(target, 'pointerdown')
    vi.advanceTimersByTime(IDLE_HANDBACK_MS * 3)
    expect(d.get()).toBe(false)
    d.toggle()
    expect(d.get()).toBe(true)
    off()
  })

  // ★ D is pressed by somebody looking at a stopped picture, and it used to answer an armed flag
  // nobody can see: the key meant to give the camera back switched the director off instead.
  it('★ gives the camera back the moment it is pressed on a held one', () => {
    vi.useFakeTimers()
    const { target, d, off } = armed()
    hand(target, 'wheel')
    expect(d.get()).toBe(false)
    d.toggle()
    expect(d.get()).toBe(true)
    expect(d.handbackAt()).toBeNull()
    off()
  })

  it('lets the window go: the last unsubscribe takes every listener and the timer with it', () => {
    vi.useFakeTimers()
    const { target, d, off } = armed()
    hand(target, 'wheel')
    off()
    hand(target, 'wheel')
    vi.advanceTimersByTime(IDLE_HANDBACK_MS * 2)
    expect(vi.getTimerCount()).toBe(0)
    expect(d.get()).toBe(false) // nobody is watching; nothing was published
  })
})

// The chip says one of three things, and the third is a number the world can actually stand
// behind: a countdown to a build-time constant would be the screen promising its own arithmetic.
describe('the camera chip has three states, not two', () => {
  it('names the auto director when it is cutting', () => {
    expect(cameraHand(true, null, 0)).toBe('Camera on auto')
  })

  it('counts the real seconds left off the deadline it was handed', () => {
    expect(cameraHand(false, 20_000, 0)).toBe('Camera back in 20s')
    expect(cameraHand(false, 20_000, 12_500)).toBe('Camera back in 8s')
    expect(cameraHand(false, 20_000, 19_999)).toBe('Camera back in 1s')
  })

  // The screen may not promise a second the deadline has already spent: it printed
  // `Camera back in 0s` and went on printing it for as long as the hand stayed on the camera.
  it('★ stops naming a second the moment the deadline it named has passed', () => {
    for (const at of [20_000, 20_001, 60_000])
      expect(cameraHand(false, 20_000, at), `${at}`).toBe('Camera held by you')
  })

  it('★ names no second when nothing is going to hand the camera back', () => {
    expect(cameraHand(false, null, 0)).toBe('Camera held by you')
  })
})

// ★ At 3× a 1440-wide screen frames one body 156px tall, and a two-person exchange — the one
// thing the director exists to find — cannot fit in the shot it cuts to.
describe('★ two speakers fit in the frame on a wide screen', () => {
  it('★ opens to 2× at 1280 and wider', () => {
    expect(WIDE_VIEWPORT_PX).toBe(1280)
    expect(directorZoom(WIDE_VIEWPORT_PX)).toBe(DIRECTOR_ZOOM_WIDE)
    expect(directorZoom(1440)).toBe(2)
    expect(directorZoom(2560)).toBe(2)
  })

  it('keeps the closer stop where a wider one would give the face away', () => {
    expect(directorZoom(WIDE_VIEWPORT_PX - 1)).toBe(DIRECTOR_ZOOM)
    expect(directorZoom(390)).toBe(3)
  })
})

// ★ The bypass that hurt was per-ARMING: it spent itself again on every D press, so the camera
// was yanked whenever the director came back. A floor seeded once per visit spends one, at load.
describe('★ no cut is dropped, and the first cut of a visit is free', () => {
  it('★ takes the first cut at once, however early in the visit it lands', () => {
    vi.useFakeTimers()
    const taken: (string | null)[] = []
    cutFloor<string>(
      (c) => taken.push(c),
      (k) => k,
    ).offer('ada', 120)
    expect(taken).toEqual(['ada'])
  })

  it('★ takes the cut the floor refused when the floor is up, rather than losing it', () => {
    vi.useFakeTimers()
    const taken: (string | null)[] = []
    const floor = cutFloor<string>(
      (c) => taken.push(c),
      (k) => k,
    )
    floor.offer('ada bo', 0)
    floor.offer('cyd', 1000)
    expect(taken).toEqual(['ada bo'])
    vi.advanceTimersByTime(CUT_MIN_MS - 1001)
    expect(taken).toEqual(['ada bo'])
    vi.advanceTimersByTime(1)
    expect(taken).toEqual(['ada bo', 'cyd'])
  })

  it('waits with ONE cut, so the town never replays a queue of stale ones', () => {
    vi.useFakeTimers()
    const taken: (string | null)[] = []
    const floor = cutFloor<string>(
      (c) => taken.push(c),
      (k) => k,
    )
    floor.offer('ada', 0)
    floor.offer('bo', 1000)
    floor.offer('cyd', 2000)
    vi.advanceTimersByTime(CUT_MIN_MS)
    expect(taken).toEqual(['ada', 'cyd'])
  })

  // ★ A cut parks on the floor for up to eight seconds, and the gateway can change its mind
  // twice in that time: the camera cut to a beat the frame had already left.
  it('★ drops the waiting cut when the frame goes back to the shot that is up', () => {
    vi.useFakeTimers()
    const taken: (string | null)[] = []
    const floor = cutFloor<string>(
      (c) => taken.push(c),
      (k) => k,
    )
    floor.offer('ada', 0)
    floor.offer('bo', 1000)
    floor.offer('ada', 2000)
    expect(taken, 'the shot that is up lands at once, floor or no floor').toEqual(['ada', 'ada'])
    expect(vi.getTimerCount(), 'a dropped cut is still armed to land').toBe(0)
    vi.advanceTimersByTime(CUT_MIN_MS * 2)
    expect(taken).toEqual(['ada', 'ada'])
  })

  it('★ drops the waiting cut when the frame stops naming anybody at all', () => {
    vi.useFakeTimers()
    const taken: (string | null)[] = []
    const floor = cutFloor<string>(
      (c) => taken.push(c),
      (k) => k,
    )
    floor.offer('ada', 0)
    floor.offer('bo', 1000)
    floor.offer(null, 2000)
    expect(taken).toEqual(['ada', null])
    expect(vi.getTimerCount(), 'a dropped cut is still armed to land').toBe(0)
    vi.advanceTimersByTime(CUT_MIN_MS * 2)
    expect(taken).toEqual(['ada', null])
  })

  it('drops the waiting cut when the director stands down', () => {
    vi.useFakeTimers()
    const taken: (string | null)[] = []
    const floor = cutFloor<string>(
      (c) => taken.push(c),
      (k) => k,
    )
    floor.offer('ada', 0)
    floor.offer('bo', 1000)
    floor.clear()
    vi.advanceTimersByTime(CUT_MIN_MS * 2)
    expect(taken).toEqual(['ada'])
  })
})

// ★ The round is ranked over whoever is outdoors, and the rank was read fresh every frame: one
// person opening a door renumbered it and threw the camera at a stranger mid-turn.
describe('★ the quiet round holds its subject for the whole turn', () => {
  const STREET = ['ada', 'bo', 'cyd', 'dee']

  it('★ does not turn over because somebody else opened a door', () => {
    const round = quietRound()
    const first = round(STREET, 180)
    expect(first).toBe('dee')
    expect(round(['ada', 'bo', 'dee'], 190)).toBe(first)
    expect(round(['ada', 'bea', 'bo', 'cyd', 'dee'], 200)).toBe(first)
  })

  it('turns over when the turn does', () => {
    const round = quietRound()
    expect(round(STREET, 180)).toBe('dee')
    expect(round(STREET, 240)).toBe('ada')
  })

  it('turns the moment its own subject walks indoors', () => {
    const round = quietRound()
    expect(round(['ada', 'bo'], 0)).toBe('ada')
    expect(round(['bo'], 10)).toBe('bo')
  })

  it('has nobody to turn to on an empty street', () => {
    expect(quietRound()([], 0)).toBeNull()
  })
})

// ★ A cut names the people the gateway scored, and the character layer draws them a frame or two
// later: the shot resolved once, got nothing, and left the camera where the last one ended.
describe('★ a cut waits for a body the map has not drawn yet', () => {
  const STAGE = { w: 1280, h: 720 }
  const CUT = {
    by: 'cut' as const,
    castKey: 'ada',
    followed: null,
    structureId: null,
    awake: true,
  }
  const NO_WORLD = { getState: (): null => null }

  /** A camera that remembers where it is, with the rig's follow tick as one function. */
  function lens(points: Map<string, { sx: number; sy: number }>) {
    const cam = { x: 0, y: 0, scale: 1 }
    let follow: (() => { x: number; y: number } | null) | null = null
    const rig: ShotCamera = {
      app: { screen: { width: STAGE.w, height: STAGE.h } },
      setZoom(stop) {
        cam.scale = stop
      },
      setFollow(target) {
        follow = target
      },
      centerHome() {},
      pointOf: (_kind, id) => points.get(id) ?? null,
    }
    const tick = (): void => {
      const p = follow?.() ?? null
      if (p === null) return
      cam.x = p.x
      cam.y = p.y
    }
    return { rig, cam, tick, following: (): boolean => follow !== null }
  }

  it('★ holds where it is, then aims at the body the moment it appears', () => {
    const points = new Map<string, { sx: number; sy: number }>()
    const { rig, cam, tick } = lens(points)
    driveShot(rig, NO_WORLD, CUT, { current: true })
    tick()
    expect(cam).toEqual({ x: 0, y: 0, scale: 1 })
    points.set('ada', { sx: 900, sy: 500 })
    tick()
    const shot = sceneShot([{ sx: 900, sy: 500 }], STAGE)
    expect(shot).not.toBeNull()
    expect(cam).toEqual({ x: shot?.sx, y: shot?.sy, scale: shot?.stop })
  })

  it('gives up after one shot’s own minimum, so a late body cannot yank the camera', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0)
    const points = new Map<string, { sx: number; sy: number }>()
    const { rig, cam, tick } = lens(points)
    driveShot(rig, NO_WORLD, CUT, { current: true })
    now.mockReturnValue(CUT_MIN_MS + 1)
    points.set('ada', { sx: 900, sy: 500 })
    tick()
    expect(cam).toEqual({ x: 0, y: 0, scale: 1 })
  })

  // Giving up used to mean answering null on every frame for the rest of the cut, with the
  // camera stranded wherever the last shot ended and nothing able to take it.
  it('★ stands the shot DOWN when its wait runs out, rather than holding the camera', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0)
    const { rig, tick, following } = lens(new Map())
    driveShot(rig, NO_WORLD, CUT, { current: true })
    expect(following()).toBe(true)
    tick()
    expect(following(), 'inside the wait the shot keeps looking').toBe(true)
    now.mockReturnValue(CUT_MIN_MS + 1)
    tick()
    expect(following()).toBe(false)
  })
})

// The curve belongs to the camera, which eases every stop it is given. All the director may
// say is WHICH stop, and it may say it once: a director writing a scale every frame would be
// two hands on the same zoom.
describe('the director asks the camera for a stop, never for a curve', () => {
  /** A camera that remembers every stop it was asked for, and the frame a shot runs on. */
  function stops(points: Record<string, { sx: number; sy: number }>) {
    const asked: number[] = []
    let follow: (() => { x: number; y: number } | null) | null = null
    const rig: ShotCamera = {
      app: { screen: { width: 1280, height: 720 } },
      setZoom(stop) {
        asked.push(stop)
      },
      setFollow(target) {
        follow = target
      },
      centerHome() {},
      pointOf: (_kind, id) => points[id] ?? null,
    }
    return {
      rig,
      asked,
      tick: (): void => {
        follow?.()
      },
    }
  }

  it('★ names ONE of the camera’s own stops for a cut, and never touches the scale again', () => {
    const { rig, asked, tick } = stops({ ada: { sx: 900, sy: 500 }, bo: { sx: 964, sy: 532 } })
    driveShot(
      rig,
      { getState: () => null },
      { by: 'cut', castKey: 'ada bo', followed: null, structureId: null, awake: true },
      { current: true },
    )
    for (let i = 0; i < 30; i++) tick()
    expect(asked, 'the director drove the zoom on the ticker').toEqual([3])
    expect(ZOOM_STOPS).toContain(asked[0])
  })
})

it('explicit Pause cancels a pending handback and stays paused after camera input', () => {
  vi.useFakeTimers()
  const target = new EventTarget()
  const d = director(target)
  const off = d.subscribe(() => {})
  hand(target, 'wheel')
  d.pause()
  expect(d.handbackAt()).toBeNull()
  hand(target, 'pointerdown')
  vi.advanceTimersByTime(IDLE_HANDBACK_MS * 2)
  expect(d.get()).toBe(false)
  d.toggle()
  expect(d.get()).toBe(true)
  off()
})
