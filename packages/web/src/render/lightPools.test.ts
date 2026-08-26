import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  flamesAt,
  isDark,
  lightBandAt,
  type LitWorld,
  type SimConfig,
} from '@sj/shared'
import { FIRE_COLOR, SMOKE_COLOR } from './ambient.js'
import { CLOCK_STOPS } from './tints.js'
import { TILE_H, TILE_W } from './iso.js'
import {
  POOL_COLOR,
  POOL_DUSK_SCALE,
  POOL_MAX_ALPHA,
  POOL_SWING,
  poolCentre,
  poolRadiusPx,
  poolStrengthAt,
} from './lightPools.js'

const CFG: SimConfig = DEFAULT_CONFIG
const NOON = 12 * 60,
  DUSK = 19 * 60 + 30,
  MIDNIGHT = 0

const world = (over: Partial<LitWorld> = {}): LitWorld => ({
  agents: {},
  items: {},
  structures: {},
  ...over,
})

const lamp = (x: number, y: number, fueledUntilTick?: number): LitWorld =>
  world({
    structures: {
      lamp_1: {
        kind: 'lamp_post',
        x,
        y,
        w: 1,
        h: 1,
        stage: 'complete',
        ...(fueledUntilTick === undefined ? {} : { fueledUntilTick }),
      },
    },
  })

// One source, two consumers: before it, the render darkened the screen with a clock tint that
// knew nothing about fire while `isDark` walked the flames.

describe('the picture and the query cannot disagree about what is alight', () => {
  it('paints a pool for exactly the flames `isDark` answers to, and for no others', () => {
    const lit = lamp(10, 10, MIDNIGHT + 500)
    const cold = lamp(10, 10)
    for (const tick of [NOON, DUSK, MIDNIGHT]) {
      const painted = poolStrengthAt(tick) > 0 ? flamesAt(lit, tick, CFG).length : 0
      const queried = isDark(lit, 10, 10, tick, CFG) ? 0 : flamesAt(lit, tick, CFG).length
      // At night the flame is the only reason the tile is not dark, and both sides see it.
      if (tick === MIDNIGHT) expect([painted, queried]).toEqual([1, 1])
    }
    // A post nobody fed: no flame, no pool, and the query says dark.
    expect(flamesAt(cold, MIDNIGHT, CFG)).toEqual([])
    expect(isDark(cold, 10, 10, MIDNIGHT, CFG)).toBe(true)
  })

  it('★ is not vacuous: the same world at the same tick has a pooled tile and a dark one', () => {
    const lit = lamp(10, 10, MIDNIGHT + 500)
    expect(isDark(lit, 10, 10, MIDNIGHT, CFG)).toBe(false)
    expect(isDark(lit, 20, 20, MIDNIGHT, CFG)).toBe(true)
    expect(flamesAt(lit, MIDNIGHT, CFG)).toHaveLength(1)
  })

  it('brightens on the same word the band changes on: dark, dim, then nothing at all', () => {
    expect(lightBandAt(world(), 0, 0, MIDNIGHT, CFG)).toBe('dark')
    expect(poolStrengthAt(MIDNIGHT)).toBe(1)
    expect(lightBandAt(world(), 0, 0, DUSK, CFG)).toBe('dim')
    expect(poolStrengthAt(DUSK)).toBe(POOL_DUSK_SCALE)
    expect(lightBandAt(world(), 0, 0, NOON, CFG)).toBe('bright')
    expect(poolStrengthAt(NOON)).toBe(0) // the day needs no help
    expect(POOL_DUSK_SCALE).toBeGreaterThan(0)
    expect(POOL_DUSK_SCALE).toBeLessThan(1)
  })
})

describe('the pool is a pool of light and not a pale plate', () => {
  it('cannot reach full brightness, the same ceiling the window glow answers to', () => {
    expect(POOL_MAX_ALPHA + POOL_SWING).toBeLessThanOrEqual(0.5)
  })

  it('is the same warm token the fire already uses, never cream', () => {
    expect(POOL_COLOR).toBe(FIRE_COLOR) // one warm-light token in the render, not two
    expect(POOL_COLOR).not.toBe(SMOKE_COLOR) // cream read as white glass; that is the round-3 defect
  })

  // `atmosphere.ts` multiplies the whole stage by the clock tint, and at deep night that tint
  // keeps 95% of blue against 45% of red — so honey `#F2C879` comes out BLUE-dominant and reads
  // as moonlight. This is the arithmetic, so nobody has to re-derive it by eye.
  it('★ still reads WARM after the night multiply — measured, not chosen', () => {
    const NIGHT_TINT = CLOCK_STOPS.find((s) => s.minute === 0)!.tint
    const after = (rgb: number): [number, number, number] => [
      ((rgb >> 16) & 0xff) * NIGHT_TINT[0],
      ((rgb >> 8) & 0xff) * NIGHT_TINT[1],
      (rgb & 0xff) * NIGHT_TINT[2],
    ]
    const [r, , b] = after(POOL_COLOR)
    expect(
      r - b,
      'the pool reads cold at midnight — a lamp that reads cold is not relief',
    ).toBeGreaterThan(0)
    // and the colour it replaced is the counter-example that makes this test mean something
    const [hr, , hb] = after(0xf2c879)
    expect(hr - hb).toBeLessThan(0)
  })

  it("covers the flame's own reach on the iso ground, wide as it is tall by the tile ratio", () => {
    // `sx = (dx-dy)*16, sy = (dx+dy)*8`, so a chebyshev square is a diamond twice as wide as
    // it is tall. A pool that ignored that would be a circle on a dimetric floor.
    for (const r of [3, 4, 5]) {
      const { rx, ry } = poolRadiusPx(r)
      expect(rx / ry).toBe(TILE_W / TILE_H)
      expect(rx).toBeGreaterThan(r * TILE_W) // reaches past the last lit tile's centre
    }
    expect(poolRadiusPx(CFG.light.glowRadius.lamp_post)).toEqual({
      rx: 4.5 * TILE_W,
      ry: 4.5 * TILE_H,
    })
  })

  it('pools from the middle of a long footprint, not from its anchor corner', () => {
    expect(
      poolCentre({ id: 'a', source: 'structure', x: 10, y: 10, w: 1, h: 1, radius: 4 }),
    ).toEqual({ sx: 0, sy: 10 * TILE_H })
    // a 3x1 hearth pools from (11,10), one tile along, exactly where `distanceToFlame` measures
    expect(
      poolCentre({ id: 'b', source: 'structure', x: 10, y: 10, w: 3, h: 1, radius: 3 }),
    ).toEqual({ sx: TILE_W / 2, sy: 10.5 * TILE_H })
  })
})

describe('what this pass must not have broken', () => {
  const src = readFileSync(new URL('./lightPools.ts', import.meta.url), 'utf8')
  // The guard below first read the whole file and tripped on its own explanation of why it does
  // not touch the bake, so everything asserted as ABSENT reads comment-stripped source.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')

  it('★ does not touch the ground bake: it draws on groundDecal, never on `ground`', () => {
    // The bake is chunked and `MAX_TEXTURE_SIZE` 2048 is crossed between ring one and ring two.
    // A pool painted INTO the bake would be in that budget and would be re-baked every time a
    // torch moved. It is a sprite on the decoration layer instead.
    expect(src).toContain('scene.layers.groundDecal.addChild(root)')
    expect(code).not.toContain('layers.ground.')
    expect(code).not.toMatch(/bake|chunk/i)
  })

  it("★ writes no zIndex and joins no sorted layer, so the painter's order is untouched", () => {
    expect(code).not.toMatch(/\.zIndex\s*=(?!=)/)
    expect(code).not.toContain('sortableChildren')
    expect(code).not.toContain('layers.entities')
  })

  it('★ culls: an offscreen flame is not drawn, through the one function everything asks', () => {
    expect(src).toContain('rectInView(')
    expect(src).toContain('scene.viewRect()')
  })

  it('honours prefers-reduced-motion — a breathing lamp is a motion decision', () => {
    expect(src).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
    expect(src).toContain('const breath = still ? 0 :')
  })

  it('never swallows a pointer: a decoration that takes a click is a picking bug', () => {
    expect(src).toContain("root.eventMode = 'none'")
    expect(src).toContain("s.eventMode = 'none'")
  })

  // Pixi's `GCSystem` unloads any resource with `autoGarbageCollect` that goes untouched for
  // `maxUnusedTime`, and an unloaded source is a null one that takes the whole stage down. A
  // source-text guard is weak, so these say exactly which line they stand on.
  it("★ pins BOTH the texture and the sprites against pixi's GC", () => {
    // Two resources, two defaults, one crash: `TextureSource` and `ViewContainer` are both
    // GC-managed, and a pool at `visible = false` through a day is untouched on both counts.
    expect(src).toContain('tex.source.autoGarbageCollect = false')
    expect(src).toContain('s.autoGarbageCollect = false')
  })

  it('★ does not churn the pool on a clock boundary — that churn is what fed the GC', () => {
    // `flamesAt` is asked EVERY frame, day included; the day only sets `visible`.
    expect(src).toContain('const flames = flamesAt(state, tick, DEFAULT_CONFIG)')
    expect(code).not.toMatch(/strength === 0 \? \[\]/)
    expect(src).toContain('s.visible = seen')
    // Every destroy on a SPRITE must spare the shared texture. `root` and the throwaway Graphics
    // own nothing shared, so they are named exemptions rather than a blanket skip.
    for (const m of code.match(/(\w+)\.destroy\(([^)]*)\)/g) ?? []) {
      if (m.startsWith('root.destroy') || m.startsWith('g.destroy') || m.startsWith('tex.destroy'))
        continue
      expect(m, `${m} could destroy the texture every sprite shares`).toContain('texture: false')
    }
  })
})
