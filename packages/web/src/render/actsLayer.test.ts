import { beforeAll, describe, expect, it } from 'vitest'
import { Container } from 'pixi.js'
import { createActLayer } from './acts.js'
import { tileToScreen } from './iso.js'
import type { Rect } from './tooltip.js'
import type { Scene } from './scene.js'
import type { WorldStore } from '../state/worldStore.js'

// Pixi measures labels through `document.createElement('canvas')` and these tests run with no
// DOM. Every assertion is about which chips exist, never how wide, so the smallest stub that
// lets a label build beats a jsdom dependency.
beforeAll(() => {
  if (typeof globalThis.document !== 'undefined') return
  const ctx = {
    font: '',
    measureText: (t: string) => ({
      width: t.length * 8,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: t.length * 8,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    }),
    fillText: () => {},
    clearRect: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    scale: () => {},
    translate: () => {},
    save: () => {},
    restore: () => {},
    setTransform: () => {},
  }
  const canvas = { width: 1, height: 1, getContext: () => ctx, style: {} }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => canvas, body: { appendChild: () => {} } },
  })
  // Pixi asks the context CLASS whether letter spacing is supported, before it measures anything.
  Object.defineProperty(globalThis, 'CanvasRenderingContext2D', {
    configurable: true,
    value: class {
      letterSpacing = ''
    },
  })
})

/** The layer, driven the way the ticker drives it. Pure rules are measured in `acts.test.ts`;
 *  here, only what the wiring can answer: right person, gone with the work, space claimed. */

type Act = { verb: string; ticksRemaining: number } | null

const body = (id: string, activity: Act, over: Record<string, unknown> = {}): unknown => ({
  id,
  name: id,
  x: 4,
  y: 4,
  alive: true,
  asleep: false,
  activity,
  needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
  hp: 100,
  ill: false,
  injuries: [],
  collapsedSinceTick: null,
  skills: {},
  ageDays: 20,
  ...over,
})

const WHOLE_WORLD = { x: -1e4, y: -1e4, w: 2e4, h: 2e4 }

function harness(view: Rect = WHOLE_WORLD): {
  layer: ReturnType<typeof createActLayer>
  set: (...bodies: unknown[]) => void
  chips: () => Container[]
  occupied: () => readonly Rect[]
  noteStart: (id: string, verb: string, duration: number) => void
} {
  const worldText = new Container()
  let agents: Record<string, unknown> = {}
  let boxes: readonly Rect[] = []
  const scene = {
    layers: { worldText },
    textScale: 1,
    getZoom: () => 1,
    wantsMotion: () => false,
    viewRect: () => view,
    anchorOf: () => null, // the layer falls back to the record's tile, which is where a body IS
    tags: {
      occupied: () => [],
      setOccupied: (_owner: string, b: readonly Rect[]) => {
        boxes = b
      },
    },
  } as unknown as Scene
  const store = {
    getState: () => ({ agents, tick: 10 }),
    getTick: () => 10,
  } as unknown as WorldStore
  const layer = createActLayer(scene, store)
  return {
    layer,
    set: (...bodies) => {
      agents = Object.fromEntries(bodies.map((b) => [(b as { id: string }).id, b]))
    },
    chips: () => worldText.children,
    occupied: () => boxes,
    noteStart: (id, verb, duration) => {
      layer.noteStart(id, verb, duration)
    },
  }
}

describe('a chip appears on the person doing the work', () => {
  it('draws one for somebody at a job, and none for an empty town', () => {
    const h = harness()
    h.layer.tick()
    expect(h.chips()).toHaveLength(0)

    h.set(body('yusuf', { verb: 'chop', ticksRemaining: 30 }))
    h.noteStart('yusuf', 'chop', 30)
    h.layer.tick()
    expect(h.chips()).toHaveLength(1)
  })

  it('says nothing about a person who is only walking past', () => {
    const h = harness()
    h.set(body('nadia', { verb: 'walk', ticksRemaining: 12 }))
    h.noteStart('nadia', 'walk', 12)
    h.layer.tick()
    expect(h.chips()).toHaveLength(0)
  })

  it('says nothing about an act that is over before it is read', () => {
    const h = harness()
    h.set(body('omar', { verb: 'take', ticksRemaining: 1 }))
    h.noteStart('omar', 'take', 1)
    h.layer.tick()
    expect(h.chips()).toHaveLength(0)
  })
})

// Pins the acts.ts law: the STATE ends a chip, never an event — every ending is one fact.
describe('the chip goes when the work does', () => {
  it('is gone the moment the activity clears, however it ended', () => {
    const h = harness()
    h.set(body('yusuf', { verb: 'chop', ticksRemaining: 30 }))
    h.noteStart('yusuf', 'chop', 30)
    h.layer.tick()
    expect(h.chips()).toHaveLength(1)

    h.set(body('yusuf', null))
    h.layer.tick()
    expect(h.chips()).toHaveLength(0)
    expect(h.occupied()).toEqual([])
  })

  it('is gone when the person is', () => {
    const h = harness()
    h.set(body('yusuf', { verb: 'chop', ticksRemaining: 30 }))
    h.layer.tick()
    h.set()
    h.layer.tick()
    expect(h.chips()).toHaveLength(0)
  })

  it('swaps the word when they move to a different job without going idle', () => {
    const h = harness()
    h.set(body('yusuf', { verb: 'chop', ticksRemaining: 30 }))
    h.noteStart('yusuf', 'chop', 30)
    h.layer.tick()
    const first = h.chips()[0]
    h.set(body('yusuf', { verb: 'tend', ticksRemaining: 3 }))
    h.noteStart('yusuf', 'tend', 3)
    h.layer.tick()
    expect(h.chips()).toHaveLength(1)
    expect(h.chips()[0]).not.toBe(first)
  })
})

describe('the chip tells the rest of the stage where it is', () => {
  it('publishes its box, so a bubble is placed around it rather than on it', () => {
    const h = harness()
    h.set(body('yusuf', { verb: 'chop', ticksRemaining: 30 }))
    h.noteStart('yusuf', 'chop', 30)
    h.layer.tick()
    const boxes = h.occupied()
    expect(boxes).toHaveLength(1)
    expect(boxes[0]!.w).toBeGreaterThan(0)
    expect(boxes[0]!.h).toBeGreaterThan(0)
  })

  // ★ Three chips in a town of thirty read as a town where three people work. The picture is
  // the rule now: whoever the camera can see is seen working.
  it('★ chips everybody the camera can see, however many that is', () => {
    const h = harness()
    const crew = ['a', 'b', 'c', 'd', 'e']
    h.set(...crew.map((id) => body(id, { verb: 'chop', ticksRemaining: 30 })))
    for (const id of crew) h.noteStart(id, 'chop', 30)
    h.layer.tick()
    expect(h.chips()).toHaveLength(crew.length)
  })

  it('★ and nobody it cannot — a body off the edge wears no word', () => {
    const near = tileToScreen(4, 4)
    const h = harness({ x: near.sx - 60, y: near.sy - 60, w: 120, h: 120 })
    h.set(
      body('here', { verb: 'chop', ticksRemaining: 30 }),
      body('away', { verb: 'chop', ticksRemaining: 30 }, { x: 400, y: 400 }),
    )
    for (const id of ['here', 'away']) h.noteStart(id, 'chop', 30)
    h.layer.tick()
    expect(h.chips()).toHaveLength(1)
  })
})

describe('tearing it down', () => {
  it('takes every chip with it', () => {
    const h = harness()
    h.set(body('yusuf', { verb: 'chop', ticksRemaining: 30 }))
    h.layer.tick()
    h.layer.destroy()
    expect(h.chips()).toHaveLength(0)
  })
})
