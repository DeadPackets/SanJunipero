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
    zIndex = 0
    sortableChildren = false
    destroyOpts: unknown = undefined
    position = new Point()
    scale = new Point()
    anchor = new Point()
    addChild(...cs: Container[]): void {
      this.children.push(...cs)
    }
    destroy(opts?: unknown): void {
      this.destroyed = true
      this.destroyOpts = opts
    }
  }
  class Sprite extends Container {
    texture: { destroyed?: boolean }
    constructor(texture?: { destroyed?: boolean }) {
      super()
      this.texture = texture ?? Texture.EMPTY
    }
    // pixi frees the shared texture on `destroy(true)` and on `{ texture: true }`
    destroy(opts?: { texture?: boolean } | boolean): void {
      super.destroy(opts)
      if (opts === true || (typeof opts === 'object' && opts.texture === true))
        this.texture.destroyed = true
    }
  }
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
const held = vi.hoisted((): { sprite: unknown } => ({ sprite: null }))
vi.mock('./entities.js', () => ({ entitySpriteOf: () => held.sprite }))
import {
  DEFAULT_CONFIG,
  flamesAt,
  isDark,
  type AssetRecord,
  type BuildingPoints,
  type LitWorld,
  type SimConfig,
} from '@sj/shared'
import { CLOCK_STOPS, skyLevel } from './tints.js'
import { TILE_H, TILE_W, feetOf } from './iso.js'
import { phaseOf } from './charAnim.js'
import type { ViewRect } from './cull.js'
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
  windowSpot,
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
        id: 'lamp_1',
        kind: 'lamp_post',
        x,
        y,
        w: 1,
        h: 1,
        stage: 'complete',
        ...(fueledUntilTick === undefined ? {} : { fueledUntilTick }),
      } as LitWorld['structures'][string],
    },
  })

type Drawn = {
  visible: boolean
  alpha: number
  width: number
  height: number
  tint: number
  eventMode: string
  zIndex: number
  sortableChildren: boolean
  autoGarbageCollect: boolean
  destroyed: boolean
  destroyOpts: { texture?: boolean } | undefined
  position: { x: number; y: number }
  children: Drawn[]
}
type Box = { children: Drawn[]; addChild: (c: Drawn) => void }
type Baked = { source: { autoGarbageCollect?: boolean }; destroyed: boolean; destroy(): void }

const box = (): Box => {
  const children: Drawn[] = []
  return { children, addChild: (c) => children.push(c) }
}

const art = (kind: string, cell: number, points: BuildingPoints): AssetRecord => ({
  id: `asset_${kind}`,
  seq: 1,
  class: 'building',
  desc: kind,
  kind,
  footprint: { w: 1, h: 1 },
  widthPx: cell,
  heightPx: cell,
  status: 'ready',
  score: null,
  attempts: 1,
  costUsd: 0,
  createdAt: '2026-09-01 00:00:00',
  meta: JSON.stringify({
    version: 'v4-hires-building',
    kind,
    footprint: { w: 1, h: 1 },
    cell: { w: cell, h: cell, feetX: cell / 2, feetY: cell - 4 },
    points,
  }),
})

/** The sprite the entity layer placed, which is where a cell point is measured from. */
const SPRITE = {
  x: 400,
  y: 300,
  anchor: { x: 0.5, y: 1 },
  scale: { x: 1, y: 1 },
  texture: { width: 512, height: 512 },
}

const rig = (
  o: {
    state?: LitWorld
    tick?: number
    motion?: boolean
    view?: ViewRect
    records?: AssetRecord[]
    entity?: unknown
  } = {},
) => {
  const state = o.state ?? lamp(10, 10, MIDNIGHT + 500)
  const records = o.records ?? []
  const lights = box()
  const elsewhere = {
    ground: box(),
    entities: box(),
    world: box(),
    grade: box(),
    flash: box(),
  }
  const baked: Baked[] = []
  const scene = {
    app: {
      renderer: {
        generateTexture: () => {
          const t: Baked = {
            source: {},
            destroyed: false,
            destroy(): void {
              this.destroyed = true
            },
          }
          baked.push(t)
          return t
        },
      },
    },
    screen: { lights, grade: elsewhere.grade, flash: elsewhere.flash },
    layers: { ground: elsewhere.ground, entities: elsewhere.entities, world: elsewhere.world },
    viewRect: () => o.view ?? { x: -1e4, y: -1e4, w: 2e4, h: 2e4 },
    wantsMotion: () => o.motion ?? true,
  } as unknown as Scene
  let tick = o.tick ?? MIDNIGHT
  const store = {
    getState: () => state,
    getTick: () => tick,
    getConfig: () => DEFAULT_CONFIG,
    assetRecords: () => records,
    assetsSeq: () => records.length,
    onEvents: () => () => {},
  } as unknown as WorldStore
  held.sprite = o.entity ?? null
  const pools = createLightPools(scene, store)
  return {
    baked,
    elsewhere,
    tick: (dtMs: number): void => {
      held.sprite = o.entity ?? null
      pools.tick(dtMs)
    },
    count: (): number => pools.count(),
    lit: (): Drawn[] => lights.children,
    root: (): Drawn => lights.children[0]!,
    drawn: (): Drawn[] => lights.children[0]!.children,
    at: (t: number): void => void (tick = t),
  }
}

const walk = (n: Drawn): Drawn[] => [n, ...n.children.flatMap(walk)]

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

  it('never reaches the photosensitive band, measured off the wave itself', () => {
    // Every tone in the wave, read by fitting a sine at each frequency over ten whole seconds.
    const SPAN = 10,
      STEPS = 4000
    const toneAt = (hz: number): number => {
      let re = 0,
        im = 0
      for (let i = 0; i < STEPS; i++) {
        const t = (i * SPAN) / STEPS
        const v = breath(0, t)
        re += v * Math.cos(2 * Math.PI * hz * t)
        im += v * Math.sin(2 * Math.PI * hz * t)
      }
      return (2 * Math.hypot(re, im)) / STEPS
    }
    const tones: number[] = []
    for (let hz = 0.5, prev = 0, cur = toneAt(0.5); hz <= 20; hz += 0.05) {
      const next = toneAt(hz + 0.05)
      if (cur > 0.02 && cur >= prev && cur >= next) tones.push(Number(hz.toFixed(2)))
      prev = cur
      cur = next
    }
    expect(tones).toEqual([1.7, 2.9])
    expect(Math.max(...tones), 'the photosensitive band starts at 3 Hz').toBeLessThan(3)
  })

  it('keeps every light under its ceiling with the breath on top', () => {
    // The pool breathes about its ceiling and is clamped to it, so it only ever dips.
    const r = rig()
    let peak = 0
    for (let i = 0; i < 3000; i++) {
      r.tick(7)
      peak = Math.max(peak, r.drawn()[0]!.alpha)
    }
    expect(peak).toBeLessThanOrEqual(POOL_MAX_ALPHA)
    expect(peak, 'not vacuous: it does breathe up to the ceiling').toBeGreaterThan(
      POOL_MAX_ALPHA * 0.99,
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
    // Not vacuous: cream still turns cold under the same multiply. Honey used to be the foil
    // here and the raised night floor now keeps it warm — which is the point of raising it.
    const [cr, , cb] = after(0xfff6e9)
    expect(cr - cb).toBeLessThan(0)
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

describe('★ a lit hearth is seen through a window (task 18)', () => {
  const points = (window?: { x: number; y: number }, flame?: { x: number; y: number }) => ({
    ...(window === undefined ? {} : { window }),
    ...(flame === undefined ? {} : { flame }),
  })

  // Only the cabin's art ever named a window; cottage, farmhouse and house went dark with a
  // fire burning in them. A hearth the art does not PAINT is a fire indoors, and a fire
  // indoors reaches the town through the wall.
  it('★ falls back to the front face for a hearth house whose art names no window', () => {
    const at = windowSpot(points(), 512, 512)
    expect(at).toEqual({ x: 256, y: 370 })
  })

  it('★ keeps the art’s own window wherever the art names one', () => {
    expect(windowSpot(points({ x: 130, y: 370 }), 512, 512)).toEqual({ x: 130, y: 370 })
  })

  // A fire pit and a lamp post paint their flame: the light is already on screen and a window
  // on an open fire would be a second, invented source.
  it('★ gives no window to a source whose flame the art paints', () => {
    expect(windowSpot(points(undefined, { x: 130, y: 167 }), 256, 256)).toBeNull()
  })

  it('★ scales with the painted cell, so a farmhouse is lit at its own height', () => {
    expect(windowSpot(points(), 768, 768)).toEqual({ x: 384, y: 555 })
  })

  it('answers null before the art has landed', () => {
    expect(windowSpot(null, 512, 512)).toBeNull()
    expect(windowSpot(points(), 1, 1)).toBeNull()
  })

  // ★ THE GATE IS THE FLAME LIST ITSELF: `flamesAt` drops a structure whose `fueledUntilTick`
  // has passed, so an unlit hearth reaches no light at all and no glow can be placed for it.
  it('★ no flame, no glow: an unfueled hearth is not in the list the glow is drawn from', () => {
    const lit: LitWorld = {
      agents: {},
      items: {},
      structures: {
        h: {
          id: 'h',
          kind: 'house',
          x: 4,
          y: 4,
          w: 2,
          h: 2,
          stage: 'complete',
          fueledUntilTick: 700,
        },
      },
    } as unknown as LitWorld
    const cold = JSON.parse(JSON.stringify(lit)) as LitWorld
    ;(cold.structures.h as { fueledUntilTick?: number }).fueledUntilTick = 100
    expect(flamesAt(lit, 600, DEFAULT_CONFIG).map((f) => f.id)).toEqual(['h'])
    expect(flamesAt(cold, 600, DEFAULT_CONFIG)).toEqual([])
  })
})

describe('what this pass must not have broken', () => {
  const HEARTH: LitWorld = world({
    structures: {
      house_1: {
        id: 'house_1',
        kind: 'house',
        x: 4,
        y: 4,
        w: 2,
        h: 2,
        stage: 'complete',
        fueledUntilTick: MIDNIGHT + 500,
      } as LitWorld['structures'][string],
    },
  })
  const LAMP_LIT = { records: [art('lamp_post', 64, { flame: { x: 32, y: 10 } })], entity: SPRITE }

  it('★ draws ABOVE the night grade, in the screen lights layer, and never into the bake (D1)', () => {
    const r = rig(LAMP_LIT)
    r.tick(16)
    expect(r.lit()).toHaveLength(1)
    expect(r.drawn().length).toBeGreaterThan(0)
    for (const [name, b] of Object.entries(r.elsewhere))
      expect(b.children, `${name} was handed a light`).toHaveLength(0)
  })

  it("★ writes no zIndex and joins no sorted layer, so the painter's order is untouched", () => {
    const r = rig(LAMP_LIT)
    r.tick(16)
    for (const n of walk(r.root())) {
      expect(n.zIndex).toBe(0)
      expect(n.sortableChildren).toBe(false)
    }
    expect(r.elsewhere.entities.children).toHaveLength(0)
  })

  it('★ culls: an offscreen light is not drawn, through the one function everything asks', () => {
    const near = rig()
    near.tick(16)
    expect(near.count()).toBe(1)
    expect(near.drawn()[0]!.visible).toBe(true)

    const far = rig({ view: { x: 5e5, y: 5e5, w: 100, h: 100 } })
    far.tick(16)
    expect(far.count()).toBe(0)
    expect(far.drawn()[0]!.visible).toBe(false)
  })

  it('honours prefers-reduced-motion through the scene, the one owner of the question', () => {
    const alphas = new Set<number>()
    const still = rig({ motion: false })
    for (let i = 0; i < 40; i++) {
      still.tick(100)
      alphas.add(still.drawn()[0]!.alpha)
    }
    expect(alphas.size, 'a viewer who asked for stillness gets one alpha, forever').toBe(1)

    const breathing = new Set<number>()
    const moving = rig({ motion: true })
    for (let i = 0; i < 40; i++) {
      moving.tick(100)
      breathing.add(moving.drawn()[0]!.alpha)
    }
    expect(breathing.size).toBeGreaterThan(1)
  })

  it('never swallows a pointer: a decoration that takes a click is a picking bug', () => {
    const r = rig(LAMP_LIT)
    r.tick(16)
    const nodes = walk(r.root())
    expect(nodes.length).toBeGreaterThan(2)
    for (const n of nodes) expect(n.eventMode).toBe('none')
  })

  it('★ NO door glow: light comes only from a source the art shows lit (ruling 21)', () => {
    const post = rig(LAMP_LIT)
    post.tick(16)
    expect(
      post.drawn(),
      'the pool and the bloom over the painted flame, and nothing else',
    ).toHaveLength(2)

    const house = rig({
      state: HEARTH,
      records: [art('house', 512, { window: { x: 130, y: 370 } })],
      entity: SPRITE,
    })
    house.tick(16)
    expect(house.drawn(), 'the pool and the window, and no light at the door').toHaveLength(2)
    const at = cellPointOf(SPRITE as never, { x: 130, y: 370 })!
    const glow = house.drawn()[1]!
    expect([glow.position.x, glow.position.y]).toEqual([at.sx, at.sy])
    expect(glow.position.y, 'the window is up the wall, not down at the threshold').toBeLessThan(
      SPRITE.y,
    )
  })

  it("★ pins BOTH the texture and the sprites against pixi's GC", () => {
    const r = rig(LAMP_LIT)
    r.tick(16)
    expect(r.baked.length).toBeGreaterThan(0)
    for (const t of r.baked) expect(t.source.autoGarbageCollect).toBe(false)
    for (const s of r.drawn()) expect(s.autoGarbageCollect).toBe(false)
  })

  it('★ does not churn the pool on a clock boundary — that churn is what fed the GC', () => {
    const r = rig({ state: lamp(10, 10, 10_000) })
    r.tick(16)
    const pool = r.drawn()[0]!
    expect(r.count()).toBe(1)

    r.at(NOON)
    r.tick(16)
    expect(r.count(), 'nothing is painted by day').toBe(0)
    expect(r.drawn()[0], 'and nothing was thrown away either').toBe(pool)
    expect(pool.destroyed).toBe(false)
    expect(r.baked[0]!.destroyed).toBe(false)

    r.at(MIDNIGHT)
    r.tick(16)
    expect(r.drawn()[0], 'the same sprite lights again at dusk').toBe(pool)
    expect(r.count()).toBe(1)
  })

  it('★ a light that leaves the world takes its sprite, never the texture every light shares', () => {
    const r = rig()
    r.tick(16)
    const pool = r.drawn()[0]!

    r.at(MIDNIGHT + 600) // the lamp is fueled to +500, so this one is out
    r.tick(16)
    expect(pool.destroyed).toBe(true)
    expect(pool.destroyOpts).toMatchObject({ texture: false })
    expect(r.baked[0]!.destroyed, 'the disc every other light draws with').toBe(false)
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
      onEvents: () => () => {},
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
      onEvents: () => () => {},
    } as unknown as WorldStore

    const pools = createLightPools(scene, store)
    pools.tick(16)
    expect(children[0]!.children, 'the pool alone: no art, so no painted flame').toHaveLength(1)

    records.push(LAMP_ART)
    pools.tick(16)
    expect(children[0]!.children, 'the flame the manifest points at').toHaveLength(2)
  })
})
