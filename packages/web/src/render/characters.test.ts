import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    scale = new Point()
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
  class Polygon {
    points: number[]
    constructor(points: number[] = []) {
      this.points = points
    }
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
  return { Assets, BitmapText, Cache, Container, Graphics, Point, Polygon, Rectangle, Sprite, Text, Texture }
})

import { Container as MockContainer, Sprite as MockSprite, Texture as MockTexture } from 'pixi.js'
import { CELL, SHEET_ROWS } from './charAnim.js'
import { createCharacterLayer } from './characters.js'
import { CROWD_SETTLE_MS } from './crowd.js'
import { BODY_SPRITE_W } from './depth.js'
import { tileToScreen } from './iso.js'
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
    getZoom: () => 1,
    wantsMotion: () => true,
    viewRect: () => ({ x: -400, y: -300, w: 800, h: 600 }),
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

  it('places a hovered name tag above the figure and inside the view (U10)', () => {
    layer.tick(1000)
    const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    const nameTag = l.worldText!.children[1] as unknown as { visible: boolean; position: { x: number; y: number } }
    nameTag.visible = true
    layer.tick(1016)
    const view = { x: -400, y: -300, w: 800, h: 600 }
    expect(nameTag.position.x).toBeGreaterThanOrEqual(view.x)
    expect(nameTag.position.x).toBeLessThanOrEqual(view.x + view.w)
    expect(nameTag.position.y).toBeGreaterThanOrEqual(view.y)
    expect(nameTag.position.y).toBeLessThanOrEqual(view.y + view.h)
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

  it('hit area is the measured capsule, in screen px, whatever the sheet resolution', () => {
    layer.tick(1000)
    const sprite = layer.getSprite('nadia') as unknown as InstanceType<typeof MockSprite>
    const hit = sprite.hitArea as unknown as { points: number[] }
    const scale = (sprite.scale as unknown as { x: number }).x
    const screen = hit.points.map((v) => v * scale)
    const xs = screen.filter((_, i) => i % 2 === 0), ys = screen.filter((_, i) => i % 2 === 1)
    // U9: 28 wide at the shoulders and 48.9 tall, NOT the old 52 × 72 box
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(28, 9)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.94 * 52, 9)
    expect(Math.max(...ys)).toBeCloseTo(0, 9)   // feet at the origin
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

// ══════════════════════════════════════════════════════════════════════════════════════════
// ★ THE WALK, DRIVEN THROUGH THE REAL LAYER
//
// `charAnim.test.ts` proves the rules. These prove the LAYER CALLS THEM — which is a different
// claim, and the one a source scan can only gesture at. The book resolves a texture here, so
// the posed cell actually reaches the sprite and the frame rectangle says which row is drawn.
// ══════════════════════════════════════════════════════════════════════════════════════════

const NEEDS_WELL = { hunger: 90, energy: 90, warmth: 90, social: 90 }
const NEEDS_HUNGRY = { hunger: 5, energy: 90, warmth: 90, social: 90 }

function makeBodyAgent(id: string, x: number, y: number, needs = NEEDS_WELL): MutableAgents[string] {
  return { ...makeAgent(id, x, y), needs } as MutableAgents[string]
}

/** A book whose sheets are already loaded, so the pose reaches the sprite. */
function loadedBook(): TextureBook {
  const tex = new MockTexture({ source: { label: 'sheet' } as never })
  return { get: () => Promise.resolve(tex), swap: () => Promise.resolve(tex) } as unknown as TextureBook
}

/** Which of the six sheet rows a body is drawn on, read off the slice rectangle. */
function drawnRow(layer: ReturnType<typeof createCharacterLayer>, id: string): string | null {
  const s = layer.getSprite(id) as unknown as { texture: { frame?: { y: number } } } | null
  const y = s?.texture?.frame?.y
  return y === undefined ? null : (SHEET_ROWS[y / CELL] ?? null)
}

/** Where the layer is DRAWING the body, in tiles, read back off its published depth box. */
function drawnTile(scene: Scene, id: string): { x: number; y: number } {
  const b = (publishedBoxes(scene) as unknown as Array<{ id: string; x0: number; y0: number }>)
    .find((q) => q.id === id)!
  return { x: b.x0 + 0.5, y: b.y0 + 0.5 }
}

describe('★ the layer walks each body at the record\'s pace, not a stopwatch\'s', () => {
  const config = {
    needs: { debuffThreshold: 30 },
    movement: { baseTicksPerTile: 1, debuffTicksPerTile: 2 },
  }

  // The layer reads the wall clock in `onEvents` (a socket message has no frame time) and the
  // frame's own clock in `tick`. StageMount drives the second with `performance.now()`, so in
  // the product they are ONE clock; the test makes that true by owning it.
  let clockMs = 0
  beforeEach(() => {
    clockMs = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clockMs)
  })
  afterEach(() => { vi.restoreAllMocks() })

  async function rig(agents: MutableAgents): Promise<{
    scene: Scene; layer: ReturnType<typeof createCharacterLayer>
    emit: (evts: SimEvent[]) => void
    at: (ms: number, evts?: SimEvent[]) => void
  }> {
    const scene = makeScene()
    const { store, emit } = makeStore(agents)
    ;(store as unknown as { getConfig: () => unknown }).getConfig = () => config
    const layer = createCharacterLayer(scene, loadedBook(), store, () => {})
    await Promise.resolve(); await Promise.resolve()   // let the sheets land on the entries
    layer.tick(0)
    await Promise.resolve(); await Promise.resolve()
    const at = (ms: number, evts?: SimEvent[]): void => {
      clockMs = ms
      if (evts !== undefined) emit(evts)
      layer.tick(ms)
    }
    return { scene, layer, emit, at }
  }

  const moved = (id: string, x: number, y: number, tick: number): SimEvent =>
    ({ type: 'agent_moved', tick, payload: { id, x, y } } as unknown as SimEvent)


  it('★ a body that stood still for a minute does NOT spend four seconds on its next tile', () => {
    return (async () => {
      const agents: MutableAgents = { nadia: makeBodyAgent('nadia', 0, 0) }
      const { scene, at } = await rig(agents)
      // two ticks so the clock learns 400 ms
      agents.nadia!.x = 1; at(400, [moved('nadia', 1, 0, 1)])
      agents.nadia!.x = 2; at(800, [moved('nadia', 2, 0, 2)])
      for (let t = 800; t <= 60_000; t += 400) at(t)          // then a minute of standing still
      expect(drawnTile(scene, 'nadia').x).toBeCloseTo(2, 3)
      // and it walks again: ONE tick later it has arrived, where the landed glide would have
      // put it a tenth of the way along a four-second crawl
      agents.nadia!.x = 3; at(60_000, [moved('nadia', 3, 0, 150)])
      at(60_400)
      expect(drawnTile(scene, 'nadia').x).toBeCloseTo(3, 3)
    })()
  })

  it('★ a hungry body walks at half speed, because the record already said it does', () => {
    return (async () => {
      const agents: MutableAgents = {
        well: makeBodyAgent('well', 0, 0, NEEDS_WELL),
        weak: makeBodyAgent('weak', 0, 0, NEEDS_HUNGRY),
      }
      const { scene, at } = await rig(agents)
      at(400, [moved('well', 1, 0, 1), moved('weak', 1, 0, 1)])
      at(800, [moved('well', 2, 0, 2), moved('weak', 2, 0, 2)])
      at(1200, [moved('well', 3, 0, 3), moved('weak', 3, 0, 3)])
      at(1400)                                    // half way through the next leg
      const wellGone = drawnTile(scene, 'well').x - drawnTile(scene, 'weak').x
      expect(wellGone).toBeGreaterThan(0.2)       // the well body is measurably further along
    })()
  })

  it('★ three bodies walking at the same instant are NOT on the same frame', () => {
    return (async () => {
      const ids = ['nadia', 'omar', 'yusuf']
      const agents: MutableAgents = Object.fromEntries(
        ids.map((id) => [id, makeBodyAgent(id, 0, 0)])) as MutableAgents
      const { layer, at } = await rig(agents)
      let differed = 0, sampled = 0
      for (let i = 1; i <= 14; i++) {
        for (const id of ids) agents[id]!.x = i
        at(i * 400, ids.map((id) => moved(id, i, 0, i)))
        for (let f = 1; f < 6; f++) {
          at(i * 400 + f * 66)
          const rows = ids.map((id) => drawnRow(layer, id))
          if (rows.every((r) => r !== null && r !== 'idle')) {
            sampled++
            if (new Set(rows).size > 1) differed++
          }
        }
      }
      expect(sampled).toBeGreaterThan(20)
      // the landed layer scores exactly 0 here: one clock, one frame, every body, always
      expect(differed / sampled).toBeGreaterThan(0.5)
    })()
  })

  it('★ and the same three are on the same frames on a SECOND run — nothing is random', () => {
    return (async () => {
      const ids = ['nadia', 'omar', 'yusuf']
      const run = async (): Promise<string[]> => {
        const agents: MutableAgents = Object.fromEntries(
          ids.map((id) => [id, makeBodyAgent(id, 0, 0)])) as MutableAgents
        const { layer, at } = await rig(agents)
        const out: string[] = []
        for (let i = 1; i <= 8; i++) {
          for (const id of ids) agents[id]!.x = i
          at(i * 400, ids.map((id) => moved(id, i, 0, i)))
          for (let f = 1; f < 4; f++) {
            at(i * 400 + f * 100)
            out.push(ids.map((id) => drawnRow(layer, id)).join(','))
          }
        }
        return out
      }
      const a = await run()
      clockMs = 0
      const b = await run()
      expect(a).toEqual(b)
      expect(new Set(a).size).toBeGreaterThan(1)      // and it is not one frozen frame
    })()
  })

  it('the walk never drifts more than two ticks behind the record, on a jittery socket', () => {
    return (async () => {
      const agents: MutableAgents = { nadia: makeBodyAgent('nadia', 0, 0) }
      const { scene, at } = await rig(agents)
      let worst = 0
      for (let i = 1; i <= 40; i++) {
        agents.nadia!.x = i
        at(i * 400 + (i % 5 === 0 ? 260 : 0), [moved('nadia', i, 0, i)])
        worst = Math.max(worst, i - drawnTile(scene, 'nadia').x)
      }
      expect(worst).toBeLessThanOrEqual(3)
    })()
  })

  it('★ reduced motion reaches the layer: the bob goes, the walk does not', () => {
    return (async () => {
      const agents: MutableAgents = { nadia: makeBodyAgent('nadia', 0, 0) }
      const scene = makeScene()
      ;(scene as unknown as { wantsMotion: () => boolean }).wantsMotion = () => false
      const { store, emit } = makeStore(agents)
      ;(store as unknown as { getConfig: () => unknown }).getConfig = () => config
      const layer = createCharacterLayer(scene, loadedBook(), store, () => {})
      // the sheet load starts on the first tick, so the await has to come after it
      layer.tick(0)
      await Promise.resolve(); await Promise.resolve()
      layer.tick(0)
      const rows = new Set<string | null>()
      for (let i = 1; i <= 10; i++) {
        agents.nadia!.x = i
        clockMs = i * 400
        emit([moved('nadia', i, 0, i)])
        for (let f = 0; f < 5; f++) {
          clockMs = i * 400 + f * 70
          layer.tick(clockMs)
          rows.add(drawnRow(layer, 'nadia'))
          // the shadow is placed at the body's own sy with no bob, so the gap between them IS
          // the hop. Under reduced motion it is zero on every frame of the loop.
          const s = layer.getSprite('nadia') as unknown as { position: { y: number } }
          const l = scene.layers as unknown as Record<string, { children: Array<{ position: { y: number } }> }>
          expect(s.position.y - l.shadow!.children[0]!.position.y).toBe(0)
        }
      }
      rows.delete(null)
      rows.delete('idle')
      expect(rows.size).toBeGreaterThan(1)          // the person is still walking
    })()
  })
})

describe('★ four people on one tile, through the real layer', () => {
  const NAMES = ['amara', 'nadia', 'salma', 'yusuf']
  let agents: MutableAgents
  let scene: Scene
  let layer: ReturnType<typeof createCharacterLayer>

  beforeEach(() => {
    agents = Object.fromEntries(NAMES.map((n) => [n, makeAgent(n, 103, 77)]))
    scene = makeScene()
    layer = createCharacterLayer(scene, makeBook().book, makeStore(agents).store, () => {})
  })

  /** Where the layer actually put each body's sprite, in the order it created them. */
  const sprites = (): Array<{ x: number; y: number }> => {
    const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    return l.entities!.children.map((c) => ({ x: c.position.x, y: c.position.y }))
  }

  it('★ THE RED — four bodies at one door are drawn at four points, not one', () => {
    layer.tick(1000)
    layer.tick(2000)   // past CROWD_SETTLE_MS: the rank has formed
    const at = sprites()
    expect(at).toHaveLength(4)
    expect(new Set(at.map((p) => `${p.x},${p.y}`)).size).toBe(4)
  })

  it('and the depth box follows the sprite, so the sort and the cull see the drawn place', () => {
    layer.tick(1000)
    layer.tick(2000)
    const boxes = publishedBoxes(scene) as unknown as Array<{ id: string; x0: number; y0: number; sx0: number }>
    expect(new Set(boxes.map((b) => `${b.x0},${b.y0}`)).size).toBe(4)
    const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    for (const b of boxes) {
      const sprite = l.entities!.children[NAMES.indexOf(b.id)]!
      expect(b.sx0).toBeCloseTo(sprite.position.x - BODY_SPRITE_W / 2, 6)
    }
  })

  it('the shadow and the emote move with the body', () => {
    layer.tick(1000)
    layer.tick(2000)
    const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    const { sx } = tileToScreen(103, 77)
    for (let i = 0; i < NAMES.length; i++) {
      const sprite = l.entities!.children[i]!
      // non-vacuous: this body is NOT where the record put it, and its companions came along
      expect(sprite.position.x).not.toBe(sx)
      expect(l.shadow!.children[i]!.position.x).toBe(sprite.position.x)
      expect(l.worldText!.children[i * 2]!.position.x).toBe(sprite.position.x)
    }
  })

  it('★ ONE body on a tile is left exactly where the record puts it', () => {
    for (const n of NAMES.slice(1)) delete agents[n]
    layer.tick(1000)
    layer.tick(2000)
    const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    const { sx, sy } = tileToScreen(103, 77)
    expect(l.entities!.children[0]!.position.x).toBe(sx)
    expect(l.entities!.children[0]!.position.y).toBe(sy)
  })

  it('★ the rank GLIDES into place rather than snapping', () => {
    layer.tick(1000)
    const start = sprites().map((p) => p.x)
    layer.tick(1000 + CROWD_SETTLE_MS / 2)
    const mid = sprites().map((p) => p.x)
    layer.tick(1000 + CROWD_SETTLE_MS)
    const end = sprites().map((p) => p.x)
    expect(Math.abs(mid[0]! - start[0]!)).toBeGreaterThan(0)
    expect(Math.abs(mid[0]! - start[0]!)).toBeLessThan(Math.abs(end[0]! - start[0]!))
  })

  it('and a viewer who asked for less motion gets the arrangement, not the slide', () => {
    const still = makeScene()
    ;(still as unknown as { wantsMotion: () => boolean }).wantsMotion = () => false
    const l2 = createCharacterLayer(still, makeBook().book, makeStore(agents).store, () => {})
    l2.tick(1000)
    const at = (still.layers as unknown as Record<string, InstanceType<typeof MockContainer>>)
      .entities!.children.map((c) => c.position.x)
    expect(new Set(at).size).toBe(4)   // arrived on the very first frame
    l2.destroy()
  })
})
