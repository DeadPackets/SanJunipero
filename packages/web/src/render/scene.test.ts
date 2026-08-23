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
// `TypeError: Cannot read properties of null (reading 'start')`, thrown at load from
// `App.tsx`'s `scene.app.ticker.start()`. Reproduced in a FOREGROUNDED browser tab against
// the running dev world: `scene.app.ticker` is a live Ticker, `scene.destroy()` runs, and
// Pixi's `Application.destroy()` nulls the field — so the very next `.start()` throws.
//
// ★ IT IS NOT StrictMode. `main.tsx` renders `<App />` bare and StrictMode has never appeared
// in this tree; the double-mount is Vite Fast Refresh remounting `StageMount`, whose effect
// destroys the scene while React state upstream still points at it. The cause is the same
// either way and so is the fix: React must never hold a dead scene, and the scene must not be
// reached through `app.ticker` by anyone who cannot know whether it is still alive.

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
    const app: { ticker: { start(): void; stop(): void } | null } =
      { ticker: { start: () => calls.push('start'), stop: () => calls.push('stop') } }
    const clock = sceneClock(app)
    clock.close()
    app.ticker = null                       // exactly what Application.destroy() does
    expect(() => clock.set(true)).not.toThrow()
    expect(() => clock.set(false)).not.toThrow()
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
// captured once at boot would typecheck, pass every unit test, and cull against a camera that
// has since moved — the whole town would blink out the moment a viewer panned. That is the
// green-suite-blank-screen failure this project keeps meeting, so the wire is scanned.

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
// fling.ts is pure and fully tested; what it cannot test is that the scene ASKED. A glide left
// running while a zoom captures its anchor, or while a follow is steering, is not a slow bug —
// it is two owners writing the same position every frame.

/**
 * ★ ONE FUNCTION'S BODY, AND NOT ITS NEIGHBOUR'S.
 *
 * This read `src.slice(i, i + 420)`. Four hundred and twenty characters is longer than most of
 * the movers, so a short one's window spilled into whatever was declared next — and `panBy`,
 * `centerHome` and `setFollow` all sit in one list of camera writers that each begin with
 * `stopGlide()`. Caught while adding the fifth: with `travelTo`'s own `stopGlide()` DELETED,
 * "travelTo stops it" still passed, on the line belonging to the function below it. A guard
 * that can be satisfied by its neighbour is not a guard, and this one was one deletion away
 * from being discovered by a viewer instead of by a test.
 *
 * A body now ends where its indentation says it ends.
 */
export function functionBody(src: string, name: string): string {
  const i = src.indexOf(name)
  if (i < 0) return ''
  const ends = ['\n    },', '\n  }'].map((e) => src.indexOf(e, i)).filter((n) => n > 0)
  return src.slice(i, ends.length === 0 ? src.length : Math.min(...ends))
}

describe('a glide is ended by anything that says where the camera should be', () => {
  const src = readFileSync(join(WEB_SRC, 'render', 'scene.ts'), 'utf8')
  const body = (name: string): string => functionBody(src, name)

  it('the wheel stops it before it captures a zoom anchor', () => {
    const wheel = body('const onWheel =')
    expect(wheel.indexOf('stopGlide()')).toBeGreaterThan(-1)
    expect(wheel.indexOf('stopGlide()')).toBeLessThan(wheel.indexOf('captureAnchor'))
  })

  for (const mover of [
    'function fitTo(', 'panBy: (dx, dy) =>', 'centerHome: () =>', 'setFollow: (target) =>',
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
    expect(src).toMatch(/if \(isDrag\(drag\)\) return \/\/ a drag is not a tile pick/)
    // and no second, hand-rolled slop test survives anywhere in the scene
    expect(src).not.toMatch(/Math\.abs\(dx\) \+ Math\.abs\(dy\) >/)
  })

  it('asks about reduced motion before it starts one', () => {
    expect(src).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
    expect(body('const endDrag =')).toContain('wantsMotion()')
  })

  it('gives the glide back its ticker slot on teardown', () => {
    expect(src).toContain('app.ticker.remove(glideTick)')
  })
})

// ── ★ THE MINIMAP DOES NOT OPEN A FIFTH DOOR ONTO THE CAMERA ──────────────────────────────
//
// Four things already outrank a running throw, and each does the same four steps in the same
// order. A minimap that wrote `world.position` itself, or that called `centerOnScreen` without
// the other three, would be a way to move the camera that skips every guard the camera lane
// proved bites — and it would look right in the browser until the day somebody clicked the map
// while a throw was still in the air. So the ONE new mover is asserted to be the same shape as
// the four, in order, and the chrome is scanned for anyone reaching past it.

describe('going somewhere from the map takes the same road as going home', () => {
  const src = readFileSync(join(WEB_SRC, 'render', 'scene.ts'), 'utf8')
  const body = (name: string): string => functionBody(src, name)

  it('★ the reader stops at the end of the function it was asked for', () => {
    const fake = [
      'const a = () => {', '  first()', '}', 'const b = () => {', '  second()', '}', '',
    ].join('\n  ')
    expect(functionBody(`  ${fake}`, 'const a =')).toContain('first()')
    expect(functionBody(`  ${fake}`, 'const a ='), 'read into the next function')
      .not.toContain('second()')
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

  it('the map is drawn over the SAME box the clamp uses, from one accessor', () => {
    expect(src).toContain('reachableBox: () => bounds')
    // and `bounds` is the thing every write to the camera is clamped against
    expect(src).toMatch(/clampCamera\(\{ x, y \}, world\.scale\.x, bounds, screenBox\(\)\)/)
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
