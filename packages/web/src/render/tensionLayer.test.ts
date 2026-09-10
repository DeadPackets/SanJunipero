import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Container, type Graphics } from 'pixi.js'
import type { SimEvent } from '@sj/shared'
import { GIVE_WAY_AFTER } from '@sj/shared'
import { SceneLineSaid, SceneOpened } from '@sj/engine'
import type { SceneRingBounds } from './sceneRing.js'
import { createTensionLayer } from './tensionLayer.js'
import {
  createTension,
  TENSION_BAR_H,
  TENSION_BAR_W,
  TENSION_GIVE_WAY_MS,
  TENSION_MOVE_MS,
  TENSION_RIM_MS,
  TENSION_WARM,
} from './tension.js'

let clock = 1000

beforeEach(() => {
  clock = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})
afterEach(() => {
  vi.restoreAllMocks()
})

const FLOOR: SceneRingBounds = { sceneId: 's1', sx: 400, sy: 300, rx: 60, ry: 30 }

type Painted = { x: number; y: number; w: number; h: number; colour: number; alpha: number }
type Shape = { action: string; data: number[] }
type Filled = { style: { color: number; alpha: number }; path: { instructions: Shape[] } }

/** Every rectangle the layer actually put on the canvas this frame, in paint order. */
const painted = (g: Graphics): Painted[] =>
  g.context.instructions.flatMap((ins) => {
    if (ins.action !== 'fill') return []
    const { style, path } = ins.data as unknown as Filled
    return path.instructions
      .filter((p) => p.action === 'rect')
      .map((p) => ({
        x: p.data[0]!,
        y: p.data[1]!,
        w: p.data[2]!,
        h: p.data[3]!,
        colour: style.color,
        alpha: style.alpha,
      }))
  })

/** What the rim was stroked with, or null while nothing flashed. */
const stroked = (g: Graphics): { colour: number; alpha: number } | null => {
  for (const ins of g.context.instructions) {
    if (ins.action !== 'stroke') continue
    const { style } = ins.data as unknown as Filled
    return { colour: style.color, alpha: style.alpha }
  }
  return null
}

function harness(): {
  tick: (nowMs: number) => void
  open: (participants: string[]) => void
  say: (agentId: string, move: string) => void
  bars: () => Painted[]
  rim: () => Graphics
  floor: { at: SceneRingBounds | null }
} {
  const overlay = new Container()
  const floor: { at: SceneRingBounds | null } = { at: FLOOR }
  let handler: (evts: SimEvent[]) => void = () => undefined
  const tension = createTension({
    onEvents: (fn) => {
      handler = fn
      return () => undefined
    },
  })
  const layer = createTensionLayer({ layers: { overlay }, bounds: () => floor.at }, { tension })
  let seq = 0
  const emit = (type: string, payload: unknown): void => {
    seq += 1
    handler([{ seq, tick: seq, type, payload }])
  }
  return {
    tick: (nowMs) => {
      clock = nowMs
      layer.tick(nowMs)
    },
    floor,
    open: (participants) => {
      emit(
        'scene_opened',
        SceneOpened.parse({ id: 's1', kind: 'talk', participants, topic: null, stakes: 5 }),
      )
    },
    say: (agentId, move) => {
      emit('scene_line', SceneLineSaid.parse({ id: 's1', agentId, text: 'Well.', move }))
    },
    bars: () => painted(overlay.children[1] as Graphics),
    rim: () => overlay.children[0] as Graphics,
  }
}

describe('the bars a viewer can read from across the room', () => {
  it('stands one 64 by 4 bar per person over the floor, in the cast s own order', () => {
    const h = harness()
    h.open(['amara', 'yusuf'])
    h.tick(1000)
    const drawn = h.bars()
    const tracks = drawn.filter((r) => r.w === TENSION_BAR_W)
    expect(tracks).toHaveLength(2)
    for (const t of tracks) {
      expect(t.h).toBe(TENSION_BAR_H)
      expect(t.x + t.w / 2, 'centred on the floor').toBe(FLOOR.sx)
      expect(t.y, 'clear of the floor rim').toBeLessThan(FLOOR.sy - FLOOR.ry)
    }
    expect(tracks[0]!.y, 'first in the cast reads first, at the top').toBeLessThan(tracks[1]!.y)
    // half a bar each, because nobody has pushed
    const fills = drawn.filter((r) => r.w < TENSION_BAR_W)
    expect(fills.map((f) => f.w)).toEqual([TENSION_BAR_W / 2, TENSION_BAR_W / 2])
  })

  it('draws nothing at all where the world holds no scene', () => {
    const h = harness()
    h.open(['amara', 'yusuf'])
    h.tick(1000)
    expect(h.bars().length).toBeGreaterThan(0)
    h.floor.at = null
    h.tick(1000)
    expect(h.bars(), 'and it keeps no picture of the one that went').toEqual([])
    h.floor.at = FLOOR
    h.tick(1000)
    expect(h.bars().length).toBeGreaterThan(0)
  })

  it('a press lengthens the presser s bar on the canvas and shortens the other', () => {
    const h = harness()
    h.open(['amara', 'yusuf'])
    h.tick(1000)
    const before = h
      .bars()
      .filter((r) => r.w < TENSION_BAR_W)
      .map((r) => r.w)
    h.say('amara', 'press')
    h.tick(1000 + TENSION_MOVE_MS)
    const after = h
      .bars()
      .filter((r) => r.w < TENSION_BAR_W)
      .map((r) => r.w)
    expect(after[0]).toBeGreaterThan(before[0]!)
    expect(after[1]).toBeLessThan(before[1]!)
  })

  it('a bar that gives way is drawn down to nothing and keeps its empty lane', () => {
    const h = harness()
    h.open(['amara', 'yusuf'])
    h.say('amara', 'give_way')
    h.tick(1000 + TENSION_GIVE_WAY_MS)
    const drawn = h.bars()
    expect(
      drawn.filter((r) => r.w === TENSION_BAR_W),
      'both lanes still stand',
    ).toHaveLength(2)
    expect(
      drawn.filter((r) => r.w > 0 && r.w < TENSION_BAR_W),
      'only one bar is left',
    ).toHaveLength(1)
  })

  it('a joke marks the bar and an ask opens a caret on the other', () => {
    const h = harness()
    h.open(['amara', 'yusuf'])
    h.say('amara', 'joke')
    h.tick(1000)
    const warm = h.bars().filter((r) => r.colour === TENSION_WARM)
    expect(warm).toHaveLength(1)
    expect(warm[0]!.y, 'above the bar it marks').toBeLessThan(h.bars()[0]!.y)
    h.say('amara', 'ask')
    h.tick(1000)
    expect(
      h.bars().filter((r) => r.colour === TENSION_WARM),
      'the joke mark is gone',
    ).toEqual([])
    const caret = h.bars().filter((r) => r.w === 1)
    expect(caret).toHaveLength(1)
    expect(caret[0]!.h, 'standing past the bar it opened on').toBeGreaterThan(TENSION_BAR_H)
  })

  it('the rim flashes warm over a turn and is gone 200 ms later', () => {
    const h = harness()
    h.open(['amara', 'yusuf'])
    h.tick(1000)
    expect(stroked(h.rim())).toBe(null)
    for (let i = 0; i < GIVE_WAY_AFTER; i++) h.say('yusuf', 'press')
    h.say('amara', 'give_way')
    h.tick(1000)
    expect(stroked(h.rim())).toEqual({ colour: TENSION_WARM, alpha: 1 })
    expect(h.rim().visible).toBe(true)
    h.tick(1000 + TENSION_RIM_MS / 2)
    expect(stroked(h.rim())!.alpha).toBeCloseTo(0.5, 5)
    h.tick(1000 + TENSION_RIM_MS)
    expect(h.rim().visible).toBe(false)
  })
})
