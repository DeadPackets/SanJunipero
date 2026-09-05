import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { TileId } from '@sj/engine/state'
import {
  FIREFLY_BLINK_HZ,
  FIREFLY_DUSK,
  FIREFLY_MAX,
  FIREFLY_MAX_ALPHA,
  fireflyBlink,
  fireflyDrift,
  fireflySeeds,
  fireflyStrength,
  isClearSky,
} from './fireflies.js'

const src = readFileSync(new URL('./fireflies.ts', import.meta.url), 'utf8')

const NIGHT = 0,
  NOON = 720,
  DUSK = 1140

describe('★ fireflies come out on a clear night and on no other (task 18)', () => {
  // Clear is not a second list of weather words: it is exactly the weather the picture is not
  // graded for, so a kind added to `WEATHER_DIAG` cannot forget to put the swarm away.
  it('★ reads clear off the one grading table, never a list of its own', () => {
    expect(isClearSky('sunny')).toBe(true)
    for (const k of ['cloudy', 'rain', 'storm', 'snow']) expect(isClearSky(k), k).toBe(false)
    expect(src).toContain('WEATHER_DIAG[')
  })

  it('★ none under any cloud, however dark the hour', () => {
    for (const k of ['cloudy', 'rain', 'storm', 'snow'])
      expect(fireflyStrength(k, NIGHT), k).toBe(0)
  })

  it('★ none by day, all at deep night', () => {
    expect(fireflyStrength('sunny', NOON)).toBe(0)
    expect(fireflyStrength('sunny', NIGHT)).toBe(1)
  })

  it('★ holds off through the golden hour and arrives with the dark', () => {
    expect(fireflyStrength('sunny', DUSK)).toBe(0)
    const late = fireflyStrength('sunny', 1200)
    expect(late).toBeGreaterThanOrEqual(0)
    expect(late).toBeLessThan(1)
    // monotone down the evening: never a swarm that thins as it gets darker
    for (let m = 1050; m < 1230; m++)
      expect(fireflyStrength('sunny', m + 1)).toBeGreaterThanOrEqual(fireflyStrength('sunny', m))
  })

  it('the dusk gate is a fraction of the fall to night, not an hour of its own', () => {
    expect(FIREFLY_DUSK).toBeGreaterThan(0)
    expect(FIREFLY_DUSK).toBeLessThan(1)
  })
})

describe('★ over grass, and only over grass', () => {
  const terrain = (rows: number[][]): TileId[][] => rows as TileId[][]

  it('★ seeds no firefly over water, forest, road or bare earth', () => {
    const t = terrain([
      [0, 2, 3],
      [1, 0, 4],
      [2, 3, 0],
    ])
    const seeds = fireflySeeds(t, 99)
    expect(seeds).toHaveLength(3)
    for (const s of seeds) expect(t[s.y]![s.x]).toBe(0)
  })

  it('is deterministic and capped — the same map seeds the same swarm', () => {
    const t = terrain(Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => 0)))
    const a = fireflySeeds(t, 12)
    expect(a).toHaveLength(12)
    expect(fireflySeeds(t, 12)).toEqual(a)
    expect(fireflySeeds(terrain([[2, 2]]), 12)).toEqual([])
  })

  it('caps the swarm so a 75×75 valley is not ten thousand sprites', () => {
    expect(FIREFLY_MAX).toBeLessThanOrEqual(120)
  })
})

describe('★ the drift and the blink', () => {
  it('★ never reaches the photosensitive band: under 3 Hz, like every other light', () => {
    for (const hz of FIREFLY_BLINK_HZ) expect(hz).toBeLessThan(3)
  })

  it('stays inside its own lantern: the drift never leaves the tile it belongs to', () => {
    for (const seed of [0, 1.2, 3.9, 6.1])
      for (let t = 0; t < 30; t += 0.05) {
        const d = fireflyDrift(seed, t)
        expect(Math.hypot(d.dx, d.dy)).toBeLessThanOrEqual(16)
      }
  })

  it('★ blinks between nothing and its ceiling, and never past it', () => {
    let low = 1
    let high = 0
    for (let t = 0; t < 40; t += 0.01) {
      const a = fireflyBlink(1.1, t)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThanOrEqual(1)
      low = Math.min(low, a)
      high = Math.max(high, a)
    }
    expect(low).toBeLessThan(0.05)
    expect(high).toBeGreaterThan(0.9)
    expect(FIREFLY_MAX_ALPHA).toBeLessThanOrEqual(0.8)
  })

  it('no two agree — the phase comes off the seed', () => {
    const at = (p: number): number[] => Array.from({ length: 40 }, (_, i) => fireflyBlink(p, i / 8))
    expect(at(0.3)).not.toEqual(at(2.7))
  })
})

describe('what the swarm must not cost', () => {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // ★ POOLED, NEVER PER FRAME. The review just took the per-frame rebuilds out of this
  // renderer; a swarm that allocates ninety sprites a frame would put them straight back.
  it('★ builds its sprites once and only writes to them afterwards', () => {
    const at = code.lastIndexOf('tick(dtMs')
    expect(at).toBeGreaterThan(0)
    const body = code.slice(at)
    expect(body).not.toContain('new Sprite')
    expect(body).not.toContain('new Container')
    expect(body).not.toContain('bakeTexture')
  })

  it('★ lives in the lights layer, above the night multiply, and sorts nothing', () => {
    expect(code).toContain('screen.lights')
    expect(code).not.toMatch(/\.zIndex\s*=(?!=)/)
  })

  it('★ culls: a firefly off the edge of the view is not drawn', () => {
    expect(code).toContain('rectInView(')
  })

  it('honours prefers-reduced-motion through the scene, the one owner of the question', () => {
    expect(code).toContain('scene.wantsMotion()')
  })

  it('never swallows a pointer', () => {
    expect(code).toMatch(/eventMode = 'none'/)
  })
})
