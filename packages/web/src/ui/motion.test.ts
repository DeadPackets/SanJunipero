import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FLING_MAX_MS } from '../render/fling.js'
import {
  AMBIENT_EXEMPT, CSS_DURATION_TOKEN, CSS_EASE_TOKEN, MOTION, MOTIONS, MOTION_CEILING_MS,
  MOTION_EXEMPT, MOTION_FLOOR_MS, durationsIn, easeFn, motionCss, progress, reduced,
  untokenisedDurations,
} from './motion.js'

const CSS = readFileSync(new URL('./chrome.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('the table', () => {
  it('names a motion for every member of MOTIONS and nothing else', () => {
    expect(Object.keys(MOTION).sort()).toEqual([...MOTIONS].sort())
  })

  it('holds every responsive motion inside the mandate band', () => {
    for (const name of MOTIONS) {
      if (AMBIENT_EXEMPT.includes(name)) continue
      expect(MOTION[name].ms, name).toBeLessThanOrEqual(MOTION_CEILING_MS)
      expect(MOTION[name].ms, name).toBeGreaterThanOrEqual(MOTION_FLOOR_MS)
    }
  })

  it('exempts ambient by naming it, never by hiding it above the ceiling', () => {
    expect(AMBIENT_EXEMPT).toEqual(['ambient'])
    expect(MOTION.ambient.ms).toBeGreaterThan(MOTION_CEILING_MS)
  })
})

describe('reduced motion is instant arrival, not the absence of a change', () => {
  it('takes a movement to zero', () => {
    for (const name of MOTIONS) expect(reduced(MOTION[name], 'translate').ms, name).toBe(0)
    expect(reduced(MOTION.enter, 'left').ms).toBe(0)
  })

  it('keeps a nonzero opacity, so a viewer who opted out still sees that something changed', () => {
    for (const name of MOTIONS) {
      const r = reduced(MOTION[name], 'opacity')
      expect(r.ms, name).toBeGreaterThan(0)
      expect(r.ms, name).toBeLessThan(MOTION[name].ms)
    }
  })

  it('drops the stagger — a queue of arrivals is movement in time', () => {
    expect(reduced(MOTION.enter, 'opacity').stagger).toBeUndefined()
  })
})

describe('motionCss', () => {
  it('emits one duration and one easing for every property it names', () => {
    const css = motionCss('enter', ['opacity', 'translate'])
    expect(css).toContain('transition-property: opacity, translate')
    expect(css).toContain(`transition-duration: var(${CSS_DURATION_TOKEN.enter})`)
    expect(css).toContain(`transition-timing-function: var(${CSS_EASE_TOKEN.enter})`)
  })

  it('never emits `all` — a blanket transition animates what nobody meant to', () => {
    expect(() => motionCss('reveal', ['all'])).toThrow()
    expect(motionCss('reveal', ['opacity'])).not.toContain('all')
  })
})

describe('the canvas half reads the same table', () => {
  it('is a curve from 0 to 1, monotonic, for every name', () => {
    for (const name of MOTIONS) {
      const f = easeFn(name)
      expect(f(0), name).toBeCloseTo(0, 6)
      expect(f(1), name).toBeCloseTo(1, 6)
      let prev = -Infinity
      for (let i = 0; i <= 100; i++) {
        const v = f(i / 100)
        expect(v, `${name} at ${i / 100}`).toBeGreaterThanOrEqual(prev - 1e-9)
        prev = v
      }
    }
  })

  it('clamps progress and is exactly 1 at and after the duration', () => {
    expect(progress('scene', 1000, 900)).toBe(0)
    expect(progress('scene', 1000, 1000)).toBe(0)
    expect(progress('scene', 1000, 1000 + MOTION.scene.ms)).toBe(1)
    expect(progress('scene', 1000, 99999)).toBe(1)
    const mid = progress('scene', 1000, 1000 + MOTION.scene.ms / 2)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
  })
})

// ── the sheet and the table cannot disagree ────────────────────────────────────────────────

describe('the stylesheet speaks the same vocabulary', () => {
  it('finds the sheet it is meant to be checking', () => {
    expect(durationsIn(CSS).length).toBeGreaterThan(20)
  })

  it('declares one token per motion, at exactly the table\'s value', () => {
    for (const name of MOTIONS) {
      const token = CSS_DURATION_TOKEN[name]
      const hit = new RegExp(`${token}:\\s*(\\d+)ms`).exec(CSS)
      expect(hit, `${token} is not declared in :root`).not.toBeNull()
      expect(Number(hit![1]), token).toBe(MOTION[name].ms)
    }
  })

  it('declares one easing token per motion, at exactly the table\'s curve', () => {
    for (const name of MOTIONS) {
      const token = CSS_EASE_TOKEN[name]
      const hit = new RegExp(`${token}:\\s*([^;]+);`).exec(CSS)
      expect(hit, `${token} is not declared in :root`).not.toBeNull()
      expect(hit![1]!.trim(), token).toBe(MOTION[name].ease)
    }
  })

  it('writes no raw duration anywhere — every one is a token from this table', () => {
    expect(untokenisedDurations(CSS)).toEqual([])
  })
})

describe('zero is the absence of a motion, and the scan says so out loud', () => {
  it('accepts 0s, which is finish line 6\'s instant hover-out', () => {
    expect(untokenisedDurations('.x:hover { transition-duration: 0s; }')).toEqual([])
  })

  it('still catches every other raw number', () => {
    expect(untokenisedDurations('.x { transition-duration: 200ms; }')).toEqual(['.x — 200ms'])
    expect(untokenisedDurations('.y { animation: a 1.4s linear; }')).toEqual(['.y — 1.4s'])
  })
})

// ── ★ EVERY LONG MOTION IN THE PRODUCT HAS A WRITTEN REASON ───────────────────────────────
//
// The controller's ruling after the camera lane shipped a 700ms drag glide against a 150–300ms
// band: the argument was accepted, but it lived only in a source comment in `render/fling.ts`,
// so the MOTION table showed a band nothing declared an exception to. An unwritten exception is
// a bug with a delay fuse — the next reader "fixes" the deliberate thing, or adds a long motion
// of their own because one already exists unexplained.

describe('the exemptions from the motion band', () => {
  it('★ names every long motion, with a reason, in one table', () => {
    for (const e of MOTION_EXEMPT) {
      expect(e.ms, `${e.what} is exempt but is not actually long`).toBeGreaterThan(MOTION_CEILING_MS)
      expect(e.because.length, `${e.what} has no reason`).toBeGreaterThan(24)
    }
    expect(MOTION_EXEMPT.map((e) => e.what)).toEqual(['ambient', 'fling'])
  })

  it('★ the drag glide is one of them, at the number fling.ts actually enforces', () => {
    const fling = MOTION_EXEMPT.find((e) => e.what === 'fling')
    expect(fling, 'the 700ms glide is over the ceiling with no row here').toBeDefined()
    expect(fling!.ms).toBe(FLING_MAX_MS)
    expect(FLING_MAX_MS).toBeGreaterThan(MOTION_CEILING_MS)
  })

  it('the ceiling check skips exactly the exempt NAMES, derived from the same table', () => {
    expect(AMBIENT_EXEMPT).toEqual(['ambient'])
    for (const name of MOTIONS) {
      if (AMBIENT_EXEMPT.includes(name)) continue
      expect(MOTION[name].ms, name).toBeLessThanOrEqual(MOTION_CEILING_MS)
    }
  })
})
