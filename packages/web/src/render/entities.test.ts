import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Structure, WorldState } from '@sj/engine/state'
import { depthKey, tileToScreen } from './iso.js'
import {
  BUILDING_PX_PER_TILE, BUILD_TICKS_FULL, ENTERABLE_KINDS, LOOK_INSIDE, PIP_COUNT, doorTileOf,
  entersOnClick, footprintHitPoints, pipsFilled, structureHitPoints, structureHoverText,
  structureZIndex,
} from './entities.js'
import { polygonBounds, resolveHit } from './hitShapes.js'
import { builtFormSpec } from './builtForm.js'
import { inFrontOf, structureDepthBox } from './depth.js'
import { rendersOnMap } from './characters.js'

// FIX ROUND 2 defect 2: the door affordance was drawn at the door TILE's depth, but the
// building it belongs to is depth-sorted from its FAR corner — a whole depth row higher. In
// a sortableChildren container the top-most child takes the pointer, so the building's
// (wider than its own diamond) sprite swallowed every hover and the door never lit.

const box = (x: number, y: number, w: number, h: number, kind = 'house'): Structure => ({
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

// ★ THE TWO CLICK SQUARES ARE RETIRED AND ONE HITBOX REPLACES BOTH.
//
// A building carried a SEPARATE `Rectangle` target on its door tile under a honey sill drawn
// flat on the ground. It is gone: a building is one object and takes one pointer, and what a
// click MEANS is a property of the building — enterable and complete goes in, everything else
// tells its story. `InteriorBar` puts the same provenance line at the top of the room, so the
// nine enterable buildings lose nothing by giving the popover up.
describe('one building, one hitbox, and the building says what a click does', () => {
  const src = readFileSync(new URL('./entities.ts', import.meta.url), 'utf8')
  const code = src.split('\n').map((l) => l.trim())
    .filter((l) => !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*')).join('\n')

  const world = (structures: Structure[]): WorldState =>
    ({ structures: Object.fromEntries(structures.map((s) => [s.id, s])) }) as unknown as WorldState

  it('has no door node, no door graphics and no rectangle hit area left', () => {
    for (const gone of [
      'entry.sprite.addChild(door)', 'doorZIndex', 'DOOR_Z_OVER_BUILDING', 'doorSillPolygon',
      'DOOR_SILL', 'DOOR_LINTEL', 'DOOR_RIM', 'doorLocalRect', 'new Rectangle(', 'layoutDoor',
    ]) expect(code, gone).not.toContain(gone)
  })

  it('routes the click by what the building IS, not by where inside it the pointer landed', () => {
    const house = box(4, 4, 2, 2, 'house')
    const well = box(9, 9, 1, 1, 'well')
    const shell: Structure = { ...box(12, 12, 2, 2, 'house'), id: 'shell', stage: 'construction' }
    expect(entersOnClick(world([house, well, shell]), house.id)).toBe(true)
    expect(entersOnClick(world([house, well, shell]), well.id)).toBe(false)
    expect(entersOnClick(world([house, well, shell]), 'shell')).toBe(false)
    expect(entersOnClick(null, house.id)).toBe(false)
    expect(entersOnClick(world([]), 'nobody')).toBe(false)
  })

  it('and the hover tag SAYS which, before the click is made', () => {
    const house = box(4, 4, 2, 2, 'house')
    const well = box(9, 9, 1, 1, 'well')
    const st = world([house, well])
    expect(structureHoverText(st, house.id)).toBe(`house · ${LOOK_INSIDE}`)
    expect(structureHoverText(st, well.id)).toBe('well')
    expect(structureHoverText(st, 'nobody')).toBeNull()
  })

  it('and it spends ONE em-dash, because the name already spent the other', () => {
    const built: Structure = { ...box(4, 4, 2, 2, 'house'), builtBy: 'omar' }
    const st = ({
      structures: { [built.id]: built }, agents: { omar: { id: 'omar', name: 'Omar' } },
    }) as unknown as WorldState
    const tag = structureHoverText(st, built.id)!
    expect(tag).toBe(`house — built by Omar · ${LOOK_INSIDE}`)
    expect(tag.split('—')).toHaveLength(2)   // LOOK INSIDE — HOUSE — BUILT BY OMAR had three
  })

  it('the sprite is the one thing wired to the pointer — nothing else in the file is', () => {
    expect(code).toContain("sprite.eventMode = 'static'")
    expect(code).not.toMatch(/door\.eventMode/)
    // the two meanings both hang off the one tap handler
    expect(code).toMatch(/entersOnClick\(store\.getState\(\), sid\)/)
    expect(code).toMatch(/sync!\.onDoor\?\.\(sid\)/)
  })

  it('resolveHit: a body beats a building, nothing beats nothing', () => {
    expect(resolveHit([{ kind: 'structure', id: 's' }, { kind: 'agent', id: 'a' }])).toBe('a')
    expect(resolveHit([{ kind: 'crop', id: 'c' }, { kind: 'item', id: 'i' }])).toBe('i')
    expect(resolveHit([])).toBeNull()
  })
})

describe('ENTERABLE_KINDS', () => {
  it('is exactly the three interior kinds — a well or a wagon grows no door', () => {
    expect([...ENTERABLE_KINDS].sort()).toEqual(['house', 'shed', 'storehouse'])
    for (const kind of ['well', 'fire_pit', 'wagon', 'standing_stone', 'scaffolding']) {
      expect(ENTERABLE_KINDS.has(kind), kind).toBe(false)
    }
  })
})


// ★ WHAT A CLICK ON A BUILDING NOW HITS, AND WHAT THE OLD TARGET MISSED.
//
// Pixi hit-tests a sprite's full RECTANGULAR bounds unless a hitArea says otherwise, and a
// building sprite is 1.9× – 2.0× wider than the ground it stands on — which is how a wagon's
// empty canopy padding used to intercept the storehouse. The answer to that was the flat
// footprint diamond, and the answer went too far: measured against every codex root's decoded
// alpha it contained 0.0 % – 0.8 % of the building's DRAWN pixels.
//
// The prism is the middle that is not a compromise: it is the drawn cell with its corners cut
// off by the diamond, so it can claim no pixel outside the picture and it misses almost none
// inside it.

// the sprite sits at the top vertex of its centre tile; local points are offsets from there
function spriteAt(s: Structure): { sx: number; sy: number } {
  return tileToScreen(s.x + s.w / 2 - 0.5, s.y + s.h / 2 - 0.5)
}
function worldPoly(local: number[], s: Structure): Array<[number, number]> {
  const at = spriteAt(s)
  return Array.from({ length: local.length / 2 }, (_, i) =>
    [at.sx + local[i * 2]!, at.sy + local[i * 2 + 1]!] as [number, number])
}

function contains(poly: Array<[number, number]>, px: number, py: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
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
function drawnCorners(s: Structure): Array<[number, number]> {
  const at = spriteAt(s)
  const side = (s.w + s.h) * BUILDING_PX_PER_TILE
  return [
    [at.sx - side / 2 + 1, at.sy - 1], [at.sx + side / 2 - 1, at.sy - 1],
    [at.sx - side / 2 + 1, at.sy - side + 1], [at.sx + side / 2 - 1, at.sy - side + 1],
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

  it('★ NEIGHBOURS AT THE TOWN GRAMMAR\'S PROVEN 86.1626 px SPACING DO OVERLAP', () => {
    // Two houses on adjacent plots. Their prisms genuinely intersect on screen — that is not a
    // defect and it cannot be designed away, because the drawn buildings intersect. Which one
    // answers is settled by the DEPTH ORDER, in `layers.applyDepthOrder`, from the same boxes
    // the painter uses. This test exists so nobody "fixes" the overlap by shrinking a hitbox.
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
    expect(b.w).toBe(32)                                   // the footprint diamond's own width
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


// FINAL ROUND. The controller saw a founder "sleeping OUTDOORS next to the house with a
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
    expect(rendersOnMap({ alive: true, insideId: 'structure_house' })).toBe(false)
  })

  it('still does not draw the dead', () => {
    expect(rendersOnMap({ alive: false })).toBe(false)
    expect(rendersOnMap({ alive: false, insideId: 'structure_house' })).toBe(false)
  })
})

// ★ THE PROGRESS METER MEASURES THE BUILD THE WORLD IS ACTUALLY RUNNING.
//
// The denominator was a hardcoded 2880, transcribed from `DEFAULT_CONFIG.construction
// .houseTicks`. It is the only affordance that says a tinted building is GOING UP rather than
// simply odd-looking, and it was a second copy of a number the viewer already holds.
//
// The dev world raises a house in 240 ticks so somebody can watch one rise. Under the
// transcribed denominator a house finishing at 240 lights `floor((240/2880) x 4)` = ZERO pips
// - every house in the demo would stand under scaffolding for its whole build with the meter
// dark, and nothing would have failed.
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
