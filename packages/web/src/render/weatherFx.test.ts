import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

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
    texture: unknown = null
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
    rect(): this {
      return this
    }
    ellipse(): this {
      return this
    }
    moveTo(): this {
      return this
    }
    lineTo(): this {
      return this
    }
    stroke(): this {
      return this
    }
    fill(): this {
      return this
    }
  }
  return { Container, Graphics, Point, Sprite, Texture: { WHITE: {} } }
})
import type { WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from './scene.js'
import {
  BANDS,
  FLASH_MS,
  FLASH_PEAK_ALPHA,
  PARTICLES,
  SPLASH_COUNT,
  createWeatherLayer,
  flashAlpha,
  particleCount,
} from './weatherFx.js'

describe('particle count is a density (D16)', () => {
  it('scales with the stage area, so a 4K stage is as wet as a laptop', () => {
    const small = particleCount('rain', 1440, 900, false)
    const big = particleCount('rain', 3840, 2160, false)
    expect(big / small).toBeCloseTo((3840 * 2160) / (1440 * 900), 1)
  })

  it('reproduces the shipped 220 / 140 / 320 on the 1440×900 stage they were tuned for', () => {
    expect(particleCount('rain', 1440, 900, false)).toBe(220)
    expect(particleCount('snow', 1440, 900, false)).toBe(140)
    expect(particleCount('storm', 1440, 900, false)).toBe(320)
  })

  it('halves under prefers-reduced-motion', () => {
    expect(particleCount('storm', 1440, 900, true)).toBe(160)
  })
})

describe('three parallax bands', () => {
  it('go far → near in scale, alpha and speed together', () => {
    expect(BANDS).toHaveLength(3)
    for (let i = 1; i < BANDS.length; i++) {
      expect(BANDS[i]!.scale).toBeGreaterThan(BANDS[i - 1]!.scale)
      expect(BANDS[i]!.alpha).toBeGreaterThan(BANDS[i - 1]!.alpha)
      expect(BANDS[i]!.speed).toBeGreaterThan(BANDS[i - 1]!.speed)
    }
  })
})

describe('the lightning ramp (D8)', () => {
  it('is 0 at both ends, peaks at 0.45, and never exceeds it', () => {
    expect(flashAlpha(0)).toBe(0)
    expect(flashAlpha(FLASH_MS)).toBe(0)
    let peak = 0
    for (let ms = 0; ms < FLASH_MS; ms++) peak = Math.max(peak, flashAlpha(ms))
    expect(peak).toBeCloseTo(FLASH_PEAK_ALPHA, 2)
    expect(FLASH_PEAK_ALPHA).toBeLessThan(0.6)
  })

  it('has a second, fainter strike after the first has died', () => {
    const first = flashAlpha(65)
    const trough = flashAlpha(130)
    const second = flashAlpha(160)
    expect(first).toBeGreaterThan(second)
    expect(second).toBeGreaterThan(trough)
  })
})

const drive = (
  still: boolean,
  wide = 1440,
): {
  layer: ReturnType<typeof createWeatherLayer>
  drops: Kid[]
  flashKids: Kid[]
  ground: Kid[]
} => {
  const drops: Kid[] = []
  const flashKids: Kid[] = []
  const ground: Kid[] = []
  const scene = {
    app: {
      renderer: { generateTexture: () => ({ source: {} }) },
      screen: { width: wide, height: 900 },
    },
    screen: {
      weather: { addChild: (...c: Kid[]) => drops.push(...c) },
      flash: { addChild: (...c: Kid[]) => flashKids.push(...c) },
    },
    layers: { groundDecal: { addChild: (...c: Kid[]) => ground.push(...c) } },
    wantsMotion: () => !still,
    viewRect: () => ({ x: 0, y: 0, w: 320, h: 160 }),
  } as unknown as Scene
  const terrain = Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => 0))
  const store = { getState: () => ({ terrain }) as unknown as WorldState } as unknown as WorldStore
  return { layer: createWeatherLayer(scene, store), drops, flashKids, ground }
}
type Kid = {
  destroyed: boolean
  visible: boolean
  alpha: number
  position: { x: number; y: number }
  children?: Kid[]
}
const alive = (k: Kid[]): Kid[] => k.filter((c) => !c.destroyed)

describe('the live layer', () => {
  it('pools its drops: a kind change re-dresses the sprites rather than rebuilding them', () => {
    const { layer, drops } = drive(false)
    layer.setKind('rain')
    const made = drops.length
    expect(made).toBe(particleCount('rain', 1440, 900, false))
    layer.setKind('storm')
    // storm wants more: the rain sprites are kept and the difference is added
    expect(alive(drops)).toHaveLength(particleCount('storm', 1440, 900, false))
    expect(drops.length).toBe(particleCount('storm', 1440, 900, false))
    layer.setKind('snow')
    expect(alive(drops)).toHaveLength(particleCount('snow', 1440, 900, false))
  })

  it('keeps every drop on the integer pixel grid, before and after it moves', () => {
    const { layer, drops } = drive(false)
    layer.setKind('rain')
    for (let i = 0; i < 10; i++) layer.tick(16.7)
    for (const d of alive(drops)) {
      expect(Number.isInteger(d.position.x)).toBe(true)
      expect(Number.isInteger(d.position.y)).toBe(true)
    }
  })

  it('lands splashes on the ground decal layer in world space, forty of them', () => {
    const { layer, ground } = drive(false)
    layer.setKind('rain')
    expect(ground[0]!.children).toHaveLength(SPLASH_COUNT)
    layer.setKind('snow')
    expect(alive(ground[0]!.children!)).toHaveLength(0)
  })

  it('★ under prefers-reduced-motion: half the drops, none of them moving, no splash, no flash', () => {
    const { layer, drops, flashKids, ground } = drive(true)
    layer.setKind('storm')
    expect(alive(drops)).toHaveLength(particleCount('storm', 1440, 900, true))
    const before = alive(drops).map((d) => [d.position.x, d.position.y])
    for (let i = 0; i < 20; i++) layer.tick(500)
    expect(alive(drops).map((d) => [d.position.x, d.position.y])).toEqual(before)
    expect(ground[0]!.children).toHaveLength(0)
    expect(flashKids[0]!.visible).toBe(false)
  })

  it('puts the flash in the `flash` screen layer — under the night quad — and blends it additively', () => {
    const src = readFileSync(new URL('./weatherFx.ts', import.meta.url), 'utf8')
    expect(src).toContain('scene.screen.flash.addChild(flash)')
    expect(src).toContain("flash.blendMode = 'add'")
    expect(src).not.toContain('app.stage.addChild')
  })

  it('keeps the shipped fall speeds and colours', () => {
    expect(PARTICLES.rain.vy).toBe(380)
    expect(PARTICLES.storm.color).toBe(0x5a8cab)
  })
})
