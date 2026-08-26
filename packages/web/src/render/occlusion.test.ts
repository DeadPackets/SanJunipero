import { beforeEach, describe, expect, it } from 'vitest'
import { makeCityTemplate } from '@sj/shared'
import { depthKey } from './iso.js'
import { doorTileOf, structureZIndex } from './entities.js'
import {
  bodyDepthBox,
  depthFallbacks,
  depthOrder,
  resetDepthFallbacks,
  screenOverlap,
  structureDepthBox,
  type DepthBox,
} from './depth.js'

// The oracle derives depth from the projection alone, knowing nothing of depth.ts: a screen
// column fixes u = x − y, and "nearer the viewer" is a larger f = x + y in that same column.

export function expectedInFront(s: DepthBox, tile: { x: number; y: number }): boolean | 'level' {
  const u = tile.x - tile.y
  const sMax = Math.min(2 * s.x1 - u, 2 * s.y1 + u)
  const sMin = Math.max(2 * s.x0 - u, 2 * s.y0 + u)
  if (sMin > sMax) return 'level' // this column misses its ground entirely
  const feet = tile.x + tile.y
  if (feet > sMax) return true
  if (feet < sMin) return false
  return 'level'
}

// The same template `devTown()` instantiates, not a fixture. The ids carry the anchor in their
// coordinates, so a moved anchor fails loudly instead of testing a different town.
const ANCHOR = { x: 0, y: 9 } // gateway SHOWCASE_ANCHOR
const town = {
  anchor: ANCHOR,
  structures: makeCityTemplate(ANCHOR).structures.map((s) => ({
    id: `structure_${s.kind}_${ANCHOR.x + s.dx}_${ANCHOR.y + s.dy}`,
    kind: s.kind,
    owner: s.owner,
    x: ANCHOR.x + s.dx,
    y: ANCHOR.y + s.dy,
    w: s.w,
    h: s.h,
  })),
}
const boxes = town.structures.map((s) => structureDepthBox(s.id, s))
const before = (order: string[], a: string, b: string): boolean =>
  order.indexOf(a) < order.indexOf(b)

/** The landed rule, restated so the before-state can be measured rather than remembered:
 *  a structure sorted from its far corner, a body from its ROUNDED tile plus one. */
function landedInFront(
  s: { x: number; y: number; w: number; h: number },
  tile: { x: number; y: number },
): boolean {
  return depthKey(Math.round(tile.x), Math.round(tile.y)) + 1 > structureZIndex(s)
}

const RADIUS = 4

type Disagreement = { structure: string; tile: string; oracle: boolean; got: boolean }

function sweep(judge: (s: DepthBox, i: number, tile: { x: number; y: number }) => boolean): {
  decided: number
  disagreements: Disagreement[]
} {
  const out: Disagreement[] = []
  let decided = 0
  for (const [i, box] of boxes.entries()) {
    const s = town.structures[i]!
    for (let x = s.x - RADIUS; x < s.x + s.w + RADIUS; x++) {
      for (let y = s.y - RADIUS; y < s.y + s.h + RADIUS; y++) {
        const oracle = expectedInFront(box, { x, y })
        if (oracle === 'level') continue
        const body = bodyDepthBox('body', x, y)
        if (!screenOverlap(body, box)) continue // nothing to occlude, nothing to judge
        decided++
        const got = judge(box, i, { x, y })
        if (got !== oracle) out.push({ structure: s.id, tile: `(${x},${y})`, oracle, got })
      }
    }
  }
  return { decided, disagreements: out }
}

beforeEach(() => resetDepthFallbacks())

describe('the walk-around, on the eleven buildings of the real town', () => {
  it('is the real town — eleven buildings, five of them owned', () => {
    expect(town.structures).toHaveLength(11)
    expect(town.structures.filter((s) => s.owner !== null)).toHaveLength(5)
    expect([...new Set(town.structures.map((s) => s.kind))].sort()).toEqual([
      'cabin',
      'cottage',
      'farmhouse',
      'fire_pit',
      'house',
      'storehouse',
      'well',
    ])
  })

  it('MEASURES U8: the landed rule disagreed with the geometry on this many tiles', () => {
    const { decided, disagreements } = sweep((_b, i, tile) =>
      landedInFront(town.structures[i]!, tile),
    )
    expect(decided).toBe(432)
    // One tie per frontage face: the tiles where the landed rule drew a body at a door behind
    // the building it stood in front of.
    expect(
      disagreements.map((d) => `${d.structure} ${d.tile} oracle=${d.oracle} got=${d.got}`),
    ).toEqual([
      'structure_storehouse_36_14 (36,16) oracle=true got=false',
      'structure_house_36_21 (36,23) oracle=true got=false',
      'structure_house_24_26 (24,28) oracle=true got=false',
      'structure_cottage_31_26 (31,28) oracle=true got=false',
      'structure_cottage_31_26 (32,28) oracle=true got=false',
      'structure_house_36_52 (36,54) oracle=true got=false',
      'structure_cabin_36_59 (36,61) oracle=true got=false',
      'structure_house_24_64 (24,66) oracle=true got=false',
      'structure_house_31_64 (31,66) oracle=true got=false',
      'structure_farmhouse_55_33 (55,37) oracle=true got=false',
      'structure_farmhouse_55_33 (57,33) oracle=true got=false',
      'structure_farmhouse_55_33 (57,34) oracle=true got=false',
    ])
    expect(disagreements).toHaveLength(12)
  })

  it('the new sort disagrees with the geometry on NO tile', () => {
    const { decided, disagreements } = sweep((box, _i, tile) =>
      before(depthOrder([box, bodyDepthBox('body', tile.x, tile.y)]), box.id, 'body'),
    )
    expect(decided).toBe(432)
    expect(
      disagreements.map((d) => `${d.structure} at ${d.tile}: oracle ${d.oracle}, got ${d.got}`),
    ).toEqual([])
  })

  it('never flips twice along a traversal — a body does not flicker past a wall', () => {
    const flips: string[] = []
    for (const [i, box] of boxes.entries()) {
      const s = town.structures[i]!
      for (let x = s.x - RADIUS; x < s.x + s.w + RADIUS; x++) {
        let changes = 0
        let prev: boolean | null = null
        for (let step = 0; step <= (2 * RADIUS + s.h) * 8; step++) {
          // mid-step sampling
          const y = s.y - RADIUS + step / 8
          const front = before(depthOrder([box, bodyDepthBox('body', x, y)]), box.id, 'body')
          if (prev !== null && front !== prev) changes++
          prev = front
        }
        if (changes > 1) flips.push(`${s.id} column x=${x}: ${changes} flips`)
      }
    }
    expect(flips).toEqual([])
  })

  it('draws a body standing on a building’s own door tile in front of it', () => {
    for (const [i, box] of boxes.entries()) {
      const s = town.structures[i]!
      const d = doorTileOf(s)
      const order = depthOrder([box, bodyDepthBox('body', d.x, d.y)])
      expect(before(order, box.id, 'body'), `${s.id} door ${d.x},${d.y}`).toBe(true)
    }
  })

  it('draws a body anywhere INSIDE a footprint in front of it, never inside it', () => {
    for (const [i, box] of boxes.entries()) {
      const s = town.structures[i]!
      for (let x = s.x; x < s.x + s.w; x++) {
        for (let y = s.y; y < s.y + s.h; y++) {
          const order = depthOrder([box, bodyDepthBox('body', x, y)])
          expect(before(order, box.id, 'body'), `${s.id} inside ${x},${y}`).toBe(true)
        }
      }
    }
  })

  it('orders two bodies on the same tile by id, and never swaps them between frames', () => {
    const a = bodyDepthBox('amara', 20, 20),
      o = bodyDepthBox('omar', 20, 20)
    for (let frame = 0; frame < 10; frame++) {
      expect(depthOrder(frame % 2 === 0 ? [a, o] : [o, a])).toEqual(['amara', 'omar'])
    }
  })

  it('sorts the WHOLE town plus five founders with no fallback at all', () => {
    const founders = ['amara', 'nadia', 'omar', 'salma', 'yusuf']
    for (let step = 0; step < 200; step++) {
      const bodies = founders.map((id, i) =>
        bodyDepthBox(
          id,
          town.anchor.x + 14 + i * 2 + (step % 17) / 17,
          town.anchor.y + 6 + (step % 23) / 23,
        ),
      )
      const order = depthOrder([...boxes, ...bodies])
      expect(order).toHaveLength(boxes.length + bodies.length)
      expect(new Set(order).size).toBe(order.length)
    }
    expect(depthFallbacks()).toEqual({ frames: 0, nodes: 0 })
  })
})
