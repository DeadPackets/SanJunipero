import { describe, expect, it } from 'vitest'
import type { Structure } from '@sj/engine/state'
import { depthKey } from './iso.js'
import { ENTERABLE_KINDS, doorTileOf, doorZIndex, structureZIndex } from './entities.js'

// FIX ROUND 2 defect 2: the door affordance was drawn at the door TILE's depth, but the
// building it belongs to is depth-sorted from its FAR corner — a whole depth row higher. In
// a sortableChildren container the top-most child takes the pointer, so the building's
// (wider than its own diamond) sprite swallowed every hover and the door never lit.

const box = (x: number, y: number, w: number, h: number, kind = 'hut'): Structure => ({
  id: `s-${x}-${y}`, kind, x, y, w, h, hp: 50, maxHp: 50, flammable: true,
  stage: 'complete', progressTicks: 0, builtBy: null, burning: false, burnTicks: 0,
})

const SHAPES: Array<[number, number]> = [[1, 1], [2, 2], [1, 2], [2, 1], [3, 2], [2, 3]]

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

describe('the door out-ranks its own building', () => {
  it('takes the pointer at the door tile, whatever the footprint', () => {
    for (const [w, h] of SHAPES) {
      const s = box(10, 10, w, h)
      expect(doorZIndex(s), `${w}x${h}`).toBeGreaterThan(structureZIndex(s))
    }
  })

  it('was the bug: the door tile\'s own depth loses to the building by a whole row', () => {
    const s = box(10, 10, 2, 2)
    const d = doorTileOf(s)
    expect(depthKey(d.x, d.y)).toBeLessThan(structureZIndex(s))   // the old value — pointer lost
    expect(doorZIndex(s)).toBeGreaterThan(structureZIndex(s))     // the new one — pointer won
  })

  it('still lets a building one row nearer the camera occlude the door behind it', () => {
    const back = box(10, 10, 2, 2)
    const front = box(10, 12, 2, 2)          // two rows south — unambiguously in front
    expect(structureZIndex(front)).toBeGreaterThan(doorZIndex(back))
  })

  it("rides just above its own building, not above the whole map", () => {
    const s = box(10, 10, 2, 2)
    // the door rides just above its building, not above the whole map
    expect(doorZIndex(s) - structureZIndex(s)).toBeLessThan(1000)
  })
})

describe('ENTERABLE_KINDS', () => {
  it('is exactly the three interior kinds — a well or a wagon grows no door', () => {
    expect([...ENTERABLE_KINDS].sort()).toEqual(['hut', 'shed', 'storehouse'])
    for (const kind of ['well', 'fire_pit', 'wagon', 'standing_stone', 'scaffolding']) {
      expect(ENTERABLE_KINDS.has(kind), kind).toBe(false)
    }
  })
})
