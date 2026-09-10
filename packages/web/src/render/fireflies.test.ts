import { describe, expect, it, vi } from 'vitest'

// Driven for real below, so the swarm is counted off the sprites it wrote to.
const built = vi.hoisted(() => ({ sprites: 0, graphics: 0 }))
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
    tint = 0xffffff
    eventMode = ''
    blendMode = ''
    autoGarbageCollect = true
    destroyed = false
    zIndex = 0
    sortableChildren = false
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
  class Sprite extends Container {
    constructor() {
      super()
      built.sprites++
    }
  }
  class Graphics extends Container {
    constructor() {
      super()
      built.graphics++
    }
    rect(): this {
      return this
    }
    fill(): this {
      return this
    }
  }
  return { Assets: {}, Container, Graphics, Point, Sprite, Texture: { EMPTY: {} } }
})
import type { TileId } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import type { ViewRect } from './cull.js'
import {
  FIREFLY_BLINK_HZ,
  FIREFLY_DUSK,
  FIREFLY_MAX,
  FIREFLY_MAX_ALPHA,
  createFireflies,
  fireflyBlink,
  fireflyDrift,
  fireflySeeds,
  fireflyStrength,
  isClearSky,
} from './fireflies.js'
import type { Scene } from './scene.js'
import { WEATHER_DIAG } from './tints.js'

const NIGHT = 0,
  NOON = 720,
  DUSK = 1140

const terrain = (rows: number[][]): TileId[][] => rows as TileId[][]

describe('★ fireflies come out on a clear night and on no other (task 18)', () => {
  // Clear is not a second list of weather words: it is exactly the weather the picture is not
  // graded for, so a kind added to `WEATHER_DIAG` cannot forget to put the swarm away.
  it('★ reads clear off the one grading table, never a list of its own', () => {
    expect(isClearSky('sunny')).toBe(true)
    for (const k of Object.keys(WEATHER_DIAG)) expect(isClearSky(k), k).toBe(false)
    const table = WEATHER_DIAG as Record<string, [number, number, number]>
    table.hail = [0.9, 0.9, 1]
    try {
      expect(isClearSky('hail'), 'a kind added to the grade puts the swarm away').toBe(false)
    } finally {
      delete table.hail
    }
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
  type Node = {
    visible: boolean
    alpha: number
    eventMode: string
    zIndex: number
    sortableChildren: boolean
    position: { x: number; y: number }
    children: Node[]
  }
  const MEADOW = terrain(Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => 0)))

  const rig = (o: { motion?: boolean; view?: ViewRect; weather?: string } = {}) => {
    const lights: Node[] = []
    const elsewhere = { ground: [] as Node[], entities: [] as Node[], grade: [] as Node[] }
    const box = (into: Node[]) => ({ addChild: (c: Node) => into.push(c) })
    const scene = {
      app: { renderer: { generateTexture: () => ({ source: {}, destroy: () => {} }) } },
      screen: { lights: box(lights), grade: box(elsewhere.grade) },
      layers: { ground: box(elsewhere.ground), entities: box(elsewhere.entities) },
      viewRect: () => o.view ?? { x: -1e4, y: -1e4, w: 2e4, h: 2e4 },
      wantsMotion: () => o.motion ?? true,
    } as unknown as Scene
    const store = {
      getState: () => ({ terrain: MEADOW, weather: { kind: o.weather ?? 'sunny' } }),
      getTick: () => NIGHT,
    } as unknown as WorldStore
    built.sprites = 0
    built.graphics = 0
    const swarm = createFireflies(scene, store)
    return { swarm, elsewhere, root: (): Node => lights[0]!, made: (): number => built.sprites }
  }

  // ★ POOLED, NEVER PER FRAME. The review just took the per-frame rebuilds out of this
  // renderer; a swarm that allocates ninety sprites a frame would put them straight back.
  it('★ builds its sprites once and only writes to them afterwards', () => {
    const r = rig()
    expect(r.made()).toBe(FIREFLY_MAX)
    const before = [...r.root().children]
    const bakes = built.graphics
    for (let i = 0; i < 60; i++) r.swarm.tick(16)
    expect(r.made(), 'a frame that allocates is a frame that stutters').toBe(FIREFLY_MAX)
    expect(built.graphics, 'and it bakes its one dot once').toBe(bakes)
    expect(r.root().children).toEqual(before)
  })

  it('★ lives in the lights layer, above the night multiply, and sorts nothing', () => {
    const r = rig()
    r.swarm.tick(16)
    expect(r.root().children).toHaveLength(FIREFLY_MAX)
    for (const [name, held] of Object.entries(r.elsewhere))
      expect(held, `${name} was handed a firefly`).toHaveLength(0)
    for (const n of [r.root(), ...r.root().children]) {
      expect(n.zIndex).toBe(0)
      expect(n.sortableChildren).toBe(false)
    }
  })

  it('★ culls: a firefly off the edge of the view is not drawn', () => {
    const near = rig()
    near.swarm.tick(16)
    expect(near.swarm.count()).toBeGreaterThan(0)

    const far = rig({ view: { x: 5e5, y: 5e5, w: 100, h: 100 } })
    far.swarm.tick(16)
    expect(far.swarm.count()).toBe(0)
    for (const s of far.root().children) expect(s.visible).toBe(false)
  })

  it('honours prefers-reduced-motion through the scene, the one owner of the question', () => {
    const held = (r: ReturnType<typeof rig>): string[] => {
      const seen: string[] = []
      for (let i = 0; i < 30; i++) {
        r.swarm.tick(100)
        const s = r.root().children[0]!
        seen.push(`${s.position.x},${s.position.y},${s.alpha}`)
      }
      return [...new Set(seen)]
    }
    expect(held(rig({ motion: false })), 'stillness is one frame, forever').toHaveLength(1)
    expect(held(rig({ motion: true })).length).toBeGreaterThan(1)
  })

  it('never swallows a pointer', () => {
    const r = rig()
    r.swarm.tick(16)
    for (const n of [r.root(), ...r.root().children]) expect(n.eventMode).toBe('none')
  })
})
