import { beforeAll, describe, expect, it } from 'vitest'
import { Container } from 'pixi.js'
import { createActLayer } from './acts.js'
import type { Rect } from './tooltip.js'
import type { Scene } from './scene.js'
import type { WorldStore } from '../state/worldStore.js'

// Pixi measures a label through `document.createElement('canvas')`, and these tests run with no
// DOM. The measurements do not matter here — every assertion below is about which chips exist,
// not how wide they are — so the smallest thing that lets a label be built is the right stub,
// and it is cheaper than a jsdom dependency the rest of the suite has done without.
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

/**
 * The layer, driven the way the ticker drives it. The pure rules are measured in `acts.test.ts`;
 * this asks the questions only the wiring can answer — does a chip appear on the right person,
 * does it go when the work does, and does it tell the rest of the stage where it is sitting.
 */

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

function harness(): {
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
    viewRect: () => ({ x: -1e4, y: -1e4, w: 2e4, h: 2e4 }),
    anchorOf: () => ({ x: 0, y: 0 }),
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

// ★ THE STATE ENDS THE CHIP, NEVER AN EVENT. `action_completed` and all four reasons an act can
// be interrupted arrive as one fact — `activity` is null — and `action_interrupted` does not
// even carry the verb it stopped, so an event-chasing version would have had to guess.
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

  it('keeps only three when the whole town is at work', () => {
    const h = harness()
    const crew = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      body(id, { verb: 'chop', ticksRemaining: 30 }),
    )
    h.set(...crew)
    for (const id of ['a', 'b', 'c', 'd', 'e']) h.noteStart(id, 'chop', 30)
    h.layer.tick()
    expect(h.chips()).toHaveLength(3)
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
