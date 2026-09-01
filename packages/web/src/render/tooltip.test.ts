import { describe, expect, it, vi } from 'vitest'

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
    visible = true
    eventMode = ''
    position = new Point()
    scale = new Point()
    // a bare container measures nothing; `Text` overrides both with its own box
    protected box = { w: 0, h: 0 }
    get width(): number {
      return this.box.w
    }
    get height(): number {
      return this.box.h
    }
    addChild(...cs: Container[]): void {
      this.children.push(...cs)
    }
    destroy(): void {}
  }
  class Graphics extends Container {
    clear(): this {
      return this
    }
    roundRect(): this {
      return this
    }
    rect(): this {
      return this
    }
    fill(): this {
      return this
    }
    stroke(): this {
      return this
    }
  }
  class Text extends Container {
    text: string
    anchor = new Point()
    resolution = 1
    constructor(opts?: { text?: string }) {
      super()
      this.text = opts?.text ?? ''
    }
    // a 7px-per-character monospace stand-in, so a size is deterministic in a test
    override get width(): number {
      return this.text.length * 7
    }
    override get height(): number {
      return 12
    }
  }
  class BitmapText extends Text {}
  const Cache = { has: () => false }
  return { BitmapText, Cache, Container, Graphics, Point, Text }
})

import type { Anchor, Rect } from './tooltip.js'
import type { PlateRow } from '../ui/plateModel.js'

/** The plate's rows, from the one-line shorthand these placement tests are written in. */
const rows = (text: string): PlateRow[] => (text === '' ? [] : [{ text, tone: 'name' }])

const {
  EDGE_PAD_PX,
  MAX_STACK_STEPS,
  STACK_STEP_PX,
  TAG_GAP_PX,
  anchorForSprite,
  createTooltipLayer,
  overlaps,
  placeTag,
} = await import('./tooltip.js')

const VIEW: Rect = { x: 0, y: 0, w: 800, h: 600 }
const SIZE = { w: 60, h: 18 }
const anchor = (sx: number, sy: number, topY = sy - 40, halfW = 14): Anchor => ({
  sx,
  sy,
  halfW,
  topY,
})
const rectOf = (p: { sx: number; sy: number }, size = SIZE): Rect => ({
  x: p.sx - size.w / 2,
  y: p.sy,
  w: size.w,
  h: size.h,
})
const inside = (r: Rect, v: Rect): boolean =>
  r.x >= v.x && r.y >= v.y && r.x + r.w <= v.x + v.w && r.y + r.h <= v.y + v.h

describe('placeTag — one rule for every label in the product', () => {
  it('centres above the anchor, one gap clear of what is drawn', () => {
    const a = anchor(400, 300)
    const p = placeTag(a, SIZE, VIEW)
    expect(p.side).toBe('above')
    expect(p.sx).toBe(400)
    expect(p.sy + SIZE.h).toBe(a.topY - TAG_GAP_PX)
  })

  it('flips below when the anchor’s top is against the top of the view', () => {
    const p = placeTag(anchor(400, 30, 4), SIZE, VIEW)
    expect(p.side).toBe('below')
    expect(p.sy).toBe(30 + TAG_GAP_PX)
  })

  it('goes beside the anchor when the view is too short for either', () => {
    const short: Rect = { x: 0, y: 0, w: 800, h: 60 }
    const p = placeTag(anchor(400, 40, 10), SIZE, short)
    expect(p.side).toBe('right')
  })

  it('never leaves the view, over 40 sampled anchors including all four corners', () => {
    const xs = [0, 1, 5, 399, 795, 799, 800]
    const ys = [0, 1, 5, 299, 595, 599, 600]
    let checked = 0
    for (const sx of xs) {
      for (const sy of ys) {
        const p = placeTag(anchor(sx, sy, sy - 40), SIZE, VIEW)
        expect(inside(rectOf(p), VIEW), `anchor ${sx},${sy}`).toBe(true)
        checked++
      }
    }
    expect(checked).toBeGreaterThanOrEqual(40)
  })

  it('steps clear of an occupied box and stops overlapping', () => {
    const a = anchor(400, 300)
    const bare = placeTag(a, SIZE, VIEW)
    const taken: Rect = { ...rectOf(bare) }
    const p = placeTag(a, SIZE, VIEW, [taken])
    const moved = rectOf(p)
    expect(moved.y + moved.h).toBeLessThanOrEqual(taken.y)
    expect(taken.y - (moved.y + moved.h)).toBe(STACK_STEP_PX)
  })

  it('clears up to three occupied boxes and never loops for ever', () => {
    const a = anchor(400, 400)
    const stack: Rect[] = []
    for (let i = 0; i < MAX_STACK_STEPS; i++) {
      const p = placeTag(a, SIZE, VIEW, stack)
      const r = rectOf(p)
      for (const s of stack) {
        expect(r.x < s.x + s.w && s.x < r.x + r.w && r.y < s.y + s.h && s.y < r.y + r.h).toBe(false)
      }
      stack.push(r)
    }
    expect(stack).toHaveLength(MAX_STACK_STEPS)
  })

  it('keeps the edge pad on every side', () => {
    for (const [sx, sy] of [
      [0, 0],
      [800, 0],
      [0, 600],
      [800, 600],
    ] as const) {
      const r = rectOf(placeTag(anchor(sx, sy), SIZE, VIEW))
      expect(r.x).toBeGreaterThanOrEqual(VIEW.x + EDGE_PAD_PX)
      expect(r.y).toBeGreaterThanOrEqual(VIEW.y + EDGE_PAD_PX)
      expect(r.x + r.w).toBeLessThanOrEqual(VIEW.x + VIEW.w - EDGE_PAD_PX)
      expect(r.y + r.h).toBeLessThanOrEqual(VIEW.y + VIEW.h - EDGE_PAD_PX)
    }
  })
})

describe('anchorForSprite — the defect was subtracting a height from the bottom of it', () => {
  it('puts the top above the DRAWN roof of a base-anchored 1.85× building', () => {
    // a 2×2 building: ground at (0, 328), sprite 128 px tall rising from that point
    const a = anchorForSprite({ x: 0, y: 328 }, { width: 128, height: 128 })
    expect(a.sx).toBe(0)
    expect(a.sy).toBe(328)
    expect(a.topY).toBe(200)
    expect(a.topY).toBeLessThan(a.sy) // above the roof, not below the floor
    expect(a.halfW).toBe(64)
  })

  it('is the same rule for a body — nothing has a rule of its own any more', () => {
    const a = anchorForSprite({ x: 40, y: 100 }, { width: 28, height: 52 })
    expect([a.sx, a.sy, a.topY, a.halfW]).toEqual([40, 100, 48, 14])
  })
})

describe('createTooltipLayer — one owner, so nothing is ever left behind', () => {
  const layers = (): unknown => ({
    worldText: {
      children: [] as unknown[],
      addChild(...cs: unknown[]): void {
        this.children.push(...cs)
      },
    },
  })
  const view = (): Rect => VIEW

  it('keeps two owners’ boxes disjoint', () => {
    const l = createTooltipLayer(layers() as never, view)
    l.show('hover', rows('the storehouse'), anchor(400, 300))
    l.show('door', rows('Look inside — the storehouse'), anchor(400, 300))
    // the second tag must not land on the first
    const boxes = l.boxes().map((b) => b.rect)
    expect(boxes).toHaveLength(2)
    const [a, b] = boxes
    expect(
      a!.y < b!.y + b!.h && b!.y < a!.y + a!.h && a!.x < b!.x + b!.w && b!.x < a!.x + a!.w,
    ).toBe(false)
  })

  it('never shows a tag for an empty string', () => {
    const l = createTooltipLayer(layers() as never, view)
    l.show('hover', rows(''), anchor(400, 300))
    expect(l.boxes()).toHaveLength(0)
  })

  it('hideAll clears every owner — the interior transition calls this', () => {
    const l = createTooltipLayer(layers() as never, view)
    l.show('hover', rows('a house'), anchor(100, 100))
    l.show('door', rows('Look inside'), anchor(300, 300))
    expect(l.boxes()).toHaveLength(2)
    l.hideAll()
    expect(l.boxes()).toHaveLength(0)
  })

  it('hide clears exactly one owner', () => {
    const l = createTooltipLayer(layers() as never, view)
    l.show('hover', rows('a house'), anchor(100, 100))
    l.show('door', rows('Look inside'), anchor(300, 300))
    l.hide('hover')
    expect(l.boxes()).toHaveLength(1)
  })

  it('keeps a plate off a speech bubble that has registered its box', () => {
    const l = createTooltipLayer(layers() as never, view)
    const a = anchor(400, 300)
    const bare = placeTag({ ...a, prefer: 'below' }, { w: 14 * 7 + 10, h: 18 }, VIEW)
    const bubble = { x: bare.sx - 60, y: bare.sy - 4, w: 120, h: 60 }
    l.setOccupied('bubbles', [bubble])
    l.show('hover', rows('the storehouse'), a)
    const [box] = l.boxes().map((b) => b.rect)
    expect(overlaps(box!, bubble)).toBe(false)
    // ...and it was pushed DOWN, away from the footprint it is welded to, not up over the roof
    expect(box!.y).toBeGreaterThan(bare.sy)
  })

  // ★ The nameplate is DOM over the canvas: nothing drawn IN the canvas can see it, so a
  // bubble pushed below a figure used to land under the plate that names them.
  it('★ hands every owner but the asker back, so a bubble can keep off the plate', () => {
    const l = createTooltipLayer(layers() as never, view)
    const plate = { x: 10, y: 20, w: 60, h: 20 }
    const bubble = { x: 200, y: 40, w: 90, h: 30 }
    l.setOccupied('plate', [plate])
    l.setOccupied('bubbles', [bubble])
    expect(l.occupied('bubbles')).toEqual([plate])
    expect(l.occupied()).toEqual(expect.arrayContaining([plate, bubble]))
  })
})
