import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Container, type FederatedPointerEvent } from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type CameraBounds,
  WHEEL_GESTURE_GAP_MS,
  ZOOM_SETTLE_MS,
  ZOOM_STOPS,
  type ZoomStop,
} from './camera.js'
import { createCameraRig } from './cameraRig.js'
import { BACKGROUND, rendererOptions, sceneClock } from './scene.js'

const root = {} as HTMLElement

describe('rendererOptions (B1 — the canvas at the screen’s own resolution)', () => {
  it('gives the backing store one pixel per device pixel', () => {
    expect(rendererOptions(root, 2).resolution).toBe(2)
    expect(rendererOptions(root, 3).resolution).toBe(3)
  })

  it('lets Pixi keep the CSS box while the buffer grows under it', () => {
    expect(rendererOptions(root, 2).autoDensity).toBe(true)
  })

  it('falls back to 1 when the display reports no usable ratio', () => {
    expect(rendererOptions(root, 0).resolution).toBe(1)
    expect(rendererOptions(root, Number.NaN).resolution).toBe(1)
    expect(rendererOptions(root, -2).resolution).toBe(1)
  })

  it('keeps every pixel-art law the renderer already carried', () => {
    const o = rendererOptions(root, 2)
    expect(o.antialias).toBe(false)
    expect(o.roundPixels).toBe(true)
    expect(o.background).toBe(BACKGROUND)
    expect(o.resizeTo).toBe(root)
  })
})

// ── THE LOAD-TIME TypeError R1 FORBIDS ────────────────────────────────────────────────────
//
// Pixi's `Application.destroy()` nulls `app.ticker`, so anyone holding a scene across a Fast
// Refresh remount can call `.start()` on null.

const WEB_SRC = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

function tsFilesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...tsFilesUnder(p))
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe('the scene owns its clock', () => {
  it('starts and stops while the scene is alive', () => {
    const calls: string[] = []
    const app = { ticker: { start: () => calls.push('start'), stop: () => calls.push('stop') } }
    const clock = sceneClock(app)
    clock.set(false)
    clock.set(true)
    expect(calls).toEqual(['stop', 'start'])
  })

  it('goes quiet once the scene is closed, so a late effect cannot reach a destroyed app', () => {
    const calls: string[] = []
    const app: { ticker: { start(): void; stop(): void } | null } = {
      ticker: { start: () => calls.push('start'), stop: () => calls.push('stop') },
    }
    const clock = sceneClock(app)
    clock.close()
    app.ticker = null // exactly what Application.destroy() does
    expect(() => {
      clock.set(true)
    }).not.toThrow()
    expect(() => {
      clock.set(false)
    }).not.toThrow()
    expect(calls).toEqual([])
  })
})

describe('nobody outside the renderer reaches through app.ticker', () => {
  it('finds no `.app.ticker` in the chrome — the clock is asked for by name', () => {
    const offenders = tsFilesUnder(WEB_SRC)
      .filter((f) => !f.startsWith(join(WEB_SRC, 'render')))
      .filter((f) => /\.app\.ticker\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(WEB_SRC.length + 1))
    expect(offenders).toEqual([])
  })

  it('is what the renderer itself calls, and the only way anyone asks', () => {
    expect(readFileSync(join(WEB_SRC, 'render/scene.ts'), 'utf8')).toContain('setTicking(on')
  })
})

// ── the cull's one wire ───────────────────────────────────────────────────────────────────
//
// The type says `applyDepthOrder` takes a view; it cannot say the view is THIS FRAME'S. A rect
// captured once at boot typechecks and culls against a camera that has moved, so it is scanned.

describe('the frame culls against the camera it is actually looking through', () => {
  const src = readFileSync(join(WEB_SRC, 'render', 'scene.ts'), 'utf8')

  it('calls the depth order with a freshly read viewRect, not a stored one', () => {
    const body = /sortDepth: \(\) => \{[\s\S]*?\n {4}\},/.exec(src)?.[0] ?? ''
    expect(body).toContain('const view = viewRect()')
    expect(body).toContain('applyDepthOrder(depthEntries, view)')
  })

  it('derives viewRect from the live camera every call', () => {
    const body = /const viewRect = [\s\S]*?\n {2}\}/.exec(src)?.[0] ?? ''
    expect(body).toContain('world.position.x')
    expect(body).toContain('app.screen.width')
  })

  it('has exactly one caller — the per-frame sort, and nowhere else', () => {
    expect(src.match(/applyDepthOrder\(/g)).toHaveLength(1)
  })
})

// ── the throw, and the four things that outrank it ────────────────────────────────────────
//
// fling.ts is pure and fully tested; what it cannot test is that the scene ASKED.

/** One function's body, ending where its indentation says it ends — a fixed-length window
 *  spilled into the neighbouring mover, which begins with the same `stopGlide()`. */
export function functionBody(src: string, name: string): string {
  const i = src.indexOf(name)
  if (i < 0) return ''
  const ends = ['\n    },', '\n  }'].map((e) => src.indexOf(e, i)).filter((n) => n > 0)
  return src.slice(i, ends.length === 0 ? src.length : Math.min(...ends))
}

// Nothing below reads the text of cameraRig.ts. A throw is thrown with a pointer, a zoom is
// turned with a wheel, and what is read back is the container the renderer draws.

type Tick = () => void

const WIDE: CameraBounds = { minX: -20000, maxX: 20000, minY: -20000, maxY: 20000 }

const pointerAt = (id: number, x: number, y: number, target: unknown): FederatedPointerEvent =>
  ({ pointerId: id, global: { x, y }, target }) as unknown as FederatedPointerEvent

const wheelOf = (deltaY: number, x: number, y: number, ctrlKey: boolean): WheelEvent =>
  ({
    preventDefault: () => undefined,
    deltaY,
    offsetX: x,
    offsetY: y,
    ctrlKey,
  }) as unknown as WheelEvent

/** The real rig on a fake clock, with the canvas wheel listener and the stage in hand: every
 *  gesture goes in the way a hand's does, and nothing reaches the camera another way. */
function rigOn(stop: ZoomStop) {
  const clock = { now: 1000 }
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
  const ticks: Tick[] = []
  const wheels: ((e: WheelEvent) => void)[] = []
  const app = {
    screen: { width: 1440, height: 900 },
    ticker: {
      add: (fn: Tick) => ticks.push(fn),
      remove: (fn: Tick) => ticks.splice(ticks.indexOf(fn), 1),
      deltaMS: 16.7,
    },
    stage: new Container(),
    renderer: { events: { cursorStyles: { default: '' } } },
    canvas: {
      style: {},
      addEventListener: (_t: string, fn: (e: WheelEvent) => void) => wheels.push(fn),
      removeEventListener: (_t: string, fn: (e: WheelEvent) => void) =>
        wheels.splice(wheels.indexOf(fn), 1),
    },
  }
  const world = new Container()
  app.stage.addChild(world)
  const rig = createCameraRig(app as unknown as Parameters<typeof createCameraRig>[0], world, {
    reachable: () => WIDE,
    town: () => WIDE,
  })
  const frame = (ms = 16.7): void => {
    clock.now += ms
    for (const t of [...ticks]) t()
  }
  rig.setZoom(stop)
  frame(ZOOM_SETTLE_MS)
  const stage = app.stage
  const turn = (deltaY: number, x: number, y: number, ctrlKey: boolean): void => {
    for (const w of wheels) w(wheelOf(deltaY, x, y, ctrlKey))
  }
  return {
    rig,
    world,
    stage,
    frame,
    clock,
    ticks,
    hitArea: (): unknown => app.stage.hitArea,
    screen: (): unknown => app.screen,
    wheel: (deltaY: number, ctrlKey = false): void => {
      turn(deltaY, 700, 400, ctrlKey)
    },
    /** The same gesture with the cursor travelling, which is where a stale anchor shows. */
    wheelAt: (deltaY: number, x: number, y: number): void => {
      turn(deltaY, x, y, false)
    },
    /** A hand that drags the camera and lets go while it is still moving. */
    throwCamera: (): void => {
      stage.emit('pointerdown', pointerAt(1, 700, 400, stage))
      for (let i = 1; i <= 4; i++) {
        clock.now += 10
        stage.emit('pointermove', pointerAt(1, 700 + i * 20, 400, stage))
      }
      stage.emit('pointerup', pointerAt(1, 780, 400, stage))
    },
    /** The world point under a screen point: what a zoom about the cursor must keep still. */
    under: (sx: number, sy: number): { x: number; y: number } => ({
      x: (sx - world.position.x) / world.scale.x,
      y: (sy - world.position.y) / world.scale.y,
    }),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a glide is ended by anything that says where the camera should be', () => {
  const movers: readonly (readonly [string, (r: ReturnType<typeof rigOn>) => void])[] = [
    [
      'panBy',
      (r) => {
        r.rig.panBy(0, 0)
      },
    ],
    [
      'centerHome',
      (r) => {
        r.rig.centerHome()
      },
    ],
    [
      'travelTo',
      (r) => {
        r.rig.travelTo(0, 0)
      },
    ],
    [
      'setFollow',
      (r) => {
        r.rig.setFollow(() => null)
      },
    ],
    [
      'fitToTown',
      (r) => {
        r.rig.fitToTown()
      },
    ],
    [
      'the wheel',
      (r) => {
        r.wheel(0)
      },
    ],
    [
      'a pointer catching it',
      (r) => {
        r.stage.emit('pointerdown', pointerAt(2, 1, 1, r.stage))
      },
    ],
  ]

  for (const [name, mover] of movers) {
    it(`${name} stops a throw dead`, () => {
      // 0.25 is this box's own fit stop, so `fitToTown` names the stop the camera is already on
      // and no zoom transit moves the picture under the assertion.
      const r = rigOn(0.25)
      r.throwCamera()
      r.frame()
      const flying = r.world.position.x
      r.frame()
      expect(r.world.position.x, 'the throw never left the ground').not.toBe(flying)
      mover(r)
      const at = r.world.position.x
      for (let i = 0; i < 3; i++) r.frame()
      expect(r.world.position.x, `${name} let the throw run on under it`).toBe(at)
    })
  }

  it('asks about reduced motion before it starts one, so a viewer who said no is never thrown', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const r = rigOn(1)
    r.throwCamera()
    const at = r.world.position.x
    for (let i = 0; i < 3; i++) r.frame()
    expect(r.world.position.x, 'the camera was thrown at a viewer who asked for stillness').toBe(at)
  })

  it('gives the glide back its ticker slot on teardown, mid-throw', () => {
    const r = rigOn(1)
    r.throwCamera()
    r.frame()
    const flying = r.world.position.x
    r.frame()
    expect(r.world.position.x).not.toBe(flying)
    r.rig.destroy()
    expect(r.ticks.length, 'a tick of the rig is still running').toBe(0)
    const at = r.world.position.x
    r.frame()
    expect(r.world.position.x, 'a frame after teardown carried the throw on').toBe(at)
  })
})

describe('★ a tap and a throw read ONE tracker, so a click can never become a fling', () => {
  const picksOf = (r: ReturnType<typeof rigOn>): { x: number; y: number }[] => {
    const picks: { x: number; y: number }[] = []
    r.rig.onTilePointer((t) => picks.push(t))
    return picks
  }

  it('★ a pan that came back to where it began is still a pan, and picks no tile', () => {
    const r = rigOn(1)
    const picks = picksOf(r)
    r.stage.emit('pointerdown', pointerAt(1, 700, 400, r.stage))
    for (const x of [760, 820, 760, 700]) {
      r.clock.now += 10
      r.stage.emit('pointermove', pointerAt(1, x, 400, r.stage))
    }
    r.stage.emit('pointerup', pointerAt(1, 700, 400, r.stage))
    r.stage.emit('pointertap', pointerAt(1, 700, 400, r.stage))
    expect(r.rig.wasDrag(), 'the gesture forgot it had travelled').toBe(true)
    expect(picks, 'a pan that ended where it started picked a tile').toEqual([])
  })

  it('and a pointer that never moved picks the tile under it', () => {
    const r = rigOn(1)
    const picks = picksOf(r)
    r.stage.emit('pointerdown', pointerAt(1, 700, 400, r.stage))
    r.stage.emit('pointerup', pointerAt(1, 700, 400, r.stage))
    r.stage.emit('pointertap', pointerAt(1, 700, 400, r.stage))
    expect(picks).toHaveLength(1)
  })

  it('★ a tile pick means the pointer landed on the GROUND, not on a body or a building', () => {
    const r = rigOn(1)
    const picks = picksOf(r)
    r.stage.emit('pointerdown', pointerAt(1, 700, 400, r.stage))
    r.stage.emit('pointerup', pointerAt(1, 700, 400, r.stage))
    r.stage.emit('pointertap', pointerAt(1, 700, 400, new Container()))
    expect(picks, 'a click on a body picked the ground under it').toEqual([])
  })

  it('★ and the stage hit area survives, because the camera is standing on it', () => {
    const r = rigOn(1)
    expect(r.hitArea()).toBe(r.screen())
  })

  it('keeps no second, hand-rolled slop test anywhere in the rig', () => {
    expect(readFileSync(join(WEB_SRC, 'render', 'cameraRig.ts'), 'utf8')).not.toMatch(
      /Math\.abs\(dx\) \+ Math\.abs\(dy\) >/,
    )
  })
})

// ── ★ THE GESTURE MUST BE RELEASED, OR THE CAMERA NEVER RESTS ON AN EXACT STOP ────────────
//
// The end of a wheel gesture is the ABSENCE of an event, so the release lives on the frame;
// without it the camera holds whatever fractional scale the hand left it at.
describe('★ the wheel gesture is released on the frame, so the resting frame stays exact', () => {
  it('★ holds a fractional scale under the hand, and lands on an exact stop when it leaves', () => {
    const r = rigOn(1)
    r.wheel(-110)
    r.frame()
    const under = r.world.scale.x
    expect(under, 'the zoom did not follow the hand at all').not.toBe(1)
    expect(
      ZOOM_STOPS,
      'the gesture was snapped to a stop while the hand was still on it',
    ).not.toContain(under)
    for (let i = 0; i < 40; i++) r.frame()
    expect(r.world.scale.x, 'the camera rests on the scale the hand left it at').toBe(2)
    expect(r.rig.getZoomStop()).toBe(2)
  })

  it('reduced motion reaches the release, so the settle is instant for a viewer who asked', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const r = rigOn(1)
    r.wheel(-110)
    r.frame()
    r.frame(WHEEL_GESTURE_GAP_MS + 1)
    expect(r.world.scale.x).toBe(2)
  })

  // ★ The cursor drifts across a long scroll, and a rig that re-pinned on every event grew the
  // town about wherever the hand had reached, so the thing being zoomed toward slid away.
  it('★ the anchor is captured ONCE PER GESTURE, so the town grows where the gesture began', () => {
    const r = rigOn(1)
    const began = r.under(700, 400)
    for (let i = 0; i < 6; i++) {
      r.wheelAt(-30, 700 + i * 40, 400 + i * 20)
      r.frame(20)
    }
    for (let i = 0; i < 40; i++) r.frame()
    expect(r.world.scale.x, 'the gesture moved no scale at all').not.toBe(1)
    expect(r.under(700, 400).x, 'the town swam out from under the cursor').toBeCloseTo(began.x, 0)
    expect(r.under(700, 400).y).toBeCloseTo(began.y, 0)
  })

  it('the pinch flag reaches the rule, so a trackpad pinch is not a scroll', () => {
    const scroll = rigOn(1)
    scroll.wheel(-90)
    scroll.frame()
    const scrolled = scroll.world.scale.x
    const pinch = rigOn(1)
    pinch.wheel(-90, true)
    pinch.frame()
    expect(pinch.world.scale.x, 'a pinch spent the same delta as a scroll').not.toBe(scrolled)
  })

  it('the camera eases every stop it is given, rather than jumping to it', () => {
    const r = rigOn(1)
    r.rig.setZoom(3)
    r.frame(ZOOM_SETTLE_MS / 3)
    expect(r.world.scale.x).toBeGreaterThan(1)
    expect(r.world.scale.x).toBeLessThan(3)
    r.frame(ZOOM_SETTLE_MS)
    expect(r.world.scale.x).toBe(3)
  })
})

// A mover that wrote `world.position` itself would skip every guard, and would look right in
// the browser until somebody moved the camera while a throw was still in the air.

describe('travelling to a point takes the same road as going home', () => {
  const src = readFileSync(join(WEB_SRC, 'render', 'cameraRig.ts'), 'utf8')
  const body = (name: string): string => functionBody(src, name)

  it('★ the reader stops at the end of the function it was asked for', () => {
    const fake = [
      'const a = () => {',
      '  first()',
      '}',
      'const b = () => {',
      '  second()',
      '}',
      '',
    ].join('\n  ')
    expect(functionBody(`  ${fake}`, 'const a =')).toContain('first()')
    expect(functionBody(`  ${fake}`, 'const a ='), 'read into the next function').not.toContain(
      'second()',
    )
  })

  it('★ does the same four things, in the same order, as centerHome', () => {
    const travel = body('travelTo: (sx, sy) =>')
    const home = body('centerHome: () =>')
    const steps = ['stopGlide()', 'fitted = false', 'breakFollow()', 'centerOnScreen(']
    const at = (s: string): number[] => steps.map((step) => s.indexOf(step))
    for (const [i, step] of steps.entries()) {
      expect(at(travel)[i], `travelTo is missing ${step}`).toBeGreaterThan(-1)
    }
    // the ORDER, by index — a guard that runs after the thing it guards is not a guard
    expect(at(travel)).toEqual([...at(travel)].sort((a, b) => a - b))
    expect(at(home)).toEqual([...at(home)].sort((a, b) => a - b))
    expect(travel).toContain('notifyCamera()')
  })

  it('is the only new way in: nothing outside the renderer writes a camera position', () => {
    const offenders = tsFilesUnder(WEB_SRC)
      .filter((f) => !f.startsWith(join(WEB_SRC, 'render')))
      .filter((f) => /world\.position|centerOnScreen\(/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(WEB_SRC.length + 1))
    expect(offenders).toEqual([])
  })

  it('★ the one writer of the camera position is the one that announces it', () => {
    expect(src.match(/world\.position\.set\(/g), 'more than one camera writer').toHaveLength(1)
    const p = functionBody(src, 'function place(')
    expect(p).toContain('world.position.set(')
    expect(p, 'place() moves the camera without telling anybody').toContain('notifyCamera()')
  })

  it('every reader of the reachable box gets it from one accessor', () => {
    // the scene owns `bounds`, and hands the rig that very accessor
    const scene = readFileSync(join(WEB_SRC, 'render', 'scene.ts'), 'utf8')
    expect(scene).toContain('reachableBox: () => bounds')
    expect(scene).toContain('reachable: () => bounds')
    // and that box is the thing every write to the camera is clamped against
    expect(src).toMatch(
      /clampCamera\(\{ x, y \}, world\.scale\.x, deps\.reachable\(\), screenBox\(\)\)/,
    )
  })
})

describe('StageMount never leaves React holding a destroyed scene', () => {
  const src = readFileSync(join(WEB_SRC, 'render', 'StageMount.tsx'), 'utf8')

  it('un-publishes the scene in the same teardown that destroys it', () => {
    const cleanup = /return \(\) => \{([\s\S]*?)\n {4}\}/.exec(src)?.[1] ?? ''
    expect(cleanup).toContain('teardown()')
    expect(cleanup).toMatch(/onScene\?\.\(null\)/)
  })

  // ★ A remount destroys the Scene and then awaits `createScene` again. For the length of that
  // promise the div is mounted and focusable, and a keypress drove the destroyed one.
  it('★ drops the ref in the same teardown that destroys the scene', () => {
    const teardown = /const teardown = \(\): void => \{([\s\S]*?)\n {4}\}/.exec(src)?.[1] ?? ''
    expect(teardown).toContain('scene?.destroy()')
    expect(teardown, 'onKeyDown reads this ref and only guards on null').toContain(
      'sceneRef.current = null',
    )
    expect(teardown).toContain('interiorRef.current = null')
  })

  // ★ The layers built before the throw were never destroyed, and their tickers went with the app.
  it('★ the failed-build path tears down every layer the good path does', () => {
    const teardown = /const teardown = \(\): void => \{([\s\S]*?)\n {4}\}/.exec(src)?.[1] ?? ''
    for (const layer of ['landmarks', 'toponyms', 'chars', 'bubbles', 'acts', 'moments'])
      expect(teardown, layer).toContain(`${layer}?.destroy()`)
    const caught = src.slice(src.indexOf('.catch('), src.indexOf('return () => {'))
    expect(caught).toContain('teardown()')
    expect(caught, 'a half-built stack was left alive').not.toContain('scene?.destroy()')
  })

  it('types the handback so a caller cannot forget the null', () => {
    expect(src).toMatch(/onScene\?:\s*\(scene: Scene \| null\) => void/)
  })

  // ★ `app.init` rejects with no WebGL and no WebGPU, into a chain that had no catch.
  it('★ says why the town will not be drawn, and drops the half-built scene', () => {
    const caught = src.slice(src.indexOf('.catch('), src.indexOf('return () => {'))
    expect(caught).toContain('firstFrameStuck(FIRST_FRAME_COPY.blind)')
    expect(caught).toContain('teardown()')
  })

  // ★ Bubbles stopped for good on the two-hundredth thought: the log is spliced from the head,
  // so an absolute index into it never moves again.
  it('★ spawns bubbles off the thought count, never off a ring index', () => {
    expect(src).not.toMatch(/log\[seenThoughts\]/)
  })
})
