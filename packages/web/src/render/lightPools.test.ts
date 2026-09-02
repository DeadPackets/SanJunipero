import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

// Driven for real below, so which config priced the flame is read off the sprite it painted.
vi.mock('pixi.js', () => {
  class Point {
    x = 0
    y = 0
    set(x: number, y: number = x): void {
      this.x = x
      this.y = y
    }
  }
  class Container {
    children: Container[] = []
    visible = true
    alpha = 1
    width = 0
    height = 0
    tint = 0xffffff
    eventMode = ''
    blendMode = ''
    autoGarbageCollect = true
    destroyed = false
    position = new Point()
    scale = new Point()
    anchor = new Point()
    addChild(...cs: Container[]): void {
      this.children.push(...cs)
    }
    destroy(): void {
      this.destroyed = true
    }
  }
  class Sprite extends Container {}
  class Graphics extends Container {
    circle(): this {
      return this
    }
    rect(): this {
      return this
    }
    fill(): this {
      return this
    }
  }
  const Texture = { EMPTY: {} }
  return { Container, Graphics, Point, Sprite, Texture }
})
vi.mock('./entities.js', () => ({ entitySpriteOf: () => null }))
import {
  DEFAULT_CONFIG,
  flamesAt,
  isDark,
  type AssetRecord,
  type LitWorld,
  type SimConfig,
} from '@sj/shared'
import { CLOCK_STOPS, skyLevel } from './tints.js'
import { TILE_H, TILE_W, feetOf } from './iso.js'
import { phaseOf } from './charAnim.js'
import { cellPointOf } from './textures.js'
import {
  BLOOM_ALPHA,
  BREATH_AMP,
  FIRE_ALPHA,
  GLOW_BASE_ALPHA,
  POOL_COLOR,
  POOL_MAX_ALPHA,
  breath,
  createLightPools,
  poolCentre,
  poolDiscAlpha,
  poolRadiusPx,
  poolStrengthAt,
} from './lightPools.js'
import type { Scene } from './scene.js'
import type { WorldStore } from '../state/worldStore.js'

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
    const painted = poolStrengthAt(MIDNIGHT) > 0 ? flamesAt(lit, MIDNIGHT, CFG).length : 0
    const queried = isDark(lit, 10, 10, MIDNIGHT, CFG) ? 0 : flamesAt(lit, MIDNIGHT, CFG).length
    expect([painted, queried]).toEqual([1, 1])
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

  it('is the inverse of the one sky curve: full at midnight, nothing at noon, partway at dusk', () => {
    expect(poolStrengthAt(MIDNIGHT)).toBe(1)
    expect(poolStrengthAt(NOON)).toBe(0)
    expect(poolStrengthAt(DUSK)).toBeCloseTo(1 - skyLevel(DUSK), 12)
    expect(poolStrengthAt(DUSK)).toBeGreaterThan(0)
    expect(poolStrengthAt(DUSK)).toBeLessThan(1)
    expect(poolStrengthAt(MIDNIGHT + 1440 * 3)).toBe(1) // any day, the same clock
  })
})

describe('the breath (U3) — two incommensurate sines, phased by the id', () => {
  it('stays inside BREATH_AMP for every light at every instant', () => {
    for (const id of ['lamp_1', 'hearth_7', 'fire_pit_2', 'torch:omar'])
      for (let t = 0; t < 30; t += 0.01)
        expect(Math.abs(breath(phaseOf(id), t)), `${id} @ ${t}`).toBeLessThanOrEqual(BREATH_AMP)
  })

  it('no two lamps agree — the phase comes off hash32(id)', () => {
    const a = Array.from({ length: 50 }, (_, i) => breath(phaseOf('lamp_a'), i / 10))
    const b = Array.from({ length: 50 }, (_, i) => breath(phaseOf('lamp_b'), i / 10))
    expect(a).not.toEqual(b)
    expect(phaseOf('lamp_a')).not.toBe(phaseOf('lamp_b'))
  })

  it('is deterministic — the same id at the same instant breathes the same', () => {
    expect(breath(phaseOf('x'), 1.234)).toBe(breath(phaseOf('x'), 1.234))
  })

  it('never reaches the photosensitive band: 1.7 Hz and 2.9 Hz, not 7', () => {
    const src = readFileSync(new URL('./lightPools.ts', import.meta.url), 'utf8')
    expect(src).toContain('2 * Math.PI * 1.7 * tSec')
    expect(src).toContain('2 * Math.PI * 2.9 * tSec')
    expect(src).not.toMatch(/FIRE_HZ|\* 7 \*/)
  })

  it('keeps every light under its ceiling with the breath on top', () => {
    // the pool breathes about its ceiling and is clamped to it, so it only ever dips
    const src = readFileSync(new URL('./lightPools.ts', import.meta.url), 'utf8')
    expect(src).toMatch(
      /Math\.min\(\s*POOL_MAX_ALPHA,\s*\(POOL_MAX_ALPHA \+ \(b \* POOL_MAX_ALPHA\) \/ FIRE_ALPHA\) \* strength/,
    )
    expect(POOL_MAX_ALPHA).toBeLessThanOrEqual(0.5)
    expect(GLOW_BASE_ALPHA + 2 * BREATH_AMP).toBeLessThanOrEqual(0.5)
    expect(BLOOM_ALPHA + BREATH_AMP).toBeLessThan(0.6)
    expect(FIRE_ALPHA + BREATH_AMP).toBeLessThan(0.75)
  })
})

describe('two lamp heads side by side', () => {
  it('★ never add past the authored colour: two blooms, breath on top, dead centre', () => {
    // The disc falls off from its core, so two coincident heads at full breath are the worst
    // case. Additive over the head: a sum of 1 is exactly POOL_COLOR; past it the channels clip.
    const core = poolDiscAlpha(0)
    expect(core).toBeGreaterThan(0.8)
    expect(2 * (BLOOM_ALPHA + BREATH_AMP) * core).toBeLessThanOrEqual(1)
    // not vacuous: 0.5 clips where two posts stand together
    expect(2 * (0.5 + BREATH_AMP) * core).toBeGreaterThan(1)
  })
})

describe('the pool is a pool of light and not a pale plate', () => {
  it('is the one warm-light token, never cream', () => {
    expect(POOL_COLOR).toBe(0xf7a66b)
  })

  // The token was chosen to survive the night multiply, even though it now sits above it.
  it('★ reads WARM even under the night multiply — measured, not chosen', () => {
    const NIGHT_TINT = CLOCK_STOPS.find((s) => s.minute === 0)!.tint
    const after = (rgb: number): [number, number, number] => [
      ((rgb >> 16) & 0xff) * NIGHT_TINT[0],
      ((rgb >> 8) & 0xff) * NIGHT_TINT[1],
      (rgb & 0xff) * NIGHT_TINT[2],
    ]
    const [r, , b] = after(POOL_COLOR)
    expect(r - b).toBeGreaterThan(0)
    const [hr, , hb] = after(0xf2c879)
    expect(hr - hb).toBeLessThan(0)
  })

  it("covers the flame's own reach on the iso ground, wide as it is tall by the tile ratio", () => {
    for (const r of [3, 4, 5]) {
      const { rx, ry } = poolRadiusPx(r)
      expect(rx / ry).toBe(TILE_W / TILE_H)
      expect(rx).toBeGreaterThan(r * TILE_W)
    }
    expect(poolRadiusPx(CFG.light.glowRadius.lamp_post)).toEqual({
      rx: 4.5 * TILE_W,
      ry: 4.5 * TILE_H,
    })
  })

  it('pools from the feet the sprite stands on — the one anchor law (D29)', () => {
    expect(
      poolCentre({ id: 'a', source: 'structure', x: 10, y: 10, w: 1, h: 1, radius: 4 }),
    ).toEqual(feetOf(10, 10))
    expect(
      poolCentre({ id: 'b', source: 'structure', x: 10, y: 10, w: 3, h: 1, radius: 3 }),
    ).toEqual(feetOf(10, 10, 3, 1))
  })
})

describe('a cell point lands on the art wherever the entity layer put the sprite', () => {
  const sprite = (texW: number) => ({
    x: 100,
    y: 200,
    anchor: { x: 0.5, y: 255 / 256 },
    scale: { x: 0.25, y: 0.25 },
    texture: { width: texW, height: texW },
  })

  it('maps the fire pit flame (130, 120) to 2 px right and 34 px up from the feet', () => {
    const at = cellPointOf(sprite(256) as never, { x: 130, y: 120 })
    expect(at).toEqual({ sx: 100 + (130 - 128) * 0.25, sy: 200 + (120 - 255) * 0.25 })
  })

  it('answers null until the art has landed — Texture.EMPTY is a pixel wide', () => {
    expect(cellPointOf(sprite(1) as never, { x: 130, y: 120 })).toBeNull()
  })

  it('follows the sprite: move the feet and the flame moves with them', () => {
    const a = cellPointOf(sprite(256) as never, { x: 100, y: 84 })!
    const b = cellPointOf({ ...sprite(256), y: 208 } as never, { x: 100, y: 84 })!
    expect(b.sy - a.sy).toBe(8)
  })
})

describe('what this pass must not have broken', () => {
  const src = readFileSync(new URL('./lightPools.ts', import.meta.url), 'utf8')
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')

  it('★ draws ABOVE the night grade, in the screen lights layer, and never into the bake (D1)', () => {
    expect(src).toContain('scene.screen.lights.addChild(root)')
    expect(code).not.toContain('layers.ground')
    expect(code).not.toMatch(/groundBake|rebake|chunk/i)
  })

  it("★ writes no zIndex and joins no sorted layer, so the painter's order is untouched", () => {
    expect(code).not.toMatch(/\.zIndex\s*=(?!=)/)
    expect(code).not.toContain('sortableChildren')
    expect(code).not.toContain('layers.entities')
  })

  it('★ culls: an offscreen light is not drawn, through the one function everything asks', () => {
    expect(src).toContain('rectInView(')
    expect(src).toContain('scene.viewRect()')
  })

  it('honours prefers-reduced-motion through the scene, the one owner of the question', () => {
    expect(src).toContain('const still = !scene.wantsMotion()')
    expect(src).toContain('still ? 0 : breath(')
  })

  it('never swallows a pointer: a decoration that takes a click is a picking bug', () => {
    expect(src).toContain("root.eventMode = 'none'")
    expect(src).toContain("s.eventMode = 'none'")
  })

  it('★ NO door glow: light comes only from a source the art shows lit (ruling 21)', () => {
    expect(code).not.toMatch(/door/i)
    expect(src).toContain('pts.flame')
    expect(src).toContain('pts.window')
  })

  it("★ pins BOTH the texture and the sprites against pixi's GC", () => {
    expect(src).toContain('bakeTexture(') // the one baker pins the source
    expect(src).toContain('s.autoGarbageCollect = false')
  })

  it('★ does not churn the pool on a clock boundary — that churn is what fed the GC', () => {
    expect(src).toContain(
      'const flames = flamesAt(state, tick, store.getConfig() ?? DEFAULT_CONFIG)',
    )
    expect(code).not.toMatch(/strength === 0 \? \[\]/)
    for (const m of code.match(/(\w+)\.destroy\(([^)]*)\)/g) ?? []) {
      if (/^(root|tex|fireTex)\.destroy/.test(m)) continue
      expect(m, `${m} could destroy the texture every sprite shares`).toContain('texture: false')
    }
  })
})

describe('the pool is priced by the world the store describes, not by the defaults', () => {
  const painted = (config: SimConfig | null): { width: number; height: number; tint: number } => {
    const children: { children: { width: number; height: number; tint: number }[] }[] = []
    const lights = { children, addChild: (c: (typeof children)[0]) => children.push(c) }
    const scene = {
      app: { renderer: { generateTexture: () => ({ source: {} }) } },
      screen: { lights },
      viewRect: () => ({ x: -1e4, y: -1e4, w: 2e4, h: 2e4 }),
      wantsMotion: () => true,
    } as unknown as Scene
    const store = {
      getState: () => lamp(10, 10, MIDNIGHT + 500),
      getTick: () => MIDNIGHT,
      getConfig: () => config,
      assetRecords: () => [],
      assetsSeq: () => 0,
    } as unknown as WorldStore
    createLightPools(scene, store).tick(16)
    return children[0]!.children[0]!
  }

  it('★ a law that widens a lamp’s glow widens the pool it paints', () => {
    const r = DEFAULT_CONFIG.light.glowRadius.lamp_post
    const wider: SimConfig = {
      ...DEFAULT_CONFIG,
      light: {
        ...DEFAULT_CONFIG.light,
        glowRadius: { ...DEFAULT_CONFIG.light.glowRadius, lamp_post: r + 3 },
      },
    }
    expect(painted(wider).width).toBeCloseTo(poolRadiusPx(r + 3).rx * 2)
    expect(painted(wider).height).toBeCloseTo(poolRadiusPx(r + 3).ry * 2)
  })

  it('falls back to the defaults for the frames before the snapshot lands', () => {
    const r = DEFAULT_CONFIG.light.glowRadius.lamp_post
    expect(painted(null).width).toBeCloseTo(poolRadiusPx(r).rx * 2)
  })

  it('tints the white radial with the warm token', () => {
    expect(painted(null).tint).toBe(POOL_COLOR)
  })
})

// ★ `assetRecords()` hands back ONE array it mutates in place, so its identity never changes:
// a building whose art landed after the first sync kept points read off a codex without it.
describe('★ art that lands after the first frame', () => {
  const LAMP_ART: AssetRecord = {
    id: 'asset_lamp',
    seq: 1,
    class: 'building',
    desc: 'lamp post',
    kind: 'lamp_post',
    footprint: { w: 1, h: 1 },
    widthPx: 64,
    heightPx: 64,
    status: 'ready',
    score: null,
    attempts: 1,
    costUsd: 0,
    createdAt: '2026-09-01 00:00:00',
    meta: JSON.stringify({
      version: 'v4-hires-building',
      kind: 'lamp_post',
      footprint: { w: 1, h: 1 },
      cell: { w: 64, h: 64, feetX: 32, feetY: 60 },
      points: { flame: { x: 32, y: 10 } },
    }),
  }

  it('★ re-reads the manifest points when the codex grows', () => {
    const children: { children: unknown[] }[] = []
    const scene = {
      app: { renderer: { generateTexture: () => ({ source: {} }) } },
      screen: { lights: { addChild: (c: (typeof children)[0]) => children.push(c) } },
      viewRect: () => ({ x: -1e4, y: -1e4, w: 2e4, h: 2e4 }),
      wantsMotion: () => true,
    } as unknown as Scene
    const state = {
      agents: {},
      items: {},
      structures: {
        lamp_1: {
          id: 'lamp_1',
          kind: 'lamp_post',
          x: 10,
          y: 10,
          w: 1,
          h: 1,
          stage: 'complete',
          fueledUntilTick: MIDNIGHT + 500,
        },
      },
    }
    const records: AssetRecord[] = []
    const store = {
      getState: () => state,
      getTick: () => MIDNIGHT,
      getConfig: () => DEFAULT_CONFIG,
      assetRecords: () => records,
      assetsSeq: () => records.length,
    } as unknown as WorldStore

    const pools = createLightPools(scene, store)
    pools.tick(16)
    expect(children[0]!.children, 'the pool alone: no art, so no painted flame').toHaveLength(1)

    records.push(LAMP_ART)
    pools.tick(16)
    expect(children[0]!.children, 'the flame the manifest points at').toHaveLength(2)
  })
})
