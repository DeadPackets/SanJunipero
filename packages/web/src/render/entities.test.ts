import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Structure } from '@sj/engine/state'
import { TILE_H, depthKey, tileToScreen } from './iso.js'
import {
  BUILDING_PX_PER_TILE, ENTERABLE_KINDS, doorTileOf, footprintHitPoints, structureZIndex,
} from './entities.js'
import { HIT_MIN_PX, doorLocalCentre, doorLocalRect, doorSillPolygon, resolveHit } from './hitShapes.js'
import { rendersOnMap } from './characters.js'

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

// P9d IS REPEALED (controller ruling R6). The door used to be a SIBLING of its building at
// `structureZIndex + 1`, which is how it painted over anybody standing in the doorway (U11)
// and how its 10 × 13 target lost every contest with the 52 × 72 body box (audit M5). It is
// now a CHILD of the building sprite: a child cannot sort against its parent, and Pixi
// hit-tests children before parents, so the door wins its own click with no priority table.
describe('the door is part of the building', () => {
  const src = readFileSync(new URL('./entities.ts', import.meta.url), 'utf8')

  it('is added to the SPRITE, not to the scene', () => {
    expect(src).toContain('entry.sprite.addChild(door)')
    expect(src).not.toContain('scene.layers.entities.addChild(door)')
  })

  it('has no depth of its own any more — doorZIndex is deleted, and that is the test', () => {
    expect(src).not.toContain('doorZIndex')
    expect(src).not.toContain('DOOR_Z_OVER_BUILDING')
  })

  it('is a lit sill on the ground, not a dark plate over the building’s own face', () => {
    expect(src).toContain('doorSillPolygon')
    expect(src).toContain('DOOR_SILL')
    expect(src).toContain('DOOR_LINTEL')
    expect(src).not.toContain('roundRect(-DOOR_W')
    expect(src).not.toContain('DOOR_RECESS')   // the dark slab is gone, and that is the test
  })

  it('gives a 1×1 frontage a target at least HIT_MIN_PX in both axes — it was 10 × 13', () => {
    const r = doorLocalRect({ w: 1, h: 1 }, 1)
    expect(r.w).toBeGreaterThanOrEqual(HIT_MIN_PX)
    expect(r.h).toBeGreaterThanOrEqual(HIT_MIN_PX)
    expect([10, 13].every((v) => v >= HIT_MIN_PX)).toBe(false)   // the landed size, for the record
  })

  it('scales inversely with the sprite, so the door is one size on screen', () => {
    for (const scale of [0.0625, 0.25, 1, 2]) {
      const r = doorLocalRect({ w: 2, h: 2 }, scale)
      expect(r.w * scale, `scale ${scale}`).toBeCloseTo(doorLocalRect({ w: 2, h: 2 }, 1).w, 9)
      expect(r.h * scale, `scale ${scale}`).toBeCloseTo(doorLocalRect({ w: 2, h: 2 }, 1).h, 9)
    }
  })

  it('sits on the south face, centred on the frontage the resident walks out of', () => {
    for (const [w, h] of SHAPES) {
      const r = doorLocalRect({ w, h }, 1)
      const s = box(10, 10, w, h)
      const d = doorTileOf(s)
      // the door tile's centre, expressed against the sprite's own origin
      const ddx = d.x - s.x - (w / 2 - 0.5), ddy = d.y - s.y - (h / 2 - 0.5)
      expect(r.x + r.w / 2, `${w}x${h}`).toBeCloseTo((ddx - ddy) * 16, 9)
      expect(r.y + r.h / 2, `${w}x${h}`).toBeCloseTo((ddx + ddy) * 8 + 8, 9)
    }
  })

  it('draws the sill inside the door tile it names — it can never cover a neighbour', () => {
    for (const [w, h] of SHAPES) {
      const poly = doorSillPolygon({ w, h }, 1)
      const c = doorLocalCentre({ w, h })
      const xs = poly.filter((_, i) => i % 2 === 0), ys = poly.filter((_, i) => i % 2 === 1)
      expect(Math.max(...xs) - Math.min(...xs), `${w}x${h}`).toBeLessThanOrEqual(32)
      expect(Math.max(...ys) - Math.min(...ys), `${w}x${h}`).toBeLessThanOrEqual(16)
      expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(c.x, 9)
      expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(c.y, 9)
    }
  })

  it('resolveHit: a door beats a body, a body beats a building, nothing beats nothing', () => {
    expect(resolveHit([{ kind: 'agent', id: 'a' }, { kind: 'door', id: 'd' }])).toBe('d')
    expect(resolveHit([{ kind: 'structure', id: 's' }, { kind: 'agent', id: 'a' }])).toBe('a')
    expect(resolveHit([{ kind: 'crop', id: 'c' }, { kind: 'item', id: 'i' }])).toBe('i')
    expect(resolveHit([])).toBeNull()
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


// FIX ROUND 3. Pixi hit-tests a sprite's full RECTANGULAR bounds, transparent margin and
// all, and a building sprite is ~1.85x wider than the ground it stands on. Live repros at 3x
// in the showcase dev world: hovering the STOREHOUSE door reported "wagon", and hovering the
// HUT door reported nothing — in both cases a structure one depth row south was intercepting
// the pointer with empty padding. The hit area is now the footprint diamond, which cannot
// reach past the tiles the building occupies.

// the sprite sits at the top vertex of its centre tile; local points are offsets from there
function worldHitPolygon(s: Structure): Array<[number, number]> {
  const at = tileToScreen(s.x + s.w / 2 - 0.5, s.y + s.h / 2 - 0.5)
  const pts = footprintHitPoints(s.w, s.h)
  return [0, 1, 2, 3].map((i) => [at.sx + pts[i * 2]!, at.sy + pts[i * 2 + 1]!])
}

function contains(poly: Array<[number, number]>, px: number, py: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// where a viewer's pointer actually is when hovering the drawn door
function doorPoint(s: Structure): [number, number] {
  const d = doorTileOf(s)
  const at = tileToScreen(d.x, d.y)
  return [at.sx, at.sy + TILE_H / 2]
}

describe('a structure hit-tests its ground, never its padding', () => {
  it('covers its own door tile — the building is still hoverable where it stands', () => {
    for (const [w, h] of SHAPES) {
      const s = box(20, 20, w, h)
      const [px, py] = doorPoint(s)
      expect(contains(worldHitPolygon(s), px, py), `${w}x${h}`).toBe(true)
    }
  })

  it('LIVE REPRO: the wagon does not intercept the storehouse door', () => {
    const storehouse = box(20, 20, 2, 2, 'storehouse')
    const wagon = box(26, 25, 1, 2, 'wagon')          // dev-world TOWN_STRUCTURES coordinates
    const [px, py] = doorPoint(storehouse)
    expect(contains(worldHitPolygon(wagon), px, py)).toBe(false)
  })

  it('LIVE REPRO: the scaffolding does not intercept the hut door', () => {
    const hut = box(30, 20, 2, 2, 'hut')
    const scaffolding = box(34, 23, 1, 1, 'scaffolding')
    const [px, py] = doorPoint(hut)
    expect(contains(worldHitPolygon(scaffolding), px, py)).toBe(false)
  })

  it('no structure anywhere in the dev town reaches another structure\'s door', () => {
    const town = [
      box(20, 20, 2, 2, 'storehouse'), box(23, 20, 1, 1, 'shed'), box(30, 20, 2, 2, 'hut'),
      box(26, 25, 1, 2, 'wagon'), box(34, 23, 1, 1, 'scaffolding'), box(15, 28, 1, 1, 'standing_stone'),
    ]
    for (const target of town) {
      const [px, py] = doorPoint(target)
      for (const other of town) {
        if (other === target) continue
        expect(contains(worldHitPolygon(other), px, py), `${other.kind} eats ${target.kind}'s door`).toBe(false)
      }
    }
  })

  it('proves the fix is load-bearing: the OLD rectangular bounds did swallow that point', () => {
    // what Pixi hit-tested before: the whole sprite, a (w+h)*BUILDING_PX_PER_TILE square
    // anchored bottom-centre at the ground point — transparent canopy margin included
    const oldBounds = (s: Structure): Array<[number, number]> => {
      const at = tileToScreen(s.x + s.w / 2 - 0.5, s.y + s.h / 2 - 0.5)
      const side = (s.w + s.h) * BUILDING_PX_PER_TILE
      return [
        [at.sx - side / 2, at.sy - side], [at.sx + side / 2, at.sy - side],
        [at.sx + side / 2, at.sy], [at.sx - side / 2, at.sy],
      ]
    }
    const [sx, sy] = doorPoint(box(20, 20, 2, 2, 'storehouse'))
    expect(contains(oldBounds(box(26, 25, 1, 2, 'wagon')), sx, sy)).toBe(true)   // the bug
    expect(contains(worldHitPolygon(box(26, 25, 1, 2, 'wagon')), sx, sy)).toBe(false) // the fix
  })

  it('is a diamond the size of the footprint, and scales with the sprite', () => {
    // a 1x1 is the tile diamond itself: 32 wide, 16 tall, top vertex at the origin
    expect(footprintHitPoints(1, 1)).toEqual([0, 0, 16, 8, 0, 16, -16, 8])
    // a 2x2 is twice as wide and twice as tall
    expect(footprintHitPoints(2, 2)).toEqual([0, -8, 32, 8, 0, 24, -32, 8])
    // the sprite scales its hit area, so the points are pre-divided
    expect(footprintHitPoints(1, 1, 2)).toEqual([0, 0, 8, 4, 0, 8, -8, 4])
  })

  it('never reaches wider than the ground it stands on', () => {
    for (const [w, h] of SHAPES) {
      const xs = footprintHitPoints(w, h).filter((_, i) => i % 2 === 0)
      expect(Math.max(...xs) - Math.min(...xs)).toBe((w + h) * 16)
    }
  })
})


// FINAL ROUND. The controller saw a founder "sleeping OUTDOORS next to the hut with a
// blanket". A 5500-tick measurement of the dev world says nobody ever sleeps or collapses
// outdoors — so that was an occupant asleep INSIDE the cottage, still being drawn on the town
// map at the door tile they walked in through, because the character layer only ever checked
// `alive`.
describe('rendersOnMap', () => {
  it('draws the living who are out of doors', () => {
    expect(rendersOnMap({ alive: true })).toBe(true)
    expect(rendersOnMap({ alive: true, insideId: undefined })).toBe(true)
  })

  it('does NOT draw someone who has gone inside — the interior scene has them', () => {
    expect(rendersOnMap({ alive: true, insideId: 'structure_cottage' })).toBe(false)
  })

  it('still does not draw the dead', () => {
    expect(rendersOnMap({ alive: false })).toBe(false)
    expect(rendersOnMap({ alive: false, insideId: 'structure_cottage' })).toBe(false)
  })
})
