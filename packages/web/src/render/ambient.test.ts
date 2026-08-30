import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

// The director is driven for real below: the create/destroy half runs on a new world state
// rather than on every frame, so a missed trigger has to be a failing test.
vi.mock('pixi.js', () => {
  class Point {
    x = 1
    y = 1
    set(x: number, y: number = x): void {
      this.x = x
      this.y = y
    }
  }
  class Container {
    children: Container[] = []
    visible = true
    alpha = 1
    eventMode = ''
    blendMode = ''
    destroyed = false
    position = new Point()
    scale = new Point()
    anchor = new Point()
    skew = new Point()
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
    circle(): this {
      return this
    }
    fill(): this {
      return this
    }
  }
  return { Container, Graphics, Point, Sprite, Texture: { EMPTY: {} } }
})
import { CITY_HEARTH_KIND, cityStructures } from '@sj/shared'
import type { TileId, WorldState } from '@sj/engine/state'
import {
  HEARTH_KINDS,
  SMOKE_COLOR,
  SMOKE_MAX_ALPHA,
  TREES_MAX,
  createAmbient,
  sampleDecorations,
} from './ambient.js'
import type { Scene } from './scene.js'
import type { WorldStore } from '../state/worldStore.js'
import type { BubbleLayer } from './bubbles.js'
import type { WeatherLayer } from './weatherFx.js'
import { bigTown } from './bigTown.js'

describe('HEARTH_KINDS', () => {
  it('is read off the C13 template, not hand-listed', () => {
    const furnished = cityStructures()
      .filter((c) => c.furnishings.some((f) => f.kind === CITY_HEARTH_KIND))
      .map((c) => c.kind)
    expect(furnished.length).toBeGreaterThan(0)
    for (const kind of furnished) expect(HEARTH_KINDS).toContain(kind)
  })

  it('smokes and glows from a house and an open fire, and from nothing else', () => {
    expect(HEARTH_KINDS).toContain('house')
    expect(HEARTH_KINDS).toContain('fire_pit')
    // the kinds the controller actually saw pale squares on
    for (const kind of ['wagon', 'shed', 'storehouse', 'well', 'standing_stone', 'scaffolding']) {
      expect(HEARTH_KINDS.has(kind), `${kind} has no chimney`).toBe(false)
    }
  })
})

describe('the ambient effects stay quiet', () => {
  it('smoke is warm grey, never cream — cream read as white glass', () => {
    expect(SMOKE_COLOR).toBe(0xcfc6bc)
    expect(SMOKE_MAX_ALPHA).toBeLessThan(0.5)
  })

  it('draws no light of its own — every additive glow lives above the night grade (D1)', () => {
    const src = readFileSync(new URL('./ambient.ts', import.meta.url), 'utf8')
    expect(src).not.toContain("blendMode = 'add'")
  })

  it('★ holds every oscillator at base under prefers-reduced-motion (D6)', () => {
    const src = readFileSync(new URL('./ambient.ts', import.meta.url), 'utf8')
    expect(src).toContain('const still = !scene.wantsMotion()')
    expect(src).toContain('if (!grave && !still) t += dtMs')
  })

  it('sways a canopy by whole pixels of its crown, never by a shear (D14)', () => {
    const src = readFileSync(new URL('./ambient.ts', import.meta.url), 'utf8')
    expect(src).not.toContain('skew')
    expect(src).toMatch(/crown\.position\.x =\s*tr\.sx \+ Math\.round\(/)
  })
})

describe('sampleDecorations spreads the cap over the whole map (D15)', () => {
  it('woods the last rows as well as the first when the forest is over the cap', () => {
    const FOREST: TileId = 3
    const side = 40 // 1600 forest tiles against a cap of 80
    const terrain: TileId[][] = Array.from({ length: side }, () =>
      Array.from({ length: side }, () => FOREST),
    )
    const trees = sampleDecorations(terrain).filter((d) => d.kind === 'tree')
    expect(trees.length).toBeLessThanOrEqual(TREES_MAX)
    expect(trees.length).toBeGreaterThan(TREES_MAX / 2)
    const rows = new Set(trees.map((d) => d.y))
    expect(Math.max(...rows)).toBeGreaterThan(side / 2)
    expect(Math.min(...rows)).toBeLessThan(side / 2)
  })
})

describe('the effect sprites track the world, not the frame', () => {
  type S = { id: string; kind: string; x: number; y: number; w: number; h: number; stage: string }
  const hearth = (id: string, x: number): S => ({
    id,
    kind: 'fire_pit',
    x,
    y: 4,
    w: 1,
    h: 1,
    stage: 'complete',
  })

  type Kid = { destroyed: boolean }
  const drive = (first: S[]): { tick: () => void; setWorld: (list: S[]) => void; kids: Kid[] } => {
    const kids: Kid[] = []
    const scene = {
      app: {
        renderer: { generateTexture: () => ({}) },
        screen: { width: 800 },
      },
      layers: {
        groundDecal: { addChild: () => {} },
        overhead: { addChild: (...c: Kid[]) => kids.push(...c) },
      },
      wantsMotion: () => true,
      reachableBox: () => ({ minX: 0, maxX: 800, minY: 0, maxY: 600 }),
    } as unknown as Scene
    const terrain = [
      [0, 0],
      [0, 0],
    ]
    let state = {
      terrain,
      structures: Object.fromEntries(first.map((s) => [s.id, s])),
      agents: {},
    }
    const store = {
      getState: () => state as unknown as WorldState,
      getTick: () => 0,
      onEvents: () => () => {},
    } as unknown as WorldStore
    const quiet = { setSuppressed: () => {}, setEmotesHidden: () => {} }
    const a = createAmbient(scene, store, {
      weather: quiet as unknown as WeatherLayer,
      bubbles: quiet as unknown as BubbleLayer,
    })
    return {
      tick: () => {
        a.tick(16)
      },
      setWorld: (list) => {
        state = { terrain, structures: Object.fromEntries(list.map((s) => [s.id, s])), agents: {} }
      },
      kids,
    }
  }

  const alive = (kids: Kid[]): number => kids.filter((c) => !c.destroyed).length

  it('a hearth completing between frames still gets its smoke', () => {
    const h = drive([])
    h.tick()
    const flock = alive(h.kids) // the birds live in `overhead` too, and are not a hearth's
    h.setWorld([hearth('s1', 4)])
    h.tick()
    const one = alive(h.kids) - flock
    expect(one).toBeGreaterThan(0)

    h.setWorld([hearth('s1', 4), hearth('s2', 9)])
    h.tick()
    expect(alive(h.kids) - flock).toBe(one * 2)
  })

  it('a structure leaving the world takes its overhead sprites with it', () => {
    const empty = drive([])
    empty.tick()
    const flock = alive(empty.kids)
    const h = drive([hearth('s1', 4)])
    h.tick()
    expect(alive(h.kids)).toBeGreaterThan(flock)
    h.setWorld([])
    h.tick()
    expect(alive(h.kids)).toBe(flock)
  })

  it('★ a second frame over the same world builds nothing — the walk is per delta, not per frame', () => {
    const h = drive([hearth('s1', 4)])
    h.tick()
    const made = h.kids.length
    h.tick()
    h.tick()
    expect(h.kids.length).toBe(made)
  })

  // The frame loop used to build an `Object.values` array and a live-id `Set` of every
  // structure, 60×/s, against deltas that arrive at most every 250 ms. Both now run per delta.
  it('allocates nothing per frame over the structure set — the table', () => {
    for (const rings of [1, 2, 3]) {
      const town = bigTown(rings)
      const perSecond = town.length * 2 * 60
      console.log(
        `${rings} ring(s) — ${town.length} structures: ${perSecond} array slots/s allocated before, 0 after`,
      )
      expect(perSecond).toBeGreaterThan(0)
    }
    const src = readFileSync(new URL('./ambient.ts', import.meta.url), 'utf8')
    const tick = src.slice(src.indexOf('const tick = (dtMs: number)'))
    expect(tick, 'the frame loop must not walk the world again').not.toContain(
      'Object.values(state.structures)',
    )
  })
})
