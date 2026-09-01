import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

// Every assertion here about the prism's SHAPE passes if `structureHitPoints` is never called,
// so the layer is driven for real and what is read back is the hitArea the SPRITE carries.
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
    cursor = ''
    tint = 0xffffff
    alpha = 1
    position = new Point()
    scale = new Point()
    handlers = new Map<string, (e: unknown) => void>()
    hitArea: unknown = null
    addChild(...cs: Container[]): void {
      for (const c of cs) {
        c.parent = this
        this.children.push(c)
      }
    }
    on(name: string, fn: (e: unknown) => void): this {
      this.handlers.set(name, fn)
      return this
    }
    fire(name: string, e: unknown = { client: { x: 0, y: 0 } }): void {
      this.handlers.get(name)?.(e)
    }
    destroy(): void {
      this.destroyed = true
    }
  }
  class Sprite extends Container {
    anchor = new Point()
    texture: unknown = null
  }
  class Graphics extends Container {
    clear(): this {
      return this
    }
    poly(): this {
      return this
    }
    fill(): this {
      return this
    }
    stroke(): this {
      return this
    }
    rect(): this {
      return this
    }
  }
  const Texture = { EMPTY: {} }
  class Polygon {
    points: number[]
    constructor(points: number[] = []) {
      this.points = points
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
  return { Container, Graphics, Point, Polygon, Rectangle, Sprite, Texture }
})
import type { Structure, WorldState } from '@sj/engine/state'
import {
  DEFAULT_CONFIG,
  INTERIOR_KINDS,
  cityStructures,
  isRoofedKind,
  type AssetRecord,
  type SimConfig,
} from '@sj/shared'
import { tileToScreen } from './iso.js'
import { Container as MockContainer } from 'pixi.js'
import {
  BUILDING_PX_PER_TILE,
  BUILD_TICKS_FULL,
  LOOK_INSIDE,
  PIP_COUNT,
  doorTileOf,
  enterableKind,
  entersOnClick,
  entitySpriteOf,
  footprintHitPoints,
  pipsFilled,
  setEntityScaleMul,
  structureHitPoints,
  structureHoverText,
  syncEntities,
} from './entities.js'
import type { Scene } from './scene.js'
import type { TextureBook } from './textures.js'
import type { WorldStore } from '../state/worldStore.js'
import { polygonBounds, resolveHit } from './hitShapes.js'
import { builtFormSpec } from './builtForm.js'
import { inFrontOf, structureDepthBox } from './depth.js'
import { rendersOnMap } from './characters.js'

const box = (x: number, y: number, w: number, h: number, kind = 'house'): Structure => ({
  id: `s-${x}-${y}`,
  kind,
  x,
  y,
  w,
  h,
  hp: 50,
  maxHp: 50,
  flammable: true,
  stage: 'complete',
  progressTicks: 0,
  builtBy: null,
  burning: false,
  burnTicks: 0,
})

const SHAPES: [number, number][] = [
  [1, 1],
  [2, 2],
  [1, 2],
  [2, 1],
  [3, 2],
  [2, 3],
]

describe('doorTileOf', () => {
  it('sits on the south face, at the centre of the frontage', () => {
    expect(doorTileOf(box(4, 6, 2, 2))).toEqual({ x: 4, y: 7 })
    expect(doorTileOf(box(4, 6, 1, 1))).toEqual({ x: 4, y: 6 })
    expect(doorTileOf(box(4, 6, 3, 2))).toEqual({ x: 5, y: 7 })
  })

  it('always lands on a tile the building actually occupies', () => {
    for (const [w, h] of SHAPES) {
      const s = box(10, 10, w, h)
      const d = doorTileOf(s)
      expect(d.x).toBeGreaterThanOrEqual(s.x)
      expect(d.x).toBeLessThan(s.x + s.w)
      expect(d.y).toBe(s.y + s.h - 1)
    }
  })
})

// A building is one object and takes one pointer; what a click MEANS is then a property of the
// building rather than of where inside it the pointer landed.
describe('one building, one hitbox, and the building says what a click does', () => {
  const src = readFileSync(new URL('./entities.ts', import.meta.url), 'utf8')
  const code = src
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
    .join('\n')

  const world = (structures: Structure[]): WorldState =>
    ({ structures: Object.fromEntries(structures.map((s) => [s.id, s])) }) as unknown as WorldState

  it('has no door node, no door graphics and no rectangle hit area left', () => {
    for (const gone of [
      'entry.sprite.addChild(door)',
      'doorZIndex',
      'DOOR_Z_OVER_BUILDING',
      'doorSillPolygon',
      'DOOR_SILL',
      'DOOR_LINTEL',
      'DOOR_RIM',
      'doorLocalRect',
      'new Rectangle(',
      'layoutDoor',
    ])
      expect(code, gone).not.toContain(gone)
  })

  it('routes the click by what the building IS, not by where inside it the pointer landed', () => {
    const house = box(4, 4, 2, 2, 'house')
    const well = box(9, 9, 1, 1, 'well')
    const shell: Structure = { ...box(12, 12, 2, 2, 'house'), id: 'shell', stage: 'construction' }
    const st = world([house, well, shell])
    expect(entersOnClick(DEFAULT_CONFIG, st, house.id)).toBe(true)
    expect(entersOnClick(DEFAULT_CONFIG, st, well.id)).toBe(false)
    expect(entersOnClick(DEFAULT_CONFIG, st, 'shell')).toBe(false)
    expect(entersOnClick(DEFAULT_CONFIG, null, house.id)).toBe(false)
    expect(entersOnClick(DEFAULT_CONFIG, world([]), 'nobody')).toBe(false)
  })

  it('and the hover tag SAYS which, before the click is made', () => {
    const house = box(4, 4, 2, 2, 'house')
    const well = box(9, 9, 1, 1, 'well')
    const st = world([house, well])
    expect(structureHoverText(DEFAULT_CONFIG, st, house.id)).toBe(`house · ${LOOK_INSIDE}`)
    expect(structureHoverText(DEFAULT_CONFIG, st, well.id)).toBe('well')
    expect(structureHoverText(DEFAULT_CONFIG, st, 'nobody')).toBeNull()
  })

  it('and it spends ONE em-dash, because the name already spent the other', () => {
    const built: Structure = { ...box(4, 4, 2, 2, 'house'), builtBy: 'omar' }
    const st = {
      structures: { [built.id]: built },
      agents: { omar: { id: 'omar', name: 'Omar' } },
    } as unknown as WorldState
    const tag = structureHoverText(DEFAULT_CONFIG, st, built.id)!
    expect(tag).toBe(`house — built by Omar · ${LOOK_INSIDE}`)
    expect(tag.split('—')).toHaveLength(2) // LOOK INSIDE — HOUSE — BUILT BY OMAR had three
  })

  it('hangs the hover tag off the DRAWN size, never the pre-scale local bounds', () => {
    expect(code).not.toContain('getLocalBounds')
    expect(code).toMatch(/anchorForSprite\(\s*sprite,\s*\{\s*width: sprite\.width/)
  })

  it('the sprite is the one thing wired to the pointer — nothing else in the file is', () => {
    expect(code).toContain("sprite.eventMode = 'static'")
    expect(code).not.toMatch(/door\.eventMode/)
    // the two meanings both hang off the one tap handler
    expect(code).toMatch(/entersOnClick\(store\.getConfig\(\), store\.getState\(\), sid\)/)
    expect(code).toMatch(/sync!?\.onDoor\?\.\(sid\)/)
  })

  it('resolveHit: a body beats a building, nothing beats nothing', () => {
    expect(
      resolveHit([
        { kind: 'structure', id: 's' },
        { kind: 'agent', id: 'a' },
      ]),
    ).toBe('a')
    expect(
      resolveHit([
        { kind: 'crop', id: 'c' },
        { kind: 'item', id: 'i' },
      ]),
    ).toBe('i')
    expect(resolveHit([])).toBeNull()
  })
})

// The general law: over EVERY kind this product can stand, the viewer's answer is
// `isRoofedKind`'s answer. A hand-list cannot satisfy it — the second test moves the config.
describe('★ enterability is asked of the config, and there is no second list', () => {
  // comments stripped: the claim is that no CODE names a roster
  const src = readFileSync(new URL('./entities.ts', import.meta.url), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
    .join('\n')

  // Every kind that can appear in a world, from the three places kinds come from: the recipe
  // table, the town the template plants, and the renderer's own room vocabulary. `shed` is only
  // in the third — it has no recipe row at all — which is exactly the kind the roster got wrong.
  const ALL_KINDS = [
    ...new Set([
      ...Object.keys(DEFAULT_CONFIG.structures.recipes),
      ...cityStructures().map((s) => s.kind),
      ...INTERIOR_KINDS,
    ]),
  ].sort()

  const withRoofed = (over: Record<string, boolean>): SimConfig => ({
    ...DEFAULT_CONFIG,
    structures: {
      ...DEFAULT_CONFIG.structures,
      recipes: Object.fromEntries(
        Object.entries(DEFAULT_CONFIG.structures.recipes).map(([k, r]) => [
          k,
          over[k] === undefined ? r : { ...r, roofed: over[k] },
        ]),
      ),
    },
  })

  it('★ over every kind there is, the viewer answers exactly what isRoofedKind answers', () => {
    for (const kind of ALL_KINDS) {
      expect(enterableKind(DEFAULT_CONFIG, kind), kind).toBe(isRoofedKind(DEFAULT_CONFIG, kind))
    }
    // Not vacuous: the enumeration is big, and it holds BOTH answers. Without these three the
    // law is satisfied by `false === false` over an empty or one-sided list.
    expect(ALL_KINDS.length).toBeGreaterThan(8)
    expect(ALL_KINDS.filter((k) => isRoofedKind(DEFAULT_CONFIG, k)).length).toBeGreaterThan(0)
    expect(ALL_KINDS.filter((k) => !isRoofedKind(DEFAULT_CONFIG, k)).length).toBeGreaterThan(0)
  })

  it('★ and it FOLLOWS the config — a list transcribed from today cannot pass this', () => {
    const flipped = withRoofed({ well: true, house: false, cottage: false })
    expect(enterableKind(flipped, 'well')).toBe(true) // a roster would still refuse it
    expect(enterableKind(flipped, 'house')).toBe(false) // a roster would still open it
    expect(enterableKind(flipped, 'cottage')).toBe(false)
    for (const kind of ALL_KINDS) {
      expect(enterableKind(flipped, kind), kind).toBe(isRoofedKind(flipped, kind))
    }
  })

  it('★ the four kinds the roster had wrong on the day it was found', () => {
    // it said no to the three dwellings the world grew — including the cabin, which holds the
    // founding valley's only indoor fire …
    for (const kind of ['cabin', 'cottage', 'farmhouse']) {
      expect(enterableKind(DEFAULT_CONFIG, kind), kind).toBe(true)
    }
    // … and yes to the shed, which has no recipe row, so the engine refuses `enter` by name.
    expect(enterableKind(DEFAULT_CONFIG, 'shed')).toBe(false)
  })

  it('★ and the roster itself is gone from the module', () => {
    expect(src).not.toContain('ENTERABLE_KINDS')
    expect(src).not.toMatch(/new Set\(INTERIOR_KINDS\)/)
  })

  it('with no config yet, nothing is enterable — the viewer does not guess', () => {
    for (const kind of ALL_KINDS) expect(enterableKind(null, kind), kind).toBe(false)
  })
})

// Pixi hit-tests a sprite's full RECTANGULAR bounds unless a hitArea says otherwise, and a
// building sprite is about twice as wide as the ground it stands on. The prism is the drawn cell
// with its corners cut off by the diamond, so it claims no pixel outside the picture.

// the sprite sits at the top vertex of its centre tile; local points are offsets from there
function spriteAt(s: Structure): { sx: number; sy: number } {
  return tileToScreen(s.x + s.w / 2 - 0.5, s.y + s.h / 2 - 0.5)
}
function worldPoly(local: number[], s: Structure): [number, number][] {
  const at = spriteAt(s)
  return Array.from(
    { length: local.length / 2 },
    (_, i) => [at.sx + local[i * 2]!, at.sy + local[i * 2 + 1]!] as [number, number],
  )
}

function contains(poly: [number, number][], px: number, py: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!,
      [xj, yj] = poly[j]!
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Where the DRAWN doorway is: the bottom centre of the art, a fifth of the way up the cell.
 *  Read off the running product — every root's lowest opaque row is its own feet anchor. */
function drawnDoorPoint(s: Structure): [number, number] {
  const at = spriteAt(s)
  return [at.sx, at.sy - ((s.w + s.h) * BUILDING_PX_PER_TILE) / 5]
}

/** The whole drawn cell's corner points, so "outside the picture" can be tested. */
function drawnCorners(s: Structure): [number, number][] {
  const at = spriteAt(s)
  const side = (s.w + s.h) * BUILDING_PX_PER_TILE
  return [
    [at.sx - side / 2 + 1, at.sy - 1],
    [at.sx + side / 2 - 1, at.sy - 1],
    [at.sx - side / 2 + 1, at.sy - side + 1],
    [at.sx + side / 2 - 1, at.sy - side + 1],
  ]
}

describe('a structure hit-tests the structure', () => {
  it('★ THE DEFECT: the landed flat diamond does not contain the drawn doorway at all', () => {
    for (const [w, h] of SHAPES) {
      const s = box(20, 20, w, h)
      const [px, py] = drawnDoorPoint(s)
      expect(contains(worldPoly(footprintHitPoints(w, h), s), px, py), `${w}x${h}`).toBe(false)
    }
  })

  it('★ THE FIX: the prism contains the doorway, the wall and the roof', () => {
    for (const [w, h] of SHAPES) {
      const s = box(20, 20, w, h)
      const p = worldPoly(structureHitPoints('house', w, h, 1), s)
      const at = spriteAt(s)
      const side = (w + h) * BUILDING_PX_PER_TILE
      const [dx, dy] = drawnDoorPoint(s)
      expect(contains(p, dx, dy), `${w}x${h} doorway`).toBe(true)
      expect(contains(p, at.sx - side / 4, at.sy - side / 2), `${w}x${h} wall`).toBe(true)
      expect(contains(p, at.sx, at.sy - side * 0.9), `${w}x${h} roof`).toBe(true)
    }
  })

  it('★ and it claims nothing outside the drawn cell — every corner is empty sky', () => {
    for (const [w, h] of SHAPES) {
      const s = box(20, 20, w, h)
      const p = worldPoly(structureHitPoints('house', w, h, 1), s)
      for (const [cx, cy] of drawnCorners(s)) {
        expect(contains(p, cx, cy), `${w}x${h} corner ${cx},${cy}`).toBe(false)
      }
      // nor a pixel below the feet row, which is grass in front of the building
      expect(contains(p, spriteAt(s).sx, spriteAt(s).sy + 2), `${w}x${h} below`).toBe(false)
    }
  })

  it("★ NEIGHBOURS AT THE TOWN GRAMMAR'S PROVEN 86.1626 px SPACING DO OVERLAP", () => {
    // Their prisms genuinely intersect on screen because the drawn buildings do; which one
    // answers is the depth order's business. Nobody may "fix" the overlap by shrinking a hitbox.
    const near = box(32, 25, 2, 2, 'house')
    const far = box(30, 22, 2, 2, 'house')
    const p = worldPoly(structureHitPoints('house', 2, 2, 1), near)
    const q = worldPoly(structureHitPoints('house', 2, 2, 1), far)
    const at = spriteAt(near)
    const shared = [at.sx, at.sy - 100] as const
    expect(contains(p, shared[0], shared[1])).toBe(true)
    expect(contains(q, shared[0], shared[1])).toBe(true)
    // and geometry says the near one is in front, which is what the sort will read
    expect(inFrontOf(structureDepthBox('near', near), structureDepthBox('far', far))).toBe(true)
  })

  it('a kind with NO art gets the volume that is actually drawn for it', () => {
    // `builtFormSpec` draws a plinth on the true footprint and a volume `heightPx` tall on top
    const noArt = structureHitPoints('well', 1, 1, 1, 1, false)
    const b = polygonBounds(noArt)
    expect(b.w).toBe(32) // the footprint diamond's own width
    expect(b.h).toBeCloseTo(16 + builtFormSpec('well', 1, 1).heightPx, 9)
    // and it is NOT the art prism, which would claim a 64 px cell the form never paints
    expect(polygonBounds(structureHitPoints('well', 1, 1, 1)).w).toBe(64)
  })

  it('is a diamond the size of the footprint, and scales with the sprite (the before-state)', () => {
    expect(footprintHitPoints(1, 1)).toEqual([0, 0, 16, 8, 0, 16, -16, 8])
    expect(footprintHitPoints(2, 2)).toEqual([0, -8, 32, 8, 0, 24, -32, 8])
    expect(footprintHitPoints(1, 1, 2)).toEqual([0, 0, 8, 4, 0, 8, -8, 4])
  })
})

// ── ★ AND THE SPRITE IS ACTUALLY CARRYING IT ─────────────────────────────────────────────

describe('★ the layer puts the prism on the sprite, and keeps it there', () => {
  type Cam = () => void
  /** One codex root for `house`, shaped exactly as the town's own: a 512 px cell fitted to the
   *  (w+h)·32 square, feet at its bottom centre. `scale` is 0.25 and known synchronously. */
  const HOUSE_ART = {
    id: 'asset_house',
    seq: 1,
    class: 'building',
    desc: 'a house',
    kind: 'house',
    meta: JSON.stringify({
      version: 'v4-hires-building',
      kind: 'house',
      footprint: { w: 2, h: 2 },
      cell: { w: 512, h: 512, feetX: 256, feetY: 511 },
    }),
    footprint: { w: 2, h: 2 },
    widthPx: 512,
    heightPx: 512,
    status: 'ready',
    score: null,
    attempts: 1,
    costUsd: 0,
    createdAt: '',
  } as unknown as AssetRecord

  function harness(
    structures: Structure[],
    records: AssetRecord[] = [],
  ): {
    scene: Scene
    store: WorldStore
    book: TextureBook
    zoom: { at: number }
    cameras: Cam[]
    doors: string[]
  } {
    const zoom = { at: 1 }
    const cameras: Cam[] = []
    const doors: string[] = []
    const scene = {
      layers: {
        entities: new (MockContainer as never as typeof Object)() as { addChild: () => void },
      },
      tags: { show: () => {}, hide: () => {}, hideAll: () => {} },
      getZoom: () => zoom.at,
      onCamera: (cb: Cam) => {
        cameras.push(cb)
        return () => {}
      },
      addDepthSource: () => () => {},
    } as unknown as Scene
    const store = {
      getState: () =>
        ({
          structures: Object.fromEntries(structures.map((s) => [s.id, s])),
          items: {},
          crops: {},
        }) as unknown as WorldState,
      getConfig: () => DEFAULT_CONFIG,
      assetsSeq: () => 0,
      assetRecords: () => records,
    } as unknown as WorldStore
    const book = {
      get: () => new Promise<never>(() => {}),
      swap: () => new Promise<never>(() => {}),
    } as unknown as TextureBook
    return { scene, store, book, zoom, cameras, doors }
  }

  const house = box(20, 20, 2, 2, 'house')
  const cottage = box(30, 30, 3, 2, 'cottage')
  const well = box(40, 40, 1, 1, 'well')

  // The harness hands the layer no asset records, so these take the no-art path and draw a
  // `builtFormSpec` volume — the one whose hit prism can be checked without a texture round trip.
  it("★ the sprite's hitArea IS the prism — not the diamond, and not nothing", () => {
    const h = harness([house])
    syncEntities(h.scene, h.book, h.store, (id) => h.doors.push(id))
    const sprite = entitySpriteOf(h.scene, 'structure', house.id)!
    expect(sprite).not.toBeNull()
    const pts = (sprite.hitArea as unknown as { points: number[] }).points
    expect(pts).toEqual(structureHitPoints('house', 2, 2, 1, 1, false))
    expect(pts).toHaveLength(12) // six points, not four
    expect(pts).not.toEqual(footprintHitPoints(2, 2))
  })

  it('★ and it is re-cut when the camera settles, because the floor is a SCREEN size', () => {
    const h = harness([house])
    syncEntities(h.scene, h.book, h.store, () => {})
    const sprite = entitySpriteOf(h.scene, 'structure', house.id)!
    const before = [...(sprite.hitArea as unknown as { points: number[] }).points]
    h.zoom.at = 0.25
    for (const cb of h.cameras) cb()
    const after = (sprite.hitArea as unknown as { points: number[] }).points
    expect(after).not.toEqual(before)
    expect(after).toEqual(structureHitPoints('house', 2, 2, 1, 0.25, false))
    expect(polygonBounds(after).w * 0.25).toBeGreaterThanOrEqual(24 - 1e-9)
  })

  it('★ a building WITH art gets the art prism in the frame it appears, not a round trip later', () => {
    // the book never resolves in this harness, so anything set inside a `.then` is not set at
    // all — which is the point: the manifest's scale is known synchronously and so is the shape
    const h = harness([house], [HOUSE_ART])
    syncEntities(h.scene, h.book, h.store, () => {})
    const pts = (
      entitySpriteOf(h.scene, 'structure', house.id)!.hitArea as unknown as { points: number[] }
    ).points
    expect(pts).toEqual(structureHitPoints('house', 2, 2, 0.25, 1, true))
    // 128 world px across at an art scale of 0.25 — the drawn cell, not the 32 px built volume
    expect(polygonBounds(pts).w * 0.25).toBe(128)
  })

  it('and the art path re-cuts AGAIN when the texture lands and applies the scale', () => {
    const src = readFileSync(new URL('./entities.ts', import.meta.url), 'utf8')
    const applied = src.slice(
      src.indexOf('function applyBuildingArt('),
      src.indexOf('function cutHitPrism('),
    )
    expect(applied.match(/cutHitPrism\(/g)).toHaveLength(3) // no-art, art-synchronous, art-landed
  })

  it('★ a tap on an enterable building GOES IN; a tap on anything else does not', () => {
    // the provenance popover fetches and then reaches for the DOM; the point here is only
    // which of the two answers the tap chose, so both are stubbed rather than exercised
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false }))
    vi.stubGlobal('document', {
      createElement: () => ({ setAttribute: () => {}, style: {}, className: '', textContent: '' }),
      body: { appendChild: () => {} },
      addEventListener: () => {},
    })
    const h = harness([house, cottage, well])
    syncEntities(h.scene, h.book, h.store, (id) => h.doors.push(id))
    const tap = (id: string): void => {
      ;(entitySpriteOf(h.scene, 'structure', id) as never as { fire: (n: string) => void }).fire(
        'pointertap',
      )
    }
    // The well is the negative: it is unroofed, while a cottage is roofed and so is a door.
    tap(well.id)
    expect(h.doors).toEqual([])
    tap(cottage.id)
    expect(h.doors).toEqual([cottage.id])
    tap(house.id)
    expect(h.doors).toEqual([cottage.id, house.id])
  })
})

// An occupant asleep inside a cottage was still drawn on the town map, at the door tile they
// walked in through, when the character layer checked only `alive`.
describe('rendersOnMap', () => {
  it('draws the living who are out of doors', () => {
    expect(rendersOnMap({ alive: true })).toBe(true)
    expect(rendersOnMap({ alive: true, insideId: undefined })).toBe(true)
  })

  it('does NOT draw someone who has gone inside — the interior scene has them', () => {
    expect(rendersOnMap({ alive: true, insideId: 'structure_house' })).toBe(false)
  })

  it('still does not draw the dead', () => {
    expect(rendersOnMap({ alive: false })).toBe(false)
    expect(rendersOnMap({ alive: false, insideId: 'structure_house' })).toBe(false)
  })
})

// The denominator has to be the world's own `houseTicks`: a dev world raising a house in 240
// ticks lights `floor((240/2880) x 4)` = zero pips against the default's 2880.
describe('pipsFilled', () => {
  it('* fills across the build the world is running, not the one the default assumes', () => {
    expect(pipsFilled(0, 240)).toBe(0)
    expect(pipsFilled(60, 240)).toBe(1)
    expect(pipsFilled(120, 240)).toBe(2)
    expect(pipsFilled(239, 240)).toBe(3)
    expect(pipsFilled(240, 240)).toBe(PIP_COUNT)
    // THE BEFORE-STATE, kept because it is the defect: against the transcribed 2880, a house
    // that is FINISHED at 240 ticks lights nothing at all.
    expect(Math.floor((240 / BUILD_TICKS_FULL) * PIP_COUNT)).toBe(0)
  })

  it('still fills across a default-length build, and never overfills', () => {
    expect(pipsFilled(0, BUILD_TICKS_FULL)).toBe(0)
    expect(pipsFilled(1440, BUILD_TICKS_FULL)).toBe(2)
    expect(pipsFilled(2880, BUILD_TICKS_FULL)).toBe(PIP_COUNT)
    expect(pipsFilled(99999, 240)).toBe(PIP_COUNT)
  })

  it('falls back rather than dividing by nothing, before the snapshot has landed', () => {
    expect(pipsFilled(1440, undefined)).toBe(pipsFilled(1440, BUILD_TICKS_FULL))
    expect(pipsFilled(1440, 0)).toBe(pipsFilled(1440, BUILD_TICKS_FULL))
    expect(pipsFilled(1440, -5)).toBe(pipsFilled(1440, BUILD_TICKS_FULL))
    expect(pipsFilled(-5, 240)).toBe(0)
  })
})

// An effect that writes back the scale it captured reverts a building whose art lands inside
// the effect's 260 ms.
describe('★ an effect multiplies the scale the layer owns, and never replaces it', () => {
  const HOUSE_ART = {
    id: 'asset_house',
    seq: 1,
    class: 'building',
    desc: 'a house',
    kind: 'house',
    meta: JSON.stringify({
      version: 'v4-hires-building',
      kind: 'house',
      footprint: { w: 2, h: 2 },
      cell: { w: 512, h: 512, feetX: 256, feetY: 511 },
    }),
    footprint: { w: 2, h: 2 },
    widthPx: 512,
    heightPx: 512,
    status: 'ready',
    score: null,
    attempts: 1,
    costUsd: 0,
    createdAt: '',
  } as unknown as AssetRecord

  const ART_SCALE = 0.25 // (2 + 2) · BUILDING_PX_PER_TILE / 512

  const drive = (): {
    scene: Scene
    store: WorldStore
    book: TextureBook
    sync: () => void
    scale: () => number
    records: AssetRecord[]
  } => {
    const house = box(20, 20, 2, 2, 'house')
    const records: AssetRecord[] = []
    const scene = {
      layers: {
        entities: new (MockContainer as never as typeof Object)() as { addChild: () => void },
      },
      tags: { show: () => {}, hide: () => {}, hideAll: () => {} },
      getZoom: () => 1,
      onCamera: () => () => {},
      addDepthSource: () => () => {},
    } as unknown as Scene
    const store = {
      getState: () =>
        ({ structures: { [house.id]: house }, items: {}, crops: {} }) as unknown as WorldState,
      getConfig: () => DEFAULT_CONFIG,
      assetsSeq: () => records.length,
      assetRecords: () => records,
    } as unknown as WorldStore
    const book = {
      get: () => Promise.resolve({} as never),
      swap: () => Promise.resolve({} as never),
    } as unknown as TextureBook
    return {
      scene,
      store,
      book,
      records,
      sync: () => {
        syncEntities(scene, book, store, () => {})
      },
      scale: () => entitySpriteOf(scene, 'structure', house.id)!.scale.x,
    }
  }

  it('holds the multiplier through the art landing, and releases to the ART scale', async () => {
    const h = drive()
    h.sync()
    expect(h.scale()).toBe(1) // the built-form volume, no art yet

    expect(setEntityScaleMul(h.scene, 'structure', 's-20-20', 1.18)).toBe(true)
    expect(h.scale()).toBeCloseTo(1.18)

    h.records.push(HOUSE_ART)
    h.sync()
    await Promise.resolve()
    await Promise.resolve()
    expect(h.scale(), 'the art scale, still under the effect').toBeCloseTo(ART_SCALE * 1.18)

    setEntityScaleMul(h.scene, 'structure', 's-20-20', 1)
    expect(h.scale(), 'the effect ended on the art scale, not the one it started from').toBeCloseTo(
      ART_SCALE,
    )
  })

  it('reports a subject it does not have, so an effect can drop it', () => {
    const h = drive()
    h.sync()
    expect(setEntityScaleMul(h.scene, 'structure', 'nobody', 1.2)).toBe(false)
  })
})
