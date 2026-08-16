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
    eventMode = ''
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
  return { Assets, BitmapText, Container, Graphics, Point, Rectangle, Sprite, Texture }
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

function makeScene(): Scene {
  const entities = new MockContainer()
  return {
    app: { renderer: { generateTexture: () => ({ destroy: () => {} }) } },
    entities,
  } as unknown as Scene
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
    const entities = scene.entities as unknown as InstanceType<typeof MockContainer>
    expect(entities.children).toHaveLength(2 * 4) // sprite, shadow, emote, nameTag × 2 agents
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

  it('name-tag label anchors (0.5, 1) and the bg slab wraps it with 4px padding', () => {
    layer.tick(1000)
    const entities = scene.entities as unknown as InstanceType<typeof MockContainer>
    const nameTag = entities.children[3]! // per-agent add order: shadow, sprite, emote, nameTag
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
    const entities = scene.entities as unknown as InstanceType<typeof MockContainer>
    expect(entities.children).toHaveLength(4)
    expect(sprite.destroyed).toBe(true)
    expect(layer.getSprite('omar')).toBeNull()
  })
})
