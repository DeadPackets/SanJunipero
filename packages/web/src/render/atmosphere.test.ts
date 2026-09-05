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
    static writes = 0
    #m: number[] = []
    get matrix(): number[] {
      return this.#m
    }
    set matrix(v: number[]) {
      ColorMatrixFilter.writes++
      this.#m = v
    }
  }
  return { ColorMatrixFilter, Container, Graphics, Point, Sprite, Texture: { WHITE: {} } }
})
import type { WorldState } from '@sj/engine/state'
import type { Scene } from './scene.js'
import {
  MOON_COLOR,
  MOON_MAX_ALPHA,
  SKY_MAX_ALPHA,
  createAtmosphere,
  skyAlpha,
} from './atmosphere.js'
import { moonAltitude } from '../ui/skyModel.js'
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

  // ★ `update` runs once a frame. The matrix is a pure function of the weather kind, and
  // assigning it dirties the filter's uniform group — an 80-byte re-upload at 60 fps.
  it('★ writes the grading matrix when the weather changes, not on every frame', async () => {
    const { ColorMatrixFilter } = (await import('pixi.js')) as unknown as {
      ColorMatrixFilter: { writes: number }
    }
    const { atm, state } = drive()
    atm.update(state(720, 'rain'))
    const written = ColorMatrixFilter.writes
    for (let i = 1; i <= 30; i++) atm.update(state(720 + i, 'rain'))
    expect(ColorMatrixFilter.writes, 'a frame of rain is not new weather').toBe(written)

    atm.update(state(760, 'storm'))
    expect(ColorMatrixFilter.writes).toBe(written + 1)
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

// ── ★ THE MOON ON THE ARC LIGHTS THE ROOFS UNDER IT (task 18) ────────────────────────────

describe('★ the moon', () => {
  const moonOf = (lights: Node): Node =>
    lights.children.filter((c) => c.blendMode === 'screen').at(-1)!

  it('★ is a second screened ramp in `lights`, over the same masked ground', () => {
    const { lights } = drive()
    const screened = lights.children.filter((c) => c.blendMode === 'screen')
    expect(screened).toHaveLength(2)
    expect(moonOf(lights).mask).not.toBeNull()
    expect(moonOf(lights).tint).toBe(MOON_COLOR)
  })

  it('★ is dark all day and rides its own altitude at night', () => {
    const { atm, lights, state } = drive()
    atm.update(state(720, 'sunny'))
    expect(moonOf(lights).alpha).toBe(0)
    atm.update(state(60, 'sunny'))
    expect(moonOf(lights).alpha).toBeCloseTo(MOON_MAX_ALPHA * moonAltitude(60), 6)
    expect(moonOf(lights).alpha).toBeGreaterThan(0)
  })

  it('★ is cool where every other light in the town is warm, and stays under its ceiling', () => {
    expect((MOON_COLOR >> 16) & 0xff).toBeLessThan(MOON_COLOR & 0xff)
    const { atm, lights, state } = drive()
    for (let m = 0; m < 1440; m += 7) {
      atm.update(state(m, 'sunny'))
      expect(moonOf(lights).alpha, `minute ${m}`).toBeLessThanOrEqual(MOON_MAX_ALPHA)
    }
    expect(MOON_MAX_ALPHA).toBeLessThanOrEqual(0.2)
  })
})
