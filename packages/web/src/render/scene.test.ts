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
