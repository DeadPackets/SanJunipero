import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorldState } from '@sj/engine/state'
import type { SimEvent } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'

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
    parent: Container | null = null
    visible = true
    zIndex = 0
    destroyed = false
    eventMode = ''
    position = new Point()
    sortableChildren = false
    addChild(...cs: Container[]): void {
      for (const c of cs) {
        c.parent = this
        this.children.push(c)
      }
    }
    on(): this {
      return this
    }
    destroy(_opts?: unknown): void {
      if (this.parent !== null) {
        const i = this.parent.children.indexOf(this)
        if (i >= 0) this.parent.children.splice(i, 1)
        this.parent = null
      }
      this.destroyed = true
    }
  }
  class Sprite extends Container {
    anchor = new Point()
    scale = new Point()
    cursor = ''
    hitArea: unknown = null
    texture: unknown = null
    alpha = 1
    constructor(texture?: unknown) {
      super()
      if (texture !== undefined) this.texture = texture
    }
  }
  class Graphics extends Container {
    lastRoundRect: number[] | null = null
    ellipse(): this { return this }
    fill(): this { return this }
    clear(): this { return this }
    roundRect(...args: number[]): this {
      this.lastRoundRect = args
      return this
    }
  }
  class BitmapText extends Container {
    text: string
    anchor = new Point()
    width = 40
    height = 10
    constructor(opts?: { text?: string }) {
      super()
      this.text = opts?.text ?? ''
    }
  }
  // No pixel BitmapFont is installed in the product yet, so createWorldLabel takes the canvas
  // glyph path — the fallback that stops a missing font blanking the whole canvas (R3).
  class Text extends BitmapText {
    resolution = 1
  }
  const Cache = { has: () => false }
  class Rectangle {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
  }
  class Texture {
    static EMPTY: Texture
    source: unknown
    frame: unknown
    constructor(opts?: { source?: unknown; frame?: unknown }) {
      this.source = opts?.source ?? { autoGenerateMipmaps: false, scaleMode: 'nearest' }
      this.frame = opts?.frame
    }
    destroy(): void {}
  }
  Texture.EMPTY = new Texture()
  const Assets = { add: vi.fn(), load: vi.fn(() => new Promise(() => {})) }
  return { Assets, BitmapText, Cache, Container, Graphics, Point, Rectangle, Sprite, Text, Texture }
})

import { Container as MockContainer, Sprite as MockSprite } from 'pixi.js'
import { createCharacterLayer } from './characters.js'
import type { Scene } from './scene.js'
import type { TextureBook } from './textures.js'

type MutableAgents = Record<string, { id: string; name: string; x: number; y: number; alive: boolean; asleep: boolean; collapsedSinceTick: number | null }>

function makeAgent(id: string, x: number, y: number): MutableAgents[string] {
  return { id, name: id, x, y, alive: true, asleep: false, collapsedSinceTick: null }
}

function makeStore(agents: MutableAgents): { store: WorldStore; emit: (evts: SimEvent[]) => void } {
  const handlers = new Set<(evts: SimEvent[]) => void>()
  const store = {
    getState: () => ({ agents } as unknown as WorldState),
    getMode: () => ({ live: true as const }),
    getTick: () => 0,
    latestThought: () => null,
    thoughtsLog: () => [],
    recentEvents: () => [],
    assetsSeq: () => 0,
    assetRecords: () => [],
    applyServer: () => {},
    subscribe: () => () => {},
    onEvents: (fn: (evts: SimEvent[]) => void) => {
      handlers.add(fn)
      return () => handlers.delete(fn)
    },
  } as unknown as WorldStore
  return { store, emit: (evts) => { for (const fn of handlers) fn(evts) } }
}

const LAYER_NAMES = [
  'ground', 'groundDecal', 'shadow', 'entities', 'overhead', 'worldText', 'bubbles', 'overlay',
] as const

function makeScene(): Scene & { sortDepth: () => void } {
  const layers = Object.fromEntries(LAYER_NAMES.map((n) => [n, new MockContainer()]))
  const sources = new Set<() => Array<{ box: { id: string }; node: unknown }>>()
  return {
    app: { renderer: { generateTexture: () => ({ destroy: () => {} }) } },
    layers,
    entities: layers.entities,
    addDepthSource: (fn: () => Array<{ box: { id: string }; node: unknown }>) => {
      sources.add(fn)
      return () => sources.delete(fn)
    },
    // the real scene runs depth.ts here; the test only needs the published boxes
    sortDepth: () => [...sources].flatMap((f) => f()),
  } as unknown as Scene & { sortDepth: () => void }
}

const publishedBoxes = (scene: Scene): Array<{ id: string }> =>
  ((scene as unknown as { sortDepth: () => Array<{ box: { id: string } }> }).sortDepth() ?? [])
    .map((e) => e.box)

// every display object the layer put anywhere in the stack
const placed = (scene: Scene): InstanceType<typeof MockContainer>[] => {
  const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
  return LAYER_NAMES.flatMap((n) => l[n]!.children)
}

function makeBook(): { book: TextureBook; get: ReturnType<typeof vi.fn> } {
  const get = vi.fn(() => new Promise<never>(() => {}))
  const book = { get, swap: vi.fn(() => new Promise<never>(() => {})) } as unknown as TextureBook
  return { book, get }
}

describe('createCharacterLayer entry registration (F1 regression net)', () => {
  let agents: MutableAgents
  let scene: Scene
  let layer: ReturnType<typeof createCharacterLayer>
  let get: ReturnType<typeof vi.fn>

  beforeEach(() => {
    agents = { nadia: makeAgent('nadia', 3, 4), omar: makeAgent('omar', 5, 6) }
    scene = makeScene()
    const { store } = makeStore(agents)
    const made = makeBook()
    get = made.get
    layer = createCharacterLayer(scene, made.book, store, () => {})
  })

  it('two ticks add exactly 4 display objects per agent, not 4 per agent per tick', () => {
    layer.tick(1000)
    layer.tick(1016)
    expect(placed(scene)).toHaveLength(2 * 4) // sprite, shadow, emote, nameTag × 2 agents
  })

  it('puts each companion in the layer that owns it, never in the depth sort', () => {
    layer.tick(1000)
    const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    expect(l.shadow!.children).toHaveLength(2)     // one contact shadow per body
    expect(l.entities!.children).toHaveLength(2)   // ONLY the bodies are depth-sorted
    expect(l.worldText!.children).toHaveLength(4)  // emote + name tag per body
  })

  it('publishes one depth box per living body, at its INTERPOLATED tile', () => {
    layer.tick(1000)
    const boxes = publishedBoxes(scene) as unknown as Array<{ id: string; x0: number; y0: number }>
    expect(boxes.map((b) => b.id).sort()).toEqual(['nadia', 'omar'])
    const nadia = boxes.find((b) => b.id === 'nadia')!
    expect([nadia.x0, nadia.y0]).toEqual([2.5, 3.5])   // tile (3,4) spans [2.5,3.5]×[3.5,4.5]
  })

  it('getSprite returns the same registered sprite across ticks', () => {
    layer.tick(1000)
    const first = layer.getSprite('nadia')
    expect(first).not.toBeNull()
    layer.tick(1016)
    expect(layer.getSprite('nadia')).toBe(first)
  })

  it('loads each agent sheet exactly once', () => {
    layer.tick(1000)
    layer.tick(1016)
    const charCalls = get.mock.calls.filter(([url]) => String(url).startsWith('/assets/character/'))
    expect(charCalls.map(([url]) => url).sort()).toEqual([
      '/assets/character/nadia.png',
      '/assets/character/omar.png',
    ])
  })

  it('hit area compensates for sprite scale so the click target is 52×72 screen px', () => {
    layer.tick(1000)
    const sprite = layer.getSprite('nadia') as unknown as InstanceType<typeof MockSprite>
    const hit = sprite.hitArea as unknown as { x: number; y: number; width: number; height: number }
    const scale = sprite.scale as unknown as { x: number; y: number }
    expect(hit.width * scale.x).toBeCloseTo(52, 9)
    expect(hit.height * scale.y).toBeCloseTo(72, 9)
    expect(hit.x * scale.x).toBeCloseTo(-26, 9)
    expect(hit.y * scale.y).toBeCloseTo(-72, 9)
  })

  it('companion objects are event-inert so they never swallow the sprite hit', () => {
    layer.tick(1000)
    const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    const shadow = l.shadow!.children[0] as unknown as { eventMode: string }
    const sprite = l.entities!.children[0] as unknown as { eventMode: string }
    const [emote, nameTag] = l.worldText!.children as unknown as Array<{ eventMode: string }>
    expect(shadow!.eventMode).toBe('none')
    expect(emote!.eventMode).toBe('none')
    expect(nameTag!.eventMode).toBe('none')
    expect(sprite!.eventMode).toBe('static')
  })

  it('name-tag label anchors (0.5, 1) and the bg slab wraps it with 4px padding', () => {
    layer.tick(1000)
    const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    const nameTag = l.worldText!.children[1]! // per-agent add order into worldText: emote, nameTag
    const [bg, label] = nameTag.children as unknown as [
      { lastRoundRect: number[] | null },
      { anchor: { x: number; y: number }; width: number; height: number },
    ]
    expect(label.anchor.x).toBe(0.5)
    expect(label.anchor.y).toBe(1)
    // anchored (0.5,1) the text spans x∈[-w/2, w/2], y∈[-h, 0]; slab must pad 4px on all sides
    expect(bg.lastRoundRect).toEqual([-label.width / 2 - 4, -label.height - 4, label.width + 8, label.height + 8, 2])
  })

  it('removing an agent destroys its 4 objects and drops the entry', () => {
    layer.tick(1000)
    const sprite = layer.getSprite('omar') as unknown as InstanceType<typeof MockSprite>
    expect(sprite).not.toBeNull()
    delete agents.omar
    layer.tick(1016)
    expect(placed(scene)).toHaveLength(4)
    expect(sprite.destroyed).toBe(true)
    expect(layer.getSprite('omar')).toBeNull()
  })
})
