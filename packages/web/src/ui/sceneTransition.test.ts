import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MOTION, MOTION_CEILING_MS } from './motion.js'
import {
  GRAVE_STRETCH,
  SCENES,
  SCENE_IN_MS,
  SCENE_OUT_MS,
  SCENE_TOTAL_MS,
  idleScene,
  sceneAlpha,
  sceneMotion,
  sceneReducer,
  type SceneState,
} from './sceneTransition.js'

const at0 = (): SceneState => idleScene('lens', 'town')

describe('the state machine', () => {
  it('sums the two halves to one scene motion', () => {
    expect(SCENE_OUT_MS + SCENE_IN_MS).toBe(MOTION.scene.ms)
    expect(SCENE_TOTAL_MS).toBe(MOTION.scene.ms)
  })

  it('goes idle -> out -> in -> idle, and is idle at exactly out + in', () => {
    let s = sceneReducer(at0(), { kind: 'go', name: 'lens', to: 'chronicle', atMs: 1000 })
    expect(s.phase).toBe('out')
    s = sceneReducer(s, { kind: 'tick', atMs: 1000 + SCENE_OUT_MS - 1 })
    expect(s.phase).toBe('out')
    s = sceneReducer(s, { kind: 'tick', atMs: 1000 + SCENE_OUT_MS })
    expect(s.phase).toBe('in')
    s = sceneReducer(s, { kind: 'tick', atMs: 1000 + SCENE_TOTAL_MS - 1 })
    expect(s.phase).toBe('in')
    s = sceneReducer(s, { kind: 'tick', atMs: 1000 + SCENE_TOTAL_MS })
    expect(s.phase).toBe('idle')
    expect(s.from).toBe('chronicle')
    expect(s.to).toBe('chronicle')
  })

  it('retargets a second `go` during `out` without restarting the clock', () => {
    const a = sceneReducer(at0(), { kind: 'go', name: 'lens', to: 'chronicle', atMs: 1000 })
    const b = sceneReducer(a, { kind: 'go', name: 'lens', to: 'society', atMs: 1040 })
    expect(b.startedMs).toBe(a.startedMs)
    expect(b.phase).toBe('out')
    expect(b.to).toBe('society')
    expect(b.from).toBe(a.from)
  })

  it('starts a fresh transition for a `go` that arrives once the scene is in', () => {
    let s = sceneReducer(at0(), { kind: 'go', name: 'lens', to: 'chronicle', atMs: 1000 })
    s = sceneReducer(s, { kind: 'tick', atMs: 1000 + SCENE_OUT_MS })
    const next = sceneReducer(s, { kind: 'go', name: 'lens', to: 'society', atMs: 1200 })
    expect(next.startedMs).toBe(1200)
    expect(next.phase).toBe('out')
    expect(next.from).toBe('chronicle')
  })

  it('ignores a `go` to where it already is and stays idle', () => {
    const s = sceneReducer(at0(), { kind: 'go', name: 'lens', to: 'town', atMs: 500 })
    expect(s.phase).toBe('idle')
  })
})

describe('sceneAlpha', () => {
  const go = (): SceneState =>
    sceneReducer(at0(), { kind: 'go', name: 'lens', to: 'chronicle', atMs: 0 })

  it('never has the outgoing and the incoming both up — a crossfade of two live scenes smears', () => {
    let s = go()
    for (let t = 0; t <= SCENE_TOTAL_MS + 40; t += 4) {
      s = sceneReducer(s, { kind: 'tick', atMs: t })
      const a = sceneAlpha(s, t)
      expect(a.out === 0 || a.in === 0, `both up at ${t}ms: ${JSON.stringify(a)}`).toBe(true)
      expect(a.out).toBeGreaterThanOrEqual(0)
      expect(a.in).toBeLessThanOrEqual(1)
    }
  })

  it('leaves the outgoing fully up at the instant it starts and fully gone when it ends', () => {
    const s = go()
    expect(sceneAlpha(s, 0).out).toBeCloseTo(1, 6)
    expect(sceneAlpha(s, SCENE_OUT_MS).out).toBe(0)
  })

  it('lands the incoming at exactly 1 when the scene is done', () => {
    let s = go()
    s = sceneReducer(s, { kind: 'tick', atMs: SCENE_TOTAL_MS })
    expect(sceneAlpha(s, SCENE_TOTAL_MS).in).toBe(1)
  })

  it('under reduced motion runs the SAME state machine and only steps the curve', () => {
    let s = go()
    const seen = new Set<number>()
    for (let t = 0; t <= SCENE_TOTAL_MS; t += 10) {
      s = sceneReducer(s, { kind: 'tick', atMs: t })
      const a = sceneAlpha(s, t, true)
      seen.add(a.out)
      seen.add(a.in)
    }
    // a step function takes only the two end values — nothing in between
    expect([...seen].sort()).toEqual([0, 1])
  })
})

describe('sceneMotion', () => {
  it('is total over SCENES', () => {
    for (const name of SCENES) {
      expect(sceneMotion(name, false).ms, name).toBeGreaterThan(0)
      expect(sceneMotion(name, true).ms, name).toBeGreaterThan(0)
    }
  })

  it('gives grave tone the QUIET variant of the motion, never the absence of one (P10)', () => {
    for (const name of SCENES) {
      const plain = sceneMotion(name, false)
      const grave = sceneMotion(name, true)
      expect(grave.ms, name).toBeGreaterThan(plain.ms)
      expect(grave.ms, name).not.toBe(0)
      expect(grave.stagger, name).toBeUndefined()
      expect(grave.ms, name).toBe(Math.round(plain.ms * GRAVE_STRETCH))
    }
  })

  it('keeps every responsive scene inside the mandate band, grave included', () => {
    for (const name of SCENES) {
      if (sceneMotion(name, false).ms === MOTION.ambient.ms) continue // the day crossing is scenery
      expect(sceneMotion(name, true).ms, name).toBeLessThanOrEqual(MOTION_CEILING_MS)
    }
  })

  it('crosses the day over the ambient motion, not over a responsive one', () => {
    expect(sceneMotion('daybreak', false).ms).toBe(MOTION.ambient.ms)
    expect(sceneMotion('nightfall', false).ms).toBe(MOTION.ambient.ms)
  })
})

// ── the four transitions, as they are actually wired ───────────────────────────────────────

const APP = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const DIRECTOR = readFileSync(new URL('./DirectorMode.tsx', import.meta.url), 'utf8')
const INTERIOR = readFileSync(new URL('../render/interiorScene.ts', import.meta.url), 'utf8')
const ATMOS = readFileSync(new URL('../render/atmosphere.ts', import.meta.url), 'utf8')

describe('the chrome keeps ONE motion vocabulary', () => {
  it('writes no timeout of its own beside the table', () => {
    expect(APP, 'a hand-written timeout is a second motion vocabulary').not.toMatch(
      /setTimeout\([^)]*\d{3}\)/,
    )
  })
})

describe('entering a room is a camera going in, not a card appearing', () => {
  it('takes its fade length from the scene vocabulary', () => {
    expect(INTERIOR).toContain('SCENE_TOTAL_MS')
  })

  it('pushes the town camera at the door and puts it back where it was', () => {
    expect(INTERIOR).toMatch(/pushIn|PUSH_IN/)
    expect(INTERIOR).toContain('restoreCamera')
  })
})

describe('following someone eases the zoom', () => {
  it("goes through the camera's own stop machine, which eases — never a raw scale write", () => {
    expect(DIRECTOR).toContain('scene.setZoom(directorZoom(')
    expect(DIRECTOR).not.toMatch(/world\.scale/)
  })
})

describe('the day crosses instead of stepping', () => {
  it('interpolates the clock tint between ticks over the ambient motion', () => {
    expect(ATMOS).toContain('crossTint')
    expect(ATMOS).toContain("'ambient'")
  })
})
