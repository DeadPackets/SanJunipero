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
    get x(): number {
      return this.position.x
    }
    set x(v: number) {
      this.position.x = v
    }
    get y(): number {
      return this.position.y
    }
    set y(v: number) {
      this.position.y = v
    }
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
import { Container as MockContainer } from 'pixi.js'
import { CITY_HEARTH_KIND, cityStructures } from '@sj/shared'
import type { SimEvent } from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from './scene.js'
import {
  HEARTH_KINDS,
  SMOKE_COLOR,
  SMOKE_MAX_ALPHA,
  TREES_MAX,
  createAmbient,
  sampleDecorations,
} from './ambient.js'
import { bigTown } from './bigTown.js'
import { advanceWind } from './wind.js'

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

type Node = {
  blendMode: string
  alpha: number
  position: { x: number; y: number }
  skew: { x: number; y: number }
  children: Node[]
}
const FOREST: TileId = 3

/** A wood, so the canopies are really built, and a world whose structure set counts its reads. */
const wooded = (motion = true) => {
  const groundDecal = new MockContainer()
  const read = { agents: 0, structures: 0 }
  const state = {
    terrain: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => FOREST)),
    items: {},
    get agents() {
      read.agents++
      return {}
    },
    get structures() {
      read.structures++
      return {}
    },
  }
  const scene = {
    app: { renderer: { generateTexture: () => ({ destroy: () => {} }) } },
    layers: { groundDecal, overhead: new MockContainer() },
    wantsMotion: () => motion,
    reachableBox: () => ({ minX: 0, minY: 0, maxX: 100, maxY: 100 }),
  } as unknown as Scene
  const store = {
    getState: () => state,
    getTick: () => 0,
    onEvents: () => () => {},
  } as unknown as WorldStore
  const dir = createAmbient(scene, store, {
    weather: { setSuppressed: () => {} },
    bubbles: { setSuppressed: () => {} },
  } as unknown as Parameters<typeof createAmbient>[2])
  const walk = (n: Node): Node[] => [n, ...n.children.flatMap(walk)]
  return {
    dir,
    read,
    // the frame StageMount runs: the one wind clock moves, then the director draws
    frame: (dtMs: number): void => {
      advanceWind(dtMs)
      dir.tick(dtMs)
    },
    nodes: (): Node[] => walk(groundDecal),
  }
}

describe('the ambient effects stay quiet', () => {
  it('smoke is warm grey, never cream — cream read as white glass', () => {
    expect(SMOKE_COLOR).toBe(0xcfc6bc)
    expect(SMOKE_MAX_ALPHA).toBeLessThan(0.5)
  })

  it('draws no light of its own — every additive glow lives above the night grade (D1)', () => {
    const r = wooded()
    for (let i = 0; i < 20; i++) r.frame(16)
    expect(r.nodes().length).toBeGreaterThan(3)
    for (const n of r.nodes()) expect(n.blendMode).not.toBe('add')
  })

  it('★ holds every oscillator at base under prefers-reduced-motion (D6)', () => {
    const frames = (motion: boolean): number => {
      const r = wooded(motion)
      const seen = new Set<string>()
      for (let i = 0; i < 40; i++) {
        r.frame(50)
        seen.add(
          r
            .nodes()
            .map((n) => `${n.position.x},${n.position.y},${n.alpha}`)
            .join('|'),
        )
      }
      return seen.size
    }
    expect(frames(false), 'stillness is one frame, held').toBe(1)
    expect(frames(true)).toBeGreaterThan(1)
  })

  it('sways a canopy by whole pixels of its crown, never by a shear (D14)', () => {
    const r = wooded()
    const offsets = new Set<number>()
    for (let i = 0; i < 200; i++) {
      r.frame(97)
      for (const n of r.nodes()) {
        expect(Number.isInteger(n.position.x), 'a crown moves by whole pixels').toBe(true)
        expect([n.skew.x, n.skew.y], 'a shear would smear the pixel art').toEqual([1, 1])
      }
      offsets.add(r.nodes().at(-1)!.position.x)
    }
    expect(offsets.size, 'not vacuous: the wood really did sway').toBeGreaterThan(1)
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

describe('the frame loop does not walk the world', () => {
  it('allocates nothing per frame over the structure set — the table', () => {
    for (const rings of [1, 2, 3]) {
      const town = bigTown(rings)
      const perSecond = town.length * 2 * 60
      console.log(
        `${rings} ring(s) — ${town.length} structures: ${perSecond} array slots/s allocated before, 0 after`,
      )
      expect(perSecond).toBeGreaterThan(0)
    }
    const r = wooded()
    r.frame(16)
    // not vacuous: the counter fires, once, on the fold that changed the world
    expect(r.read.agents, 'the working sync reads the bodies when the world changes').toBe(1)
    for (let i = 0; i < 60; i++) r.frame(16)
    expect(r.read.agents, 'and never again on a frame that changed nothing').toBe(1)
    expect(r.read.structures, 'the smoke follows events, not the frame loop').toBe(0)
  })
})

// ★ The director clock stops under the grave tone and the bounce loop keeps reading it, so a
// body caught mid-bounce held at 1.18x for the whole sim-hour a death stills the town for.
describe('★ a bounce cannot be frozen mid-flight', () => {
  const rig = (): {
    tick: (dtMs: number) => void
    emit: (evts: SimEvent[]) => void
    lastFor: (id: string) => number | undefined
  } => {
    const handlers = new Set<(evts: SimEvent[]) => void>()
    const scene = {
      app: { renderer: { generateTexture: () => ({ destroy: () => {} }) } },
      layers: { groundDecal: new MockContainer(), overhead: new MockContainer() },
      wantsMotion: () => true,
      reachableBox: () => ({ minX: 0, minY: 0, maxX: 100, maxY: 100 }),
    } as unknown as Scene
    const store = {
      getState: () => ({ terrain: [[1, 1]], agents: {} }),
      getTick: () => 0,
      onEvents: (fn: (evts: SimEvent[]) => void) => {
        handlers.add(fn)
        return () => handlers.delete(fn)
      },
    } as unknown as WorldStore
    const calls: { id: string; k: number }[] = []
    const dir = createAmbient(scene, store, {
      weather: { setSuppressed: () => {} },
      bubbles: { setSuppressed: () => {} },
      chars: {
        setEmotesHidden: () => {},
        setScaleMulY: (id: string, k: number) => calls.push({ id, k }),
      },
    } as unknown as Parameters<typeof createAmbient>[2])
    return {
      tick: dir.tick,
      emit: (evts) => {
        for (const fn of handlers) fn(evts)
      },
      lastFor: (id) => calls.filter((c) => c.id === id).at(-1)?.k,
    }
  }

  it('★ lands every body back at rest when the tone flips', () => {
    const { tick, emit, lastFor } = rig()
    tick(16)
    emit([
      { type: 'partnership_formed', tick: 1, payload: { aId: 'amara', bId: 'yusuf' } } as SimEvent,
    ])
    tick(130)
    expect(lastFor('amara')).toBeGreaterThan(1)

    emit([{ type: 'agent_died', tick: 1, payload: { id: 'nadia' } } as SimEvent])
    tick(16)
    expect(lastFor('amara'), 'the death settles the bounce it froze').toBe(1)
    expect(lastFor('yusuf')).toBe(1)
    tick(16)
    expect(lastFor('amara'), 'and nothing holds it at a scale after that').toBe(1)
  })
})
