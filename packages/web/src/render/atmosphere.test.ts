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
    mask: unknown = null
    filters: unknown[] = []
    eventMode = ''
    blendMode = ''
    autoGarbageCollect = true
    position = new Point()
    scale = new Point()
    addChild(...cs: Container[]): void {
      this.children.push(...cs)
    }
    destroy(): void {}
  }
  class Sprite extends Container {}
  class Graphics extends Container {
    rect(): this {
      return this
    }
    poly(): this {
      return this
    }
    fill(): this {
      return this
    }
    clear(): this {
      return this
    }
  }
  class ColorMatrixFilter {
    matrix: number[] = []
  }
  return { ColorMatrixFilter, Container, Graphics, Point, Sprite, Texture: { WHITE: {} } }
})
import type { WorldState } from '@sj/engine/state'
import type { Scene } from './scene.js'
import { SKY_MAX_ALPHA, createAtmosphere, skyAlpha } from './atmosphere.js'
import { clockTint } from './tints.js'

describe('the sky gradient (U4)', () => {
  it('peaks at dawn and dusk and sits at a third of that at noon and midnight', () => {
    expect(skyAlpha(0.5)).toBeCloseTo(SKY_MAX_ALPHA, 6)
    expect(skyAlpha(0)).toBeCloseTo(SKY_MAX_ALPHA * 0.35, 6)
    expect(skyAlpha(1)).toBeCloseTo(SKY_MAX_ALPHA * 0.35, 6)
    for (let s = 0; s <= 1; s += 0.01) expect(skyAlpha(s)).toBeLessThanOrEqual(SKY_MAX_ALPHA)
  })
})

type Node = {
  children: Node[]
  tint: number
  alpha: number
  blendMode: string
  mask: unknown
  filters: unknown[]
}
const drive = (): {
  atm: ReturnType<typeof createAtmosphere>
  night: Node
  lights: Node
  graded: Node
  state: (tick: number, weather: string) => WorldState
} => {
  const node = (): Node => ({
    children: [],
    tint: 0,
    alpha: 1,
    blendMode: '',
    mask: null,
    filters: [],
  })
  const night = node(),
    lights = node(),
    graded = node()
  const add =
    (n: Node) =>
    (...cs: Node[]) =>
      n.children.push(...cs)
  const scene = {
    app: {
      renderer: { generateTexture: () => ({ source: {} }) },
      screen: { width: 800, height: 600 },
      ticker: { lastTime: 0 },
    },
    screen: {
      night: { ...night, addChild: add(night) },
      lights: { ...lights, addChild: add(lights) },
    },
    graded,
  } as unknown as Scene
  const terrain = [
    [0, 0],
    [0, 0],
  ]
  const state = (tick: number, weather: string): WorldState =>
    ({ tick, terrain, weather: { kind: weather } }) as unknown as WorldState
  return { atm: createAtmosphere(scene), night, lights, graded, state }
}

describe('where the atmosphere draws (D1, D5, D27)', () => {
  it('puts the night quad in the `night` screen layer and the sky in `lights`, screened', () => {
    const { night, lights } = drive()
    expect(night.children).toHaveLength(1)
    expect(night.children[0]!.blendMode).toBe('multiply')
    const sky = lights.children.find((c) => c.blendMode === 'screen')
    expect(sky).toBeDefined()
    expect(sky!.mask).not.toBeNull() // masked to the ground's outline — no hard edge on the void
  })

  it('★ grades `scene.graded` and never the world: speech stays out of the weather', () => {
    const { atm, graded, state } = drive()
    atm.update(state(720, 'storm'))
    expect(graded.filters).toHaveLength(1)
    atm.update(state(720, 'sunny'))
    expect(graded.filters).toHaveLength(0)
    const src = readFileSync(new URL('./atmosphere.ts', import.meta.url), 'utf8')
    expect(src).not.toContain('scene.world.filters')
    expect(src).not.toContain('ticker.add') // the tint is computed once a frame, by `update`
  })

  it('tints the quad from the clock and the sky from the quad', () => {
    const { atm, night, lights, state } = drive()
    atm.update(state(240, 'sunny'))
    const quad = night.children[0]!
    expect(quad.tint).toBe(clockTint(240))
    const sky = lights.children.find((c) => c.blendMode === 'screen')!
    expect(sky.tint).toBe(quad.tint)
    expect(sky.alpha).toBeCloseTo(skyAlpha(0), 6)
  })
})
