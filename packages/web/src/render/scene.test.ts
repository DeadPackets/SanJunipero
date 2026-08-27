import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
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

  it('is what App.tsx actually calls', () => {
    expect(readFileSync(join(WEB_SRC, 'App.tsx'), 'utf8')).toContain('setTicking')
  })
})

// ── the cull's one wire ───────────────────────────────────────────────────────────────────
//
// The type says `applyDepthOrder` takes a view; it cannot say the view is THIS FRAME'S. A rect
// captured once at boot typechecks and culls against a camera that has moved, so it is scanned.

describe('the frame culls against the camera it is actually looking through', () => {
  const src = readFileSync(join(WEB_SRC, 'render', 'scene.ts'), 'utf8')

  it('calls the depth order with a freshly read viewRect, not a stored one', () => {
    expect(src).toMatch(/applyDepthOrder\(\s*entries,\s*viewRect\(\)\s*\)/)
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

describe('a glide is ended by anything that says where the camera should be', () => {
  const src = readFileSync(join(WEB_SRC, 'render', 'cameraRig.ts'), 'utf8')
  const body = (name: string): string => functionBody(src, name)

  it('the wheel stops it before it captures a zoom anchor', () => {
    const wheel = body('const onWheel =')
    expect(wheel.indexOf('stopGlide()')).toBeGreaterThan(-1)
    expect(wheel.indexOf('stopGlide()')).toBeLessThan(wheel.indexOf('captureAnchor'))
  })

  for (const mover of [
    'function fitTo(',
    'panBy: (dx, dy) =>',
    'centerHome: () => {',
    'setFollow: (target) =>',
    'travelTo: (sx, sy) =>',
  ]) {
    it(`${mover.replace(/[(:].*/, '')} stops it`, () => {
      expect(body(mover)).toContain('stopGlide()')
    })
  }

  it('catching the camera with a pointer stops it, as a hand would', () => {
    expect(body("app.stage.on('pointerdown'")).toContain('stopGlide()')
  })

  it('★ a tap and a throw read ONE tracker, so a click can never become a fling', () => {
    expect(src).toMatch(/if \(isDrag\(drag\)\) return\b/)
    // and no second, hand-rolled slop test survives anywhere in the scene
    expect(src).not.toMatch(/Math\.abs\(dx\) \+ Math\.abs\(dy\) >/)
  })

  it('★ a tile pick means the pointer landed on the GROUND, not on a body or a building', () => {
    expect(body("app.stage.on('pointertap'")).toContain('e.target !== app.stage')
  })

  it('★ and the stage hit area survives, because the camera is standing on it', () => {
    // CODE, not the file: the comment above the handler quotes this very line, and a guard
    // that reads its own explanation is satisfied by the explanation. Caught by mutation.
    const code = src
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
      .join('\n')
    expect(code).toContain('app.stage.hitArea = app.screen')
    for (const gesture of ['pointerdown', 'pointermove', 'pointerup']) {
      expect(code, gesture).toContain(`app.stage.on('${gesture}'`)
    }
  })

  it('asks about reduced motion before it starts one', () => {
    expect(src).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
    expect(body('const endDrag =')).toContain('wantsMotion()')
  })

  it('gives the glide back its ticker slot on teardown', () => {
    expect(src).toContain('app.ticker.remove(glideTick)')
  })
})

// ── ★ THE GESTURE MUST BE RELEASED, OR THE CAMERA NEVER RESTS ON AN EXACT STOP ────────────
//
// The end of a wheel gesture is the ABSENCE of an event, so the release lives on the frame;
// without it the camera holds whatever fractional scale the hand left it at.
describe('★ the wheel gesture is released on the frame, so the resting frame stays exact', () => {
  const src = readFileSync(join(WEB_SRC, 'render', 'cameraRig.ts'), 'utf8')
  const body = (name: string): string => functionBody(src, name)

  it('zoomTick asks whether the hand has left, and releases when it has', () => {
    const tick = body('const zoomTick =')
    expect(tick).toContain('zoomGestureEnded(zoom, now)')
    expect(tick).toContain('zoomRelease(zoom, now')
    // and it does so BEFORE it reads the scale, or the release lands a frame late
    expect(tick.indexOf('zoomRelease')).toBeLessThan(tick.indexOf('zoomScaleAt'))
  })

  it('reduced motion reaches the release, so the settle is instant for a viewer who asked', () => {
    expect(body('const zoomTick =')).toContain('!wantsMotion()')
  })

  it('★ the anchor is captured ONCE PER GESTURE, not once per event', () => {
    const wheel = body('const onWheel =')
    // guarded by the gesture test, not fired unconditionally: re-pinning on every event makes
    // the town swim under the cursor instead of growing beneath it
    expect(wheel).toMatch(
      /if \(zoom\.live === null \|\| now - zoom\.lastWheelMs > WHEEL_GESTURE_GAP_MS\)/,
    )
    expect(wheel.indexOf('captureAnchor')).toBeGreaterThan(wheel.indexOf('zoom.live === null'))
  })

  it('the pinch flag reaches the rule — a trackpad pinch is not a scroll', () => {
    expect(body('const onWheel =')).toContain('e.ctrlKey')
  })

  it('gives the zoom back its ticker slot on teardown', () => {
    expect(src).toContain('app.ticker.remove(zoomTick)')
  })
})

// ── ★ THE MINIMAP DOES NOT OPEN A FIFTH DOOR ONTO THE CAMERA ──────────────────────────────
//
// A mover that wrote `world.position` itself would skip every guard, and would look right in
// the browser until somebody clicked the map while a throw was still in the air.

describe('going somewhere from the map takes the same road as going home', () => {
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

  it('the map is drawn over the SAME box the clamp uses, from one accessor', () => {
    // the scene owns `bounds`, and hands the rig the very accessor the minimap is drawn from
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
    expect(cleanup).toContain('scene?.destroy()')
    expect(cleanup).toMatch(/onScene\?\.\(null\)/)
  })

  it('types the handback so a caller cannot forget the null', () => {
    expect(src).toMatch(/onScene\?:\s*\(scene: Scene \| null\) => void/)
  })
})
