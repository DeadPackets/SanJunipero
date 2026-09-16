import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { WorldState } from '@sj/engine/state'
import type { SimEvent } from '@sj/shared'
import type { TownScene, WorldStore } from '../state/worldStore.js'
import { SLOT_ABOVE_HEAD_PX, SLOT_PX } from './overhead.js'
import { shadowCast } from '../ui/skyModel.js'
import { createTension, TENSION_DESATURATE_MS } from './tension.js'

// A pass-through spy: the real sun, counted, so "once a frame" is a measured call count.
vi.mock('../ui/skyModel.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../ui/skyModel.js')>()
  return { ...real, shadowCast: vi.fn(real.shadowCast) }
})

// Every Texture pixi hands out, counted: an uncached slice is a listener that is never freed.
const cut = vi.hoisted(() => ({ textures: 0 }))
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
    handlers: Record<string, () => void> = {}
    on(ev: string, fn: () => void): this {
      this.handlers[ev] = fn
      return this
    }
    destroy(): void {
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
    tint = 0xffffff
    constructor(texture?: unknown) {
      super()
      if (texture !== undefined) this.texture = texture
    }
  }
  class Graphics extends Container {
    lastRoundRect: number[] | null = null
    ellipse(): this {
      return this
    }
    fill(): this {
      return this
    }
    clear(): this {
      return this
    }
    roundRect(...args: number[]): this {
      this.lastRoundRect = args
      return this
    }
    rect(): this {
      return this
    }
    lastStroke: { width?: number; color?: number } | null = null
    stroke(o?: { width?: number; color?: number }): this {
      this.lastStroke = o ?? null
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
      cut.textures++
    }
    destroy(): void {}
  }
  Texture.EMPTY = new Texture()
  const Assets = { add: vi.fn(), load: vi.fn(() => new Promise(() => {})) }
  return {
    Assets,
    BitmapText,
    Cache,
    Container,
    Graphics,
    Point,
    Polygon,
    Rectangle,
    Sprite,
    Text,
    Texture,
  }
})

import { Container as MockContainer, Sprite as MockSprite, Texture as MockTexture } from 'pixi.js'
import { CELL, CHAR_TARGET_PX, IDLE_SQUASH, SHEET_ROWS } from './charAnim.js'
import { characterCell, createCharacterLayer } from './characters.js'
import { ZOOM_STOPS, type ZoomStop } from './camera.js'
import { CROWD_PITCH_PX, CROWD_SETTLE_MS } from './crowd.js'
import { BODY_SPRITE_W, depthOrder, type DepthBox } from './depth.js'
import { HIT_MIN_PX, SHOULDER_W, bodyHitPolygon, inflateToMin, polygonBounds } from './hitShapes.js'
import { FACINGS, feetOf, tileToScreen } from './iso.js'
import type { Scene } from './scene.js'
import { LOAD_PRIORITY, type TextureBook } from './textures.js'

type MutableAgents = Record<
  string,
  {
    id: string
    name: string
    x: number
    y: number
    alive: boolean
    asleep: boolean
    collapsedSinceTick: number | null
  }
>

function makeAgent(id: string, x: number, y: number): MutableAgents[string] {
  // The overhead slot reads a whole body — the condition table is half of its priority order.
  return {
    id,
    name: id,
    x,
    y,
    alive: true,
    asleep: false,
    collapsedSinceTick: null,
    activity: null,
    needs: NEEDS_WELL,
    injuries: [],
    ill: false,
    hp: 100,
  } as MutableAgents[string]
}

function makeStore(agents: MutableAgents): {
  store: WorldStore
  emit: (evts: SimEvent[]) => void
  setScene: (s: TownScene | null) => void
  setMoving: (v: boolean) => void
  setTick: (t: number) => void
  setMinds: (m: Record<string, 'deciding' | 'idle'>) => void
  setAssetsSeq: (n: number) => void
} {
  const handlers = new Set<(evts: SimEvent[]) => void>()
  const tension = createTension({
    onEvents: (fn) => {
      handlers.add(fn)
      return () => handlers.delete(fn)
    },
  })
  let scene: TownScene | null = null
  let moving = true
  let tick = 0
  let minds = new Map<string, { state: 'deciding' | 'idle'; tick: number }>()
  let assetsSeq = 1
  const store = {
    getState: () => ({ agents }) as unknown as WorldState,
    getMode: () =>
      moving ? { live: true as const } : { live: false as const, replaying: false, tick: 0 },
    timeMoving: () => moving,
    getTick: () => tick,
    getConfig: () => null,
    latestThought: () => null,
    thoughtsLog: () => [],
    recentEvents: () => [],
    shotScene: () => scene,
    minds: () => minds,
    tension,
    // The codex has spoken and holds no atlas for these bodies, which is what the gateway's
    // own character route exists for. At zero the layer is still waiting on the manifest.
    assetsSeq: () => assetsSeq,
    assetRecords: () => [],
    applyServer: () => {},
    subscribe: () => () => {},
    onEvents: (fn: (evts: SimEvent[]) => void) => {
      handlers.add(fn)
      return () => handlers.delete(fn)
    },
  } as unknown as WorldStore
  return {
    store,
    setScene: (s) => {
      scene = s
    },
    setMoving: (v) => {
      moving = v
    },
    setTick: (t) => {
      tick = t
    },
    setAssetsSeq: (n) => {
      assetsSeq = n
    },
    setMinds: (m) => {
      minds = new Map(Object.entries(m).map(([id, state]) => [id, { state, tick }]))
    },
    emit: (evts) => {
      for (const fn of handlers) fn(evts)
    },
  }
}

const LAYER_NAMES = [
  'ground',
  'groundDecal',
  'shadow',
  'entities',
  'overhead',
  'worldText',
  'bubbles',
  'overlay',
] as const

function makeScene(): Scene & { sortDepth: () => void } {
  const layers = Object.fromEntries(LAYER_NAMES.map((n) => [n, new MockContainer()]))
  const sources = new Set<() => { box: { id: string }; node: unknown }[]>()
  return {
    app: { renderer: { generateTexture: () => ({ destroy: () => {} }) } },
    layers,
    entities: layers.entities,
    getZoom: () => 1,
    getZoomStop: () => 1,
    wantsMotion: () => true,
    viewRect: () => ({ x: -400, y: -300, w: 800, h: 600 }),
    tags: { occupied: () => [], show: vi.fn(), hide: vi.fn() },
    addDepthSource: (fn: () => { box: { id: string }; node: unknown }[]) => {
      sources.add(fn)
      return () => sources.delete(fn)
    },
    // the real scene runs depth.ts here; the test only needs the published boxes
    sortDepth: () => [...sources].flatMap((f) => f()),
  } as unknown as Scene & { sortDepth: () => void }
}

const publishedBoxes = (scene: Scene): { id: string }[] =>
  (scene as unknown as { sortDepth: () => { box: { id: string } }[] }).sortDepth().map((e) => e.box)

// every display object the layer put anywhere in the stack
const placed = (scene: Scene): InstanceType<typeof MockContainer>[] => {
  const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
  return LAYER_NAMES.flatMap((n) => l[n]!.children)
}

function makeBook(): { book: TextureBook; get: ReturnType<typeof vi.fn> } {
  const get = vi.fn((_url: string, _priority?: number) => new Promise<never>(() => {}))
  const book = { get, swap: vi.fn(() => new Promise<never>(() => {})) } as unknown as TextureBook
  return { book, get }
}

// ★ Measured: the codex catch-up landed about two seconds after the snapshot, and the layer's
// first tick beat it, so twelve gateway sheets were downloaded and twelve atlases replaced them.
describe('★ the codex is the manifest, so nothing is asked for ahead of it', () => {
  const routeAsks = (get: ReturnType<typeof vi.fn>): string[] =>
    get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/assets/character/'))

  it('★ asks for no sheet while the records are still on the wire, then asks once', () => {
    const { store, setAssetsSeq } = makeStore({ nadia: makeAgent('nadia', 3, 4) })
    setAssetsSeq(0)
    const { book, get } = makeBook()
    const layer = createCharacterLayer(makeScene(), book, store, () => {})
    layer.tick(1000)
    expect(routeAsks(get), 'the manifest has not arrived, so there is nothing to ask for').toEqual(
      [],
    )

    setAssetsSeq(1)
    layer.tick(1016)
    layer.tick(1032)
    expect(routeAsks(get)).toEqual(['/assets/character/nadia.png'])
    layer.destroy()
  })

  it('★ and a town whose codex holds nothing still gets its people, once a delta has landed', () => {
    const { store, setAssetsSeq, emit } = makeStore({ nadia: makeAgent('nadia', 3, 4) })
    setAssetsSeq(0)
    const { book, get } = makeBook()
    const layer = createCharacterLayer(makeScene(), book, store, () => {})
    layer.tick(1000)
    expect(routeAsks(get)).toEqual([])

    emit([]) // the catch-up rides the hello, so a delta with no records means there are none
    layer.tick(1016)
    expect(routeAsks(get)).toEqual(['/assets/character/nadia.png'])
    layer.destroy()
  })
})

// ★ Measured on six cold loads: twelve character atlases at 400 KB each asked with no rank at
// all, so they held every one of the six connections before the ground asked for a byte.
describe('★ a sheet is ranked by where its body stands in the shot', () => {
  it('★ asks near for a body the camera can see and far for one it cannot', () => {
    const agents = {
      inshot: makeAgent('inshot', 3, 4),
      offshot: makeAgent('offshot', 200, 200),
    }
    const { store } = makeStore(agents)
    const { book, get } = makeBook()
    const layer = createCharacterLayer(makeScene(), book, store, () => {})
    layer.tick(1000)
    const rankOf = (id: string): unknown =>
      get.mock.calls.find((c) => String(c[0]) === `/assets/character/${id}.png`)?.[1]
    expect(rankOf('inshot')).toBe(LOAD_PRIORITY.near)
    expect(rankOf('offshot')).toBe(LOAD_PRIORITY.far)
    layer.destroy()
  })
})

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
    // ★ The hover plate is ONE for the whole stage, owned by the tooltip layer, so a body
    // carries a sprite, a shadow, its overhead slot and its floor ring — and nothing else.
    expect(placed(scene)).toHaveLength(2 * 4)
  })

  it('puts each companion in the layer that owns it, never in the depth sort', () => {
    layer.tick(1000)
    const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    expect(l.shadow!.children).toHaveLength(2) // one contact shadow per body
    expect(l.entities!.children).toHaveLength(2) // ONLY the bodies are depth-sorted
    expect(l.worldText!.children).toHaveLength(2) // one overhead slot per body
  })

  it('publishes one depth box per living body, at its INTERPOLATED tile', () => {
    layer.tick(1000)
    const boxes = publishedBoxes(scene) as unknown as { id: string; x0: number; y0: number }[]
    expect(boxes.map((b) => b.id).sort()).toEqual(['nadia', 'omar'])
    const nadia = boxes.find((b) => b.id === 'nadia')!
    expect([nadia.x0, nadia.y0]).toEqual([2.5, 3.5]) // tile (3,4) spans [2.5,3.5]×[3.5,4.5]
  })

  it('places a hovered plate at the figure and inside the view (U10)', () => {
    layer.tick(1000)
    const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    const plate = l.worldText!.children[1] as unknown as {
      visible: boolean
      position: { x: number; y: number }
    }
    plate.visible = true
    layer.tick(1016)
    const view = { x: -400, y: -300, w: 800, h: 600 }
    expect(plate.position.x).toBeGreaterThanOrEqual(view.x)
    expect(plate.position.x).toBeLessThanOrEqual(view.x + view.w)
    expect(plate.position.y).toBeGreaterThanOrEqual(view.y)
    expect(plate.position.y).toBeLessThanOrEqual(view.y + view.h)
  })

  // The multiplier is re-applied by this layer, so tick order stops being load-bearing.
  // ★ WHAT WAS LEARNED: this axis carries TWO multipliers now. A standing body breathes as a
  // squash rather than a hop off its own shadow, so the pin is the composition of the effect
  // with that breath, inside the breath's own band.
  it('★ composes an effect multiplier with the scale it owns, and re-applies it every tick', () => {
    layer.tick(1000)
    const sprite = layer.getSprite('nadia')!
    const composed = (want: number, note?: string): void => {
      expect(sprite.scale.y, note).toBeGreaterThanOrEqual(want * (1 - IDLE_SQUASH))
      expect(sprite.scale.y, note).toBeLessThanOrEqual(want * (1 + IDLE_SQUASH))
    }
    layer.setScaleMulY('nadia', 0.92)
    composed(sprite.scale.x * 0.92)

    sprite.scale.set(2) // the layer's own write when a new atlas cell lands mid-effect
    layer.tick(1016)
    composed(2 * 0.92, 'the effect rides the NEW base, not the one it started on')

    layer.setScaleMulY('nadia', 1)
    composed(2)
  })

  it('ignores a multiplier for a body it does not have', () => {
    layer.tick(1000)
    expect(() => {
      layer.setScaleMulY('nobody', 0.5)
    }).not.toThrow()
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
    expect(charCalls.map(([url]) => String(url)).sort()).toEqual([
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
    const xs = screen.filter((_, i) => i % 2 === 0),
      ys = screen.filter((_, i) => i % 2 === 1)
    // U9: 28 wide at the shoulders and 48.9 tall, NOT the old 52 × 72 box
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(28, 9)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.94 * 52, 9)
    expect(Math.max(...ys)).toBeCloseTo(0, 9) // feet at the origin
  })

  it('companion objects are event-inert so they never swallow the sprite hit', () => {
    layer.tick(1000)
    const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    const shadow = l.shadow!.children[0] as unknown as { eventMode: string }
    const sprite = l.entities!.children[0] as unknown as { eventMode: string }
    const [emote, plate] = l.worldText!.children as unknown as { eventMode: string }[]
    expect(shadow.eventMode).toBe('none')
    expect(emote!.eventMode).toBe('none')
    expect(plate!.eventMode).toBe('none')
    expect(sprite.eventMode).toBe('static')
  })

  // ★ ONE OCCUPANCY. A person's plate goes through the same owner a building's does, so it is
  // placed by one rule and published where every other label can read it.
  it('asks the label layer for the hover plate, rather than keeping one per body', () => {
    layer.tick(1000)
    const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    const before = placed(scene).length
    const sprite = l.entities!.children[0] as unknown as {
      handlers: Record<string, () => void>
    }
    const tags = scene.tags as unknown as { show: Mock; hide: Mock }

    sprite.handlers.pointerover!()
    layer.tick(1016)
    expect(tags.show, 'the one owner every other label goes through').toHaveBeenCalledWith(
      'hover',
      expect.arrayContaining([expect.objectContaining({ text: 'nadia', tone: 'name' })]),
      expect.anything(),
    )
    expect(placed(scene), 'and no plate of its own is built for the body').toHaveLength(before)

    // ...and the head box it may flip above measures what is actually drawn up there
    const anchor = tags.show.mock.calls.at(-1)![2] as { sy: number; topY: number; halfW: number }
    expect(anchor.sy - anchor.topY).toBe(CHAR_TARGET_PX + SLOT_ABOVE_HEAD_PX + SLOT_PX)
    expect(anchor.halfW).toBe(SHOULDER_W / 2)

    sprite.handlers.pointerout!()
    expect(tags.hide).toHaveBeenCalledWith('hover')
  })

  // ★ Pixi v8's Texture registers a `resize` listener on its source through the constructor's
  // own setter, and only `destroy()` takes it off. An uncached slice therefore leaves a
  // permanent listener AND a strong reference on the long-lived atlas, per kind change.
  it('★ cuts an emote frame once for the layer, not once per kind change', async () => {
    const bodies: MutableAgents = { nadia: makeBodyAgent('nadia', 3, 4) }
    const own = makeScene()
    const { store } = makeStore(bodies)
    const l = createCharacterLayer(own, loadedBook(), store, () => {})
    await Promise.resolve()
    await Promise.resolve() // the emote atlas lands off the book
    l.tick(1000)

    const body = bodies.nadia!
    const glyph = (own.layers.worldText as unknown as { children: { children: unknown[] }[] })
      .children[0]!
    const wear = (over: Record<string, unknown>, ms: number): void => {
      Object.assign(body, over)
      l.tick(ms)
    }
    const frames = new Set<string>()
    cut.textures = 0
    for (let i = 0; i < 20; i++) {
      for (const [j, over] of [
        { asleep: true, ill: false, needs: NEEDS_WELL },
        { asleep: false, ill: false, needs: NEEDS_HUNGRY },
        { asleep: false, ill: true, needs: NEEDS_WELL },
      ].entries()) {
        wear(over, 2000 + i * 60 + j * 20)
        const t = (glyph.children[1] as { texture?: { frame?: { x: number } } } | undefined)
          ?.texture
        frames.add(JSON.stringify(t?.frame ?? null))
      }
    }
    // not vacuous: the slot really did wear three different frames over those sixty changes
    expect(frames.size, 'sleep, hunger and exclaim are three different cells').toBe(3)
    expect(cut.textures, 'sixty kind changes, three frames').toBe(3)
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
// THE WALK, DRIVEN THROUGH THE REAL LAYER
// `charAnim.test.ts` proves the rules; these prove the LAYER CALLS THEM.
// ══════════════════════════════════════════════════════════════════════════════════════════

const NEEDS_WELL = { hunger: 90, energy: 90, warmth: 90, social: 90 }
const NEEDS_HUNGRY = { hunger: 5, energy: 90, warmth: 90, social: 90 }

function makeBodyAgent(
  id: string,
  x: number,
  y: number,
  needs = NEEDS_WELL,
): MutableAgents[string] {
  return { ...makeAgent(id, x, y), needs } as MutableAgents[string]
}

/** A book whose sheets are already loaded, so the pose reaches the sprite. */
function loadedBook(): TextureBook {
  const tex = new MockTexture({ source: { label: 'sheet' } as never })
  return {
    get: () => Promise.resolve(tex),
    swap: () => Promise.resolve(tex),
  } as unknown as TextureBook
}

it('uses demo-sized exterior figures without shrinking the Pixi figures', async () => {
  for (const spatial of [false, true]) {
    const scene = makeScene()
    scene.spatial = spatial
    const { store } = makeStore({ nadia: makeBodyAgent('nadia', 3, 4) })
    const state = store.getState()!
    store.getState = () => ({ ...state, structures: {} })
    const layer = createCharacterLayer(scene, loadedBook(), store, () => {})
    layer.tick(1000)
    await Promise.resolve()
    await Promise.resolve()
    layer.tick(1016)
    expect(layer.getSprite('nadia')!.scale.x * 64).toBeCloseTo(spatial ? 40 : 52)
    layer.destroy()
  }
})

/** Which of the six sheet rows a body is drawn on, read off the slice rectangle. */
function drawnRow(layer: ReturnType<typeof createCharacterLayer>, id: string): string | null {
  const s = layer.getSprite(id) as unknown as { texture: { frame?: { y: number } } } | null
  const y = s?.texture.frame?.y
  return y === undefined ? null : (SHEET_ROWS[y / CELL] ?? null)
}

/** Where the layer is DRAWING the body, in tiles, read back off its published depth box. */
function drawnTile(scene: Scene, id: string): { x: number; y: number } {
  const b = (publishedBoxes(scene) as unknown as { id: string; x0: number; y0: number }[]).find(
    (q) => q.id === id,
  )!
  return { x: b.x0 + 0.5, y: b.y0 + 0.5 }
}

describe("★ the layer walks each body at the record's pace, not a stopwatch's", () => {
  const config = {
    needs: { debuffThreshold: 30 },
    movement: { baseTilesPerTick: 3, debuffTilesPerTick: 2 },
  }

  // The layer reads the wall clock in `onEvents` and the frame's own clock in `tick`; StageMount
  // drives the second with `performance.now()`, so in the product they are ONE clock.
  let clockMs = 0
  beforeEach(() => {
    clockMs = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clockMs)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function rig(agents: MutableAgents): Promise<{
    scene: Scene
    layer: ReturnType<typeof createCharacterLayer>
    emit: (evts: SimEvent[]) => void
    at: (ms: number, evts?: SimEvent[]) => void
    setMoving: (v: boolean) => void
  }> {
    const scene = makeScene()
    const { store, emit, setMoving } = makeStore(agents)
    ;(store as unknown as { getConfig: () => unknown }).getConfig = () => config
    const layer = createCharacterLayer(scene, loadedBook(), store, () => {})
    await Promise.resolve()
    await Promise.resolve() // let the sheets land on the entries
    layer.tick(0)
    await Promise.resolve()
    await Promise.resolve()
    const at = (ms: number, evts?: SimEvent[]): void => {
      clockMs = ms
      if (evts !== undefined) emit(evts)
      layer.tick(ms)
    }
    return { scene, layer, emit, at, setMoving }
  }

  const moved = (id: string, x: number, y: number, tick: number): SimEvent =>
    ({ type: 'agent_moved', tick, payload: { id, x, y } }) as unknown as SimEvent

  it('faces the visible motion when leaving a settled crowd', async () => {
    const agents: MutableAgents = {
      amara: makeBodyAgent('amara', 0, 0),
      kamal: makeBodyAgent('kamal', 0, 0),
      nadia: makeBodyAgent('nadia', 0, 0),
    }
    const { layer, at } = await rig(agents)
    at(180)
    agents.nadia!.x = 1
    at(400, [moved('nadia', 1, 0, 1)])
    const before = layer.getSprite('nadia')!.position.x
    at(430)
    const sprite = layer.getSprite('nadia')!
    const texture = sprite.texture as unknown as { frame: { x: number } }
    expect(sprite.position.x).toBeLessThan(before)
    expect(FACINGS[texture.frame.x / CELL]).toBe('sw')
  })

  // ★ The guard used to ask "is this live?". A replay is not live and its bodies must still walk;
  // only a STILL scrub is a fact to be drawn where the record put it.
  it('★ a replay walks a body, and only a still scrub drops it on the record tile', () => {
    return (async () => {
      const agents: MutableAgents = { nadia: makeBodyAgent('nadia', 0, 0) }
      const { scene, at, setMoving } = await rig(agents)
      agents.nadia!.x = 1
      at(400, [moved('nadia', 1, 0, 1)])
      agents.nadia!.x = 2
      at(800, [moved('nadia', 2, 0, 2)])
      agents.nadia!.x = 3
      at(1200, [moved('nadia', 3, 0, 3)])
      // time is moving: the body is on its way to the tile the record already names
      expect(drawnTile(scene, 'nadia').x).toBeLessThan(3)

      setMoving(false)
      at(1200)
      expect(drawnTile(scene, 'nadia').x).toBeCloseTo(3, 3)
    })()
  })

  it('★ a body that stood still for a minute does NOT spend four seconds on its next tile', () => {
    return (async () => {
      const agents: MutableAgents = { nadia: makeBodyAgent('nadia', 0, 0) }
      const { scene, at } = await rig(agents)
      // two ticks so the clock learns 400 ms
      agents.nadia!.x = 1
      at(400, [moved('nadia', 1, 0, 1)])
      agents.nadia!.x = 2
      at(800, [moved('nadia', 2, 0, 2)])
      for (let t = 800; t <= 60_000; t += 400) at(t) // then a minute of standing still
      expect(drawnTile(scene, 'nadia').x).toBeCloseTo(2, 3)
      // and it walks again: ONE tick later it has arrived, where the landed glide would have
      // put it a tenth of the way along a four-second crawl
      agents.nadia!.x = 3
      at(60_000, [moved('nadia', 3, 0, 150)])
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
      at(1400) // half way through the next leg
      const wellGone = drawnTile(scene, 'well').x - drawnTile(scene, 'weak').x
      expect(wellGone).toBeGreaterThan(0.2) // the well body is measurably further along
    })()
  })

  it('★ three bodies walking at the same instant are NOT on the same frame', () => {
    return (async () => {
      const ids = ['nadia', 'omar', 'yusuf']
      const agents: MutableAgents = Object.fromEntries(
        ids.map((id) => [id, makeBodyAgent(id, 0, 0)]),
      )
      const { layer, at } = await rig(agents)
      let differed = 0,
        sampled = 0
      for (let i = 1; i <= 14; i++) {
        for (const id of ids) agents[id]!.x = i
        at(
          i * 400,
          ids.map((id) => moved(id, i, 0, i)),
        )
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
          ids.map((id) => [id, makeBodyAgent(id, 0, 0)]),
        )
        const { layer, at } = await rig(agents)
        const out: string[] = []
        for (let i = 1; i <= 8; i++) {
          for (const id of ids) agents[id]!.x = i
          at(
            i * 400,
            ids.map((id) => moved(id, i, 0, i)),
          )
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
      expect(new Set(a).size).toBeGreaterThan(1) // and it is not one frozen frame
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

  // ★ The idle breath was a floored two-state hop on the sprite's POSITION while the shadow
  // stayed at the feet, so a standing body jumped off its own shadow 1.11 times a second and
  // the camera scaled that by up to 4. It is a squash now, and this is the pin.
  it('★ a standing body breathes without leaving its own shadow', () => {
    return (async () => {
      const agents: MutableAgents = { nadia: makeBodyAgent('nadia', 0, 0) }
      const { scene, layer, at } = await rig(agents)
      const l = scene.layers as unknown as Record<
        string,
        { children: { position: { y: number } }[] }
      >
      const heights = new Set<number>()
      for (let ms = 0; ms <= 6000; ms += 50) {
        at(ms)
        const s = layer.getSprite('nadia') as unknown as {
          position: { y: number }
          scale: { y: number }
        }
        expect(s.position.y - l.shadow!.children[0]!.position.y, `${ms}ms`).toBe(0)
        heights.add(s.scale.y)
      }
      expect(heights.size, 'and it is still alive: the breath is on the scale').toBeGreaterThan(1)
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
      await Promise.resolve()
      await Promise.resolve()
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
          const l = scene.layers as unknown as Record<
            string,
            { children: { position: { y: number } }[] }
          >
          expect(s.position.y - l.shadow!.children[0]!.position.y).toBe(0)
        }
      }
      rows.delete(null)
      rows.delete('idle')
      expect(rows.size).toBeGreaterThan(1) // the person is still walking
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
  const sprites = (): { x: number; y: number }[] => {
    const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    return l.entities!.children.map((c) => ({ x: c.position.x, y: c.position.y }))
  }

  it('★ THE RED — four bodies at one door are drawn at four points, not one', () => {
    layer.tick(1000)
    layer.tick(2000) // past CROWD_SETTLE_MS: the rank has formed
    const at = sprites()
    expect(at).toHaveLength(4)
    expect(new Set(at.map((p) => `${p.x},${p.y}`)).size).toBe(4)
  })

  it('and the depth box follows the sprite, so the sort and the cull see the drawn place', () => {
    layer.tick(1000)
    layer.tick(2000)
    const boxes = publishedBoxes(scene) as unknown as {
      id: string
      x0: number
      y0: number
      sx0: number
    }[]
    expect(new Set(boxes.map((b) => `${b.x0},${b.y0}`)).size).toBe(4)
    const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    for (const b of boxes) {
      const sprite = l.entities!.children[NAMES.indexOf(b.id)]!
      expect(b.sx0).toBeCloseTo(sprite.position.x - BODY_SPRITE_W / 2, 6)
    }
  })

  it('the shadow and the overhead slot move with the body', () => {
    layer.tick(1000)
    layer.tick(2000)
    const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    const { sx } = tileToScreen(103, 77)
    for (let i = 0; i < NAMES.length; i++) {
      const sprite = l.entities!.children[i]!
      // non-vacuous: this body is NOT where the record put it, and its companions came along
      expect(sprite.position.x).not.toBe(sx)
      expect(l.shadow!.children[i]!.position.x).toBe(sprite.position.x)
      expect(l.worldText!.children[i]!.position.x).toBe(sprite.position.x)
    }
  })

  it('★ ONE body on a tile is left exactly where the record puts it', () => {
    for (const n of NAMES.slice(1)) Reflect.deleteProperty(agents, n)
    layer.tick(1000)
    layer.tick(2000)
    const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    const { sx, sy } = feetOf(103, 77)
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
    const at = (
      still.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    ).entities!.children.map((c) => c.position.x)
    expect(new Set(at).size).toBe(4) // arrived on the very first frame
    l2.destroy()
  })
})

// ── A MISSING CELL MUST NOT POINT A BODY THE WRONG WAY ────────────────────────────────────
// Leaving `sprite.texture` alone keeps the last facing that HAD a cell, so `characterCell`
// degrades inside the facing instead (`charAnim.cellRowLadder`).

describe('characterCell degrades inside its own facing, never across one', () => {
  const CELLS = ['idle', 'contact-a', 'passing-a', 'contact-b', 'passing-b', 'sleep'] as const
  const FACES = ['sw', 'se', 'ne', 'nw'] as const

  // a manifest whose rects encode which cell they are, so the texture handed back is identifiable
  const artWithout = (absent: readonly string[]): Parameters<typeof characterCell>[1] => {
    const cells: Record<
      string,
      { x: number; y: number; w: number; h: number; feetX: number; feetY: number }
    > = {}
    FACES.forEach((f, fi) => {
      CELLS.forEach((p, pi) => {
        if (absent.includes(`${p}-${f}`)) return
        cells[`${p}-${f}`] = { x: pi * 100, y: fi * 200, w: 100, h: 200, feetX: 50, feetY: 199 }
      })
    })
    return {
      url: '/a.png',
      manifest: { version: 'v4-hires-atlas', figureH: 180, cells },
      size: { w: 600, h: 800 },
    }
  }
  const sheet = new MockTexture()
  const nameOf = (t: unknown): string => {
    const f = (t as { frame: { x: number; y: number } }).frame
    return `${CELLS[f.x / 100]}-${FACES[f.y / 200]}`
  }

  it('hands back the cell it was asked for when the sheet has it', () => {
    expect(nameOf(characterCell(sheet, artWithout([]), 'contact-b', 'ne')!.texture)).toBe(
      'contact-b-ne',
    )
  })

  it('★ falls back to another frame of the SAME facing, for every facing and every row', () => {
    for (const f of FACES)
      for (const p of CELLS) {
        const c = characterCell(sheet, artWithout([`${p}-${f}`]), p, f)
        expect(c, `${p}-${f} with a hole draws nothing at all`).not.toBeNull()
        expect(
          nameOf(c!.texture).endsWith(`-${f}`),
          `${p}-${f} borrowed ${nameOf(c!.texture)}`,
        ).toBe(true)
      }
  })

  it('★ keeps the facing even when a whole walk loop is missing and only idle is left', () => {
    const gutted = ['contact-a-ne', 'passing-a-ne', 'contact-b-ne', 'passing-b-ne'] as const
    for (const name of gutted) {
      const row = name.slice(0, -3) as (typeof CELLS)[number]
      expect(nameOf(characterCell(sheet, artWithout(gutted), row, 'ne')!.texture)).toBe('idle-ne')
    }
  })

  it('is null — not another direction — when the facing has nothing at all', () => {
    const none = CELLS.map((p) => `${p}-ne`)
    expect(characterCell(sheet, artWithout(none), 'idle', 'ne')).toBeNull()
  })

  it("carries the sheet's own figure height, so a caller sizes off the art", () => {
    expect(characterCell(sheet, artWithout([]), 'idle', 'sw')!.figureH).toBe(180)
  })
})

// ── FIVE ON ONE TILE ARE FIVE TARGETS, THROUGH THE REAL LAYER ─────────────────────────────
// The bodies genuinely overlap — a 14 px pitch against 28 px of shoulder — so "five targets"
// means each has somewhere on screen where it is front-most, by the same `depthOrder` that
// made the pixels.

function containsPoly(points: number[], px: number, py: number): boolean {
  let inside = false
  const n = points.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[i * 2]!,
      yi = points[i * 2 + 1]!
    const xj = points[j * 2]!,
      yj = points[j * 2 + 1]!
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

type MockSpriteT = {
  position: { x: number; y: number }
  scale: { x: number }
  hitArea: { points: number[] } | null
}
/** `Scene.sortDepth` returns `void` in the product; the mock returns the entries, so the type has to be replaced rather than intersected. */
type PickScene = Omit<Scene, 'sortDepth' | 'getZoom' | 'getZoomStop'> & {
  sortDepth: () => { box: DepthBox; node: MockSpriteT }[]
  getZoom: () => number
  getZoomStop: () => ZoomStop
}

describe('★ five people on one tile are five separate hit targets', () => {
  const NAMES = ['amara', 'nadia', 'omar', 'salma', 'yusuf']

  /** A scene whose zoom the test can move, so the 24 px floor is exercised where it is live. */
  function zoomableScene(zoom: ZoomStop): PickScene {
    const s = makeScene() as unknown as PickScene
    s.getZoom = () => zoom
    s.getZoomStop = () => zoom
    return s
  }

  /** Pixi's pick, restated: the point goes into the sprite's LOCAL space (dividing the sprite scale back out of the hitArea) and the front-most capsule containing it wins. */
  function pickAt(scene: PickScene, sx: number, sy: number): string | null {
    const entries = scene.sortDepth()
    const order = depthOrder(entries.map((e) => e.box))
    let best: string | null = null,
      bestI = -1
    for (const e of entries) {
      const pts = e.node.hitArea?.points
      if (pts === undefined) continue
      const k = e.node.scale.x || 1
      if (!containsPoly(pts, (sx - e.node.position.x) / k, (sy - e.node.position.y) / k)) continue
      const i = order.indexOf(e.box.id)
      if (i > bestI) {
        bestI = i
        best = e.box.id
      }
    }
    return best
  }

  /** Which screen-x COLUMNS each body owns. A rank divides the pointer left to right, so the height is free to take the floor — nobody stands above anybody. */
  function ownedColumns(scene: PickScene): Map<string, { n: number; x0: number; x1: number }> {
    const out = new Map<string, { n: number; x0: number; x1: number }>()
    const { sx, sy } = tileToScreen(103, 77)
    for (let dx = -160; dx <= 160; dx++) {
      const owner = new Set<string>()
      for (let dy = -140; dy <= 40; dy++) {
        const id = pickAt(scene, sx + dx, sy + dy)
        if (id !== null) owner.add(id)
      }
      for (const id of owner) {
        const s = out.get(id)
        if (s === undefined) out.set(id, { n: 1, x0: dx, x1: dx })
        else {
          s.n++
          s.x1 = dx
        }
      }
    }
    return out
  }

  it('★ THE RED, and it is the whole task: five bodies, five ids, none of them lost', () => {
    const scene = zoomableScene(1)
    const agents = Object.fromEntries(NAMES.map((n) => [n, makeAgent(n, 103, 77)]))
    const layer = createCharacterLayer(scene, makeBook().book, makeStore(agents).store, () => {})
    layer.tick(1000)
    layer.tick(2000)
    const owned = ownedColumns(scene)
    expect([...owned.keys()].sort()).toEqual([...NAMES].sort())
    for (const n of NAMES) expect(owned.get(n)!.n, `${n} owns nothing`).toBeGreaterThan(0)
    layer.destroy()
  })

  // "Each of the five owns at least one pixel" passes with the cap deleted: inflating five
  // identical shapes about their own centroids leaves each of them a sliver somewhere. What the
  // cap protects is that a body's target never reaches outside the body.
  it("★ no body's target reaches outside its own SHOULDERS, at any zoom stop", () => {
    for (const z of ZOOM_STOPS) {
      const scene = zoomableScene(z)
      const agents = Object.fromEntries(NAMES.map((n) => [n, makeAgent(n, 103, 77)]))
      const layer = createCharacterLayer(scene, makeBook().book, makeStore(agents).store, () => {})
      layer.tick(1000)
      layer.tick(2000)
      const owned = ownedColumns(scene)
      const at = tileToScreen(103, 77)
      const drawnX = new Map(scene.sortDepth().map((e) => [e.box.id, e.node.position.x - at.sx]))
      expect([...owned.keys()].sort(), `zoom ${z}`).toEqual([...NAMES].sort())
      for (const n of NAMES) {
        const own = owned.get(n)!
        const centre = drawnX.get(n)!
        expect(own.n, `${n} owns nothing at ${z}×`).toBeGreaterThan(0)
        expect(own.x0, `${n} reaches left of its shoulders at ${z}×`).toBeGreaterThanOrEqual(
          centre - SHOULDER_W / 2 - 1,
        )
        expect(own.x1, `${n} reaches right of its shoulders at ${z}×`).toBeLessThanOrEqual(
          centre + SHOULDER_W / 2 + 1,
        )
      }
      layer.destroy()
    }
  })

  it('★ AND THE ARITHMETIC BEHIND THE CAP: 24 px is seven pitches at the overview stop', () => {
    // Why the cap exists, said in numbers rather than in a source read. Without it a capsule is
    // grown to 24 screen px against a 3.5 px pitch — wider, on its own, than the whole rank.
    const grown = inflateToMin(
      bodyHitPolygon(64, CHAR_TARGET_PX / 64),
      HIT_MIN_PX,
      (CHAR_TARGET_PX / 64) * 0.25,
    )
    const width = polygonBounds(grown).w * (CHAR_TARGET_PX / 64) * 0.25
    expect(width).toBeGreaterThanOrEqual(HIT_MIN_PX)
    expect(width).toBeGreaterThan(CROWD_PITCH_PX * 0.25 * (NAMES.length - 1))
  })

  it('a LONE body is not capped — it takes the whole floor, because it has the room', () => {
    const scene = zoomableScene(0.25)
    const agents = { omar: makeAgent('omar', 103, 77) }
    const layer = createCharacterLayer(scene, makeBook().book, makeStore(agents).store, () => {})
    layer.tick(1000)
    const node = scene.sortDepth()[0]!.node
    const k = (CHAR_TARGET_PX / 64) * 0.25
    expect(polygonBounds(node.hitArea!.points).w * k).toBeGreaterThanOrEqual(HIT_MIN_PX - 1e-9)
    layer.destroy()
  })

  it('★ and the pick is the FRONT one where they overlap, never the one behind it', () => {
    const scene = zoomableScene(1)
    const agents = Object.fromEntries(NAMES.map((n) => [n, makeAgent(n, 103, 77)]))
    const layer = createCharacterLayer(scene, makeBook().book, makeStore(agents).store, () => {})
    layer.tick(1000)
    layer.tick(2000)
    const entries = scene.sortDepth()
    const order = depthOrder(entries.map((e) => e.box))
    const { sx, sy } = tileToScreen(103, 77)
    let checked = 0
    for (let dx = -120; dx <= 120; dx++) {
      for (let dy = -90; dy <= 30; dy++) {
        const hits = entries.filter(
          (e) =>
            e.node.hitArea !== null &&
            containsPoly(
              e.node.hitArea.points,
              (sx + dx - e.node.position.x) / (e.node.scale.x || 1),
              (sy + dy - e.node.position.y) / (e.node.scale.x || 1),
            ),
        )
        if (hits.length < 2) continue
        checked++
        const won = pickAt(scene, sx + dx, sy + dy)
        const last = hits.map((e) => order.indexOf(e.box.id)).reduce((a, b) => Math.max(a, b))
        expect(won).toBe(order[last])
      }
    }
    expect(checked, 'the capsules never overlapped — this test proved nothing').toBeGreaterThan(500)
    layer.destroy()
  })
})

// ★ A scene's turn-taking is on the BODIES, not only in the boxes over them: the ring says who
// is holding the floor and the shoulders say the two of them are talking to each other.
describe('★ the floor ring and the facing, through the real layer', () => {
  const FADE_MS = 200 // longer than the reveal band, so the fade has finished

  let clockMs = 0
  beforeEach(() => {
    clockMs = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clockMs)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const spoke = (agentId: string, x: number, y: number): SimEvent =>
    ({ type: 'agent_spoke', tick: 1, payload: { agentId, x, y, text: 'a line' } }) as SimEvent

  const openScene = (participants: string[]): TownScene => ({
    id: 'sc_1',
    kind: 'talk',
    participants,
    topic: 'the well',
    stakes: 4,
    open: true,
  })

  /** The floor rings in the ground layer, in the order the bodies were made: amara, then salma. */
  const rings = (scene: Scene): { alpha: number; visible: boolean }[] =>
    (scene.layers as unknown as Record<string, { children: { alpha: number; visible: boolean }[] }>)
      .groundDecal!.children

  type Drawn = {
    position: { x: number; y: number }
    scale: { y: number }
    lastStroke: { width?: number; color?: number } | null
  }
  const drawnRing = (scene: Scene): Drawn =>
    (scene.layers as unknown as Record<string, { children: Drawn[] }>).groundDecal!.children[0]!
  const drawnBody = (scene: Scene): Drawn =>
    (scene.layers as unknown as Record<string, { children: Drawn[] }>).entities!.children[0]!

  const facingOf = (layer: ReturnType<typeof createCharacterLayer>, id: string): string | null => {
    const s = layer.getSprite(id) as unknown as { texture: { frame?: { x: number } } } | null
    const x = s?.texture.frame?.x
    return x === undefined ? null : (FACINGS[x / CELL] ?? null)
  }

  async function rig(): Promise<{
    scene: Scene
    layer: ReturnType<typeof createCharacterLayer>
    setScene: (s: TownScene | null) => void
    say: (who: string, x: number, atMs: number) => void
    line: (agentId: string, move: string, atMs: number) => void
    talk: (participants: string[], atMs: number) => void
  }> {
    // Two tiles apart on one row, so their facings are opposite and unambiguous.
    const agents: MutableAgents = {
      amara: makeBodyAgent('amara', 0, 0),
      salma: makeBodyAgent('salma', 2, 0),
    }
    const scene = makeScene()
    const { store, emit, setScene } = makeStore(agents)
    ;(store as unknown as { getConfig: () => unknown }).getConfig = () => null
    const layer = createCharacterLayer(scene, loadedBook(), store, () => {})
    layer.tick(0)
    await Promise.resolve()
    await Promise.resolve()
    layer.tick(0)
    return {
      scene,
      layer,
      setScene,
      say: (who, x, atMs) => {
        clockMs = atMs
        emit([spoke(who, x, 0)])
        layer.tick(atMs)
        layer.tick(atMs + FADE_MS)
      },
      talk: (participants, atMs) => {
        clockMs = atMs
        emit([
          {
            seq: 1,
            tick: 1,
            type: 'scene_opened',
            payload: { id: 'sc_1', kind: 'talk', participants, topic: null, stakes: 4 },
          },
        ])
      },
      line: (agentId, move, atMs) => {
        clockMs = atMs
        emit([
          {
            seq: 1,
            tick: 1,
            type: 'scene_line',
            payload: { id: 'sc_1', agentId, text: 'Well.', move },
          },
        ])
      },
    }
  }

  it('★ rings nobody until a scene is open, whoever is talking', async () => {
    const { scene, say } = await rig()
    say('amara', 0, 1000)
    expect(rings(scene).map((r) => r.alpha)).toEqual([0, 0])
    expect(rings(scene).every((r) => !r.visible)).toBe(true)
  })

  it('★ moves the ring from body to body as the exchange alternates', async () => {
    const { scene, setScene, say } = await rig()
    setScene(openScene(['amara', 'salma']))

    say('amara', 0, 1000)
    expect(rings(scene).map((r) => r.alpha)).toEqual([1, 0])

    say('salma', 2, 2000)
    expect(rings(scene).map((r) => r.alpha)).toEqual([0, 1])

    say('amara', 0, 3000)
    expect(rings(scene).map((r) => r.alpha)).toEqual([1, 0])
  })

  // ★ WHAT WAS LEARNED: drawing a standing `ne` or `nw` as `se` or `sw` was refused. The screen
  // may not state a facing the world does not hold, and it stopped these two looking at each
  // other. Faceless back cells are a reason to commission art, never to draw another world.
  it('★ turns the two of them toward each other while the scene runs', async () => {
    const { layer, setScene, say } = await rig()
    setScene(openScene(['amara', 'salma']))
    // amara at (0,0) and salma at (2,0): each faces the other across the screen's x
    say('amara', 0, 1000)
    expect(facingOf(layer, 'salma')).toBe('nw')
    say('salma', 2, 2000)
    expect(facingOf(layer, 'amara')).toBe('se')
    expect(facingOf(layer, 'salma')).toBe('nw')
  })

  // ★ A body kept the direction of its last walk leg for the whole act, so it worked facing
  // wherever it happened to arrive from rather than facing the work.
  it('★ faces the work, not wherever it last walked from', async () => {
    const agents: MutableAgents = { omar: makeBodyAgent('omar', 4, 4) }
    const scene = makeScene()
    const { store } = makeStore(agents)
    ;(store as unknown as { getConfig: () => unknown }).getConfig = () => null
    const layer = createCharacterLayer(scene, loadedBook(), store, () => {})
    layer.tick(0)
    await Promise.resolve()
    await Promise.resolve()

    const doing = (verb: string, params: Record<string, unknown>): void => {
      ;(agents.omar as unknown as { activity: unknown }).activity = {
        verb,
        ticksRemaining: 30,
        params,
      }
    }

    // the tile he is tilling is one step east: the screen puts it down and to the right
    doing('till', { x: 5, y: 4 })
    layer.tick(100)
    expect(facingOf(layer, 'omar')).toBe('se')

    // and one step north, which the world calls a back, so a back is what is drawn
    doing('till', { x: 4, y: 3 })
    layer.tick(200)
    expect(facingOf(layer, 'omar')).toBe('ne')

    // the person he is giving to outranks any tile the act also names
    agents.salma = makeBodyAgent('salma', 0, 4)
    doing('give', { targetId: 'salma', itemId: 'it_1', x: 5, y: 4 })
    layer.tick(300)
    expect(facingOf(layer, 'omar')).toBe('nw')
  })

  it('turns with a short cross-fade, so a facing change is not an atlas swap', async () => {
    const agents: MutableAgents = {
      omar: makeBodyAgent('omar', 4, 4),
      salma: makeBodyAgent('salma', 0, 4),
    }
    const scene = makeScene()
    const { store } = makeStore(agents)
    ;(store as unknown as { getConfig: () => unknown }).getConfig = () => null
    const layer = createCharacterLayer(scene, loadedBook(), store, () => {})
    layer.tick(0)
    await Promise.resolve()
    await Promise.resolve()
    const doing = (verb: string, params: Record<string, unknown>): void => {
      ;(agents.omar as unknown as { activity: unknown }).activity = {
        verb,
        ticksRemaining: 30,
        params,
      }
    }
    const ghost = (): { visible: boolean; alpha: number; texture: { frame?: { x: number } } } =>
      (
        layer.getSprite('omar') as unknown as {
          children: { visible: boolean; alpha: number; texture: { frame?: { x: number } } }[]
        }
      ).children[0]!

    doing('till', { x: 5, y: 4 })
    layer.tick(100)
    expect(ghost().visible, 'the first cell a body is drawn on is not a turn').toBe(false)

    doing('give', { targetId: 'salma', itemId: 'it_1' })
    layer.tick(200)
    expect(facingOf(layer, 'omar')).toBe('nw')
    expect(ghost().visible).toBe(true)
    expect(FACINGS[ghost().texture.frame!.x / CELL], 'the facing being left').toBe('se')

    layer.tick(245)
    expect(ghost().alpha).toBeCloseTo(0.5, 2)
    layer.tick(290)
    expect(ghost().visible).toBe(false)
  })

  it('★ takes the ring back when the scene closes', async () => {
    const { scene, setScene, say } = await rig()
    setScene(openScene(['amara', 'salma']))
    say('amara', 0, 1000)
    expect(rings(scene)[0]!.alpha).toBe(1)

    setScene({ ...openScene(['amara', 'salma']), open: false, summary: 'They agreed.' })
    say('amara', 0, 2000)
    expect(rings(scene).map((r) => r.alpha)).toEqual([0, 0])
  })

  it('drains the two bodies a turn was between, and gives their colour back', async () => {
    const { layer, setScene, line, talk } = await rig()
    setScene(openScene(['amara', 'salma']))
    talk(['amara', 'salma'], 1000)
    line('amara', 'press', 1000)
    line('amara', 'press', 1000)
    line('amara', 'press', 1000)
    layer.tick(1000)
    expect(layer.getSprite('salma')!.tint).toBe(0xffffff)
    line('salma', 'give_way', 1000)
    layer.tick(1000)
    expect(layer.getSprite('salma')!.tint, 'the one who folded').not.toBe(0xffffff)
    expect(layer.getSprite('amara')!.tint, 'and the one who pushed').not.toBe(0xffffff)
    layer.tick(1000 + TENSION_DESATURATE_MS)
    expect(layer.getSprite('salma')!.tint).toBe(0xffffff)
    expect(layer.getSprite('amara')!.tint).toBe(0xffffff)
  })

  it('rings nobody in a scene where nobody has spoken yet', async () => {
    const { scene, layer, setScene } = await rig()
    setScene(openScene(['amara', 'salma']))
    layer.tick(1000)
    layer.tick(1000 + FADE_MS)
    expect(rings(scene).map((r) => r.alpha)).toEqual([0, 0])
  })

  it('★ is one pixel of honey on the GROUND point, never on the bobbing body', async () => {
    const { scene, layer, setScene, say } = await rig()
    setScene(openScene(['amara', 'salma']))
    say('amara', 0, 1000)
    const ring = drawnRing(scene)
    expect(ring.lastStroke).toEqual({ width: 1, color: 0xf2c879 }) // --honey, the one accent
    const resting = { x: ring.position.x, y: ring.position.y }
    const breathed = new Set<number>()
    for (let ms = 1000; ms < 7000; ms += 60) {
      layer.tick(ms)
      breathed.add(drawnBody(scene).scale.y)
      const at = drawnRing(scene).position
      expect([at.x, at.y], `${ms}ms`).toEqual([resting.x, resting.y])
    }
    expect(breathed.size, 'not vacuous: the body really was breathing').toBeGreaterThan(1)
  })
})

// ── ★ GOLDEN HOUR ON THE GROUND (task 18) ────────────────────────────────────────────────

describe('★ the contact shadow reads the sun the arc draws', () => {
  type Node = { alpha: number; position: { x: number; y: number }; scale: { x: number; y: number } }
  const HOURS = [6 * 60, 7 * 60, 12 * 60, 19 * 60, 20 * 60, 0]

  /** The layer, driven a frame at a time with the town's clock under the test's hand. */
  async function sundial(): Promise<{
    at: (minuteOfDay: number) => { sprite: Node; shadow: Node }
  }> {
    const agents: MutableAgents = { nadia: makeBodyAgent('nadia', 3, 4) }
    const scene = makeScene()
    const { store, setTick } = makeStore(agents)
    const layer = createCharacterLayer(scene, loadedBook(), store, () => {})
    await Promise.resolve()
    await Promise.resolve()
    let ms = 0
    const l = scene.layers as unknown as Record<string, InstanceType<typeof MockContainer>>
    return {
      at: (minuteOfDay) => {
        setTick(minuteOfDay)
        ms += 400
        layer.tick(ms)
        // read off, not held: the layer writes to the same two nodes every frame
        const snap = (n: Node): Node => ({
          alpha: n.alpha,
          position: { x: n.position.x, y: n.position.y },
          scale: { x: n.scale.x, y: n.scale.y },
        })
        return {
          sprite: snap(l.entities!.children[0] as unknown as Node),
          shadow: snap(l.shadow!.children[0] as unknown as Node),
        }
      },
    }
  }

  it('★ takes the cast off `skyModel`, so the arc and the ground agree about the hour', async () => {
    const dial = await sundial()
    const ratios = new Set<string>()
    for (const minute of HOURS) {
      const sun = shadowCast(minute)
      const { sprite, shadow } = dial.at(minute)
      const why = `minute ${minute}`
      expect(shadow.position.x - sprite.position.x, why).toBeCloseTo(sun.dx, 6)
      expect(shadow.position.y, why).toBe(sprite.position.y)
      expect([shadow.scale.x, shadow.scale.y], why).toEqual([sun.scaleX, sun.scaleY])
      ratios.add((shadow.alpha / sun.alpha).toFixed(9))
    }
    expect(ratios.size, 'one constant turns the sun into ink').toBe(1)
    expect(Number([...ratios][0])).toBeLessThan(1)
  })

  it('★ the golden hour draws it out and lays it away from the light', async () => {
    const dial = await sundial()
    const dawn = dial.at(6 * 60)
    const noon = dial.at(12 * 60)
    const dusk = dial.at(20 * 60)
    expect(noon.shadow.scale.x, 'noon puts it back under the feet').toBe(1)
    expect(dawn.shadow.scale.x).toBeGreaterThan(1)
    expect(dusk.shadow.scale.x).toBeGreaterThan(1)
    const dawnDx = dawn.shadow.position.x - dawn.sprite.position.x
    const duskDx = dusk.shadow.position.x - dusk.sprite.position.x
    expect(dawnDx * duskDx, 'the two ends of the day lie opposite ways').toBeLessThan(0)
    expect(noon.shadow.alpha).toBeGreaterThan(dawn.shadow.alpha)
  })

  // ★ ONE READ FOR THE WHOLE CAST. The sun's height is a function of the minute, not of who is
  // standing in it, so asking it per body would be twelve calls a frame for one answer.
  it('★ asks once a frame, outside the loop over the bodies', async () => {
    const spy = vi.mocked(shadowCast)
    const agents: MutableAgents = Object.fromEntries(
      ['nadia', 'omar', 'yusuf', 'amara'].map((id) => [id, makeBodyAgent(id, 3, 4)]),
    )
    const scene = makeScene()
    const { store } = makeStore(agents)
    const layer = createCharacterLayer(scene, loadedBook(), store, () => {})
    await Promise.resolve()
    await Promise.resolve()
    layer.tick(400)
    expect(scene.layers.shadow.children.length, 'four bodies, four shadows').toBe(4)
    spy.mockClear()
    layer.tick(800)
    expect(spy, 'one answer serves the whole cast').toHaveBeenCalledTimes(1)
  })
})

// ★ TWELVE PULSING DOTS READ AS TWELVE LOADING SPINNERS. A turn takes 10 to 90 seconds, so a
// caret on every mind in flight is lit over most of the town most of the time and says nothing.
describe('★ the thinking caret goes only over a body the shot is about', () => {
  const CAST = ['amara', 'nadia']
  const scene = (id: string, participants: readonly string[]): TownScene =>
    ({ id, open: true, kind: 'talk', participants, tick: 0 }) as unknown as TownScene

  /** Every body's overhead node, in the order the layer created them. */
  const slots = (s: Scene): InstanceType<typeof MockContainer>[] =>
    (s.layers as unknown as Record<string, InstanceType<typeof MockContainer>>).worldText!.children

  const drive = (
    pickedId: string | null,
    minds: Record<string, 'deciding' | 'idle'>,
    cast: readonly string[] = CAST,
  ): InstanceType<typeof MockContainer>[] => {
    const agents = Object.fromEntries(
      ['amara', 'nadia', 'salma'].map((n) => [n, makeAgent(n, 103 + n.length, 77)]),
    )
    const own = makeScene()
    ;(own as unknown as { pickedId: string | null }).pickedId = pickedId
    const { store, setScene, setMinds } = makeStore(agents)
    setScene(scene('sc_1', cast))
    setMinds(minds)
    const layer = createCharacterLayer(own, makeBook().book, store, () => {})
    layer.tick(1000)
    return slots(own)
  }

  it('★ lights the cast and leaves the bystander alone', () => {
    const [amara, nadia, salma] = drive(null, {
      amara: 'deciding',
      nadia: 'idle',
      salma: 'deciding',
    })
    expect(amara!.visible, 'in the shot and thinking').toBe(true)
    expect(nadia!.visible, 'in the shot and done thinking').toBe(false)
    expect(salma!.visible, 'thinking, but this shot is not about her').toBe(false)
  })

  it('lights a body the viewer pinned, whatever the camera is doing', () => {
    const [, , salma] = drive('salma', { salma: 'deciding' })
    expect(salma!.visible).toBe(true)
  })

  it('puts the caret out when the flight ends, with no glyph left standing', () => {
    const [amara] = drive(null, { amara: 'idle' })
    expect(amara!.visible).toBe(false)
  })
})
