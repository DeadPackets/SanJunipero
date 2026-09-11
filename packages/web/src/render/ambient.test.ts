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
    ellipses: number[][] = []
    fills: unknown[] = []
    rect(): this {
      return this
    }
    circle(): this {
      return this
    }
    ellipse(x: number, y: number, rx: number, ry: number): this {
      this.ellipses.push([x, y, rx, ry])
      return this
    }
    clear(): this {
      this.ellipses = []
      this.fills = []
      return this
    }
    fill(style: unknown): this {
      this.fills.push(style)
      return this
    }
  }
  return { Container, Graphics, Point, Sprite, Texture: { EMPTY: {} } }
})
// the town's structures live in a module-level map a mocked Pixi never fills, so the one call
// the bounce loop makes on them is recorded here instead
const entityCalls: { kind: string; id: string; k: number }[] = []
const sunCalls: { scaleX: number; dx: number }[] = []
vi.mock('./entities.js', () => ({
  setEntityScaleMul: (_s: unknown, kind: string, id: string, k: number) => {
    entityCalls.push({ kind, id, k })
    return true
  },
  setSunCast: (_s: unknown, cast: { scaleX: number; dx: number }) => {
    sunCalls.push(cast)
  },
}))
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
import { GROUND_SHADOW_INK } from './groundShadow.js'
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
  const clock = { tick: 0 }
  const store = {
    getState: () => state,
    getTick: () => clock.tick,
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
    clock,
    shade: (): { ellipses: number[][]; fills: unknown[] } =>
      groundDecal.children[0]!.children[0] as unknown as {
        ellipses: number[][]
        fills: unknown[]
      },
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

// ★ A BIRTH, A DEATH AND A DROPPED PLANK WERE ONE 260 ms 1.18x POP. The picture could not say
// that anything mattered, so the table gives each class of moment its own size and its own run.
describe('★ the picture says how much a moment mattered', () => {
  const rig = (): {
    emit: (evts: SimEvent[]) => void
    run: (ms: number) => void
    peakFor: (id: string) => number
    framesFor: (id: string) => number
    entity: (id: string) => number[]
  } => {
    entityCalls.length = 0
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
    dir.tick(16)
    return {
      emit: (evts) => {
        for (const fn of handlers) fn(evts)
      },
      run: (ms) => {
        for (let i = 0; i < ms / 16; i++) dir.tick(16)
      },
      peakFor: (id) => Math.max(...calls.filter((c) => c.id === id).map((c) => c.k)),
      framesFor: (id) => calls.filter((c) => c.id === id && c.k !== 1).length,
      entity: (id) => entityCalls.filter((c) => c.id === id).map((c) => c.k),
    }
  }

  const BIRTH = {
    type: 'agent_born',
    tick: 4,
    payload: { id: 'ife', name: 'Ife', sex: 'f', motherId: 'amara', fatherId: 'yusuf', x: 3, y: 4 },
  } as unknown as SimEvent
  const PARTING = {
    type: 'partnership_dissolved',
    tick: 4,
    payload: { aId: 'amara', bId: 'yusuf', byId: 'amara' },
  } as unknown as SimEvent
  const RULE_BROKEN = {
    type: 'law_broken',
    tick: 4,
    payload: { id: 'law_1', byId: 'omar' },
  } as unknown as SimEvent

  it('★ draws a birth bigger and longer than a parting, and a parting than a broken rule', () => {
    const r = rig()
    r.emit([BIRTH, PARTING, RULE_BROKEN])
    r.run(1200)
    expect(r.peakFor('ife')).toBeGreaterThan(r.peakFor('yusuf'))
    expect(r.peakFor('yusuf')).toBeGreaterThan(r.peakFor('omar'))
    expect(r.framesFor('ife')).toBeGreaterThan(r.framesFor('yusuf'))
    expect(r.framesFor('yusuf')).toBeGreaterThan(r.framesFor('omar'))
    // the birth is the one a viewer across the room can see
    expect(r.peakFor('ife') - r.peakFor('omar')).toBeGreaterThan(0.15)
  })

  it('★ never draws a beat on a death: the stillness the tone calls is the whole picture', () => {
    const r = rig()
    r.emit([{ type: 'agent_died', tick: 4, payload: { agentId: 'nadia' } } as unknown as SimEvent])
    r.run(1200)
    // `characters.ts` takes a body off the map the tick it stops being alive, so a knell here
    // would be a beautiful curve nobody is ever shown.
    expect(r.framesFor('nadia')).toBe(0)
  })

  it('★ lands a finished house under its own weight and barely moves a dropped plank', () => {
    const r = rig()
    r.emit([
      { type: 'structure_completed', tick: 4, payload: { id: 'house_2' } } as unknown as SimEvent,
      {
        type: 'item_spawned',
        tick: 4,
        payload: { id: 'item_9', kind: 'wood', qty: 1, loc: { t: 'agent', id: 'omar' } },
      } as unknown as SimEvent,
    ])
    r.run(1200)
    const house = r.entity('house_2')
    const plank = r.entity('item_9')
    expect(house[0]).toBeGreaterThan(1)
    expect(Math.min(...house), 'a raised roof settles onto its plot').toBeLessThan(1)
    expect(Math.min(...plank), 'a plank has no weight to land with').toBe(1)
    expect(Math.max(...house)).toBeGreaterThan(Math.max(...plank))
    expect(house.length, 'and it is on screen longer').toBeGreaterThan(plank.length)
  })
})

// ── ★ THE WOOD STANDS ON SOMETHING, AND ON THE SAME SUN THE TOWN DOES ────────────────────

describe('★ the canopies mark the ground, on one sun shared with the buildings', () => {
  it('lays one mark under every tree, under the trunks that cast them', () => {
    const r = wooded()
    r.frame(16)
    const trees = r.nodes().filter((n) => n.children.length === 0).length
    expect(r.shade().ellipses.length, 'a mark a tree').toBeGreaterThan(0)
    expect(r.shade().ellipses.length).toBeLessThan(trees)
    expect(r.shade().fills, 'ink, once, for the whole wood').toHaveLength(1)
    expect(r.shade().fills[0]).toMatchObject({ color: GROUND_SHADOW_INK })
  })

  it('★ moves them with the hour, and stretches them the way a body is stretched', () => {
    const r = wooded()
    r.frame(16)
    const noon = r.shade().ellipses[0]!
    r.clock.tick = 20 * 60 + 30
    r.frame(16)
    const dusk = r.shade().ellipses[0]!
    expect(dusk[0], 'laid away from a low sun').not.toBeCloseTo(noon[0]!, 3)
    expect(dusk[2]).toBeGreaterThan(noon[2]!)
    r.clock.tick = 6 * 60
    r.frame(16)
    const dawn = r.shade().ellipses[0]!
    expect(
      (dawn[0]! - noon[0]!) * (dusk[0]! - noon[0]!),
      'the two ends of the day lie opposite ways',
    ).toBeLessThan(0)
  })

  it('★ asks the sky ONCE a tick, and hands that one answer to the buildings too', () => {
    const r = wooded()
    r.frame(16) // noon: the mark sits on the trunk, so this reads the trunk's own x
    const trunkX = r.shade().ellipses[0]![0]!
    sunCalls.length = 0
    r.clock.tick = 20 * 60 + 30
    for (let i = 0; i < 20; i++) r.frame(16)
    expect(sunCalls, 'twenty frames, one hour, one answer').toHaveLength(1)
    const dx = r.shade().ellipses[0]![0]! - trunkX
    expect(sunCalls[0]!.dx * dx, 'the trees lie the way the sun told the town to').toBeGreaterThan(
      0,
    )
    r.clock.tick = 6 * 60
    r.frame(16)
    expect(sunCalls, 'and it asks again when the hour moves').toHaveLength(2)
  })

  it('the hour keeps moving under reduced motion, because it is not an animation', () => {
    const r = wooded(false)
    r.frame(16)
    const noon = r.shade().ellipses[0]!
    r.clock.tick = 20 * 60 + 30
    r.frame(16)
    expect(r.shade().ellipses[0]![0]).not.toBeCloseTo(noon[0]!, 3)
  })
})
