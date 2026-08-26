import { describe, expect, it } from 'vitest'
import {
  CROWD_DEPTH_PX,
  CROWD_PITCH_PX,
  CROWD_SETTLE_MS,
  CROWD_SPAN_PX,
  crowdOffset,
  crowdOffsets,
  screenToWorldOffset,
} from './crowd.js'
import { tileToScreen } from './iso.js'
import { BODY_SPRITE_W, bodyDepthBox, depthOrder, depthSeed, geometricEdge } from './depth.js'
import { MOTION, MOTION_CEILING_MS, MOTION_FLOOR_MS } from '../ui/motion.js'

/** Where occupant `i` of `n` is DRAWN, relative to the tile's own screen point. */
const screenOf = (i: number, n: number): { sx: number; sy: number } => {
  const o = crowdOffset(i, n)
  const at = tileToScreen(o.dx, o.dy)
  return { sx: at.sx, sy: at.sy }
}

const round = (v: number): number => Math.round(v * 1e6) / 1e6

describe('★ four people on one tile are four people', () => {
  it('a body standing alone is not moved at all', () => {
    expect(crowdOffset(0, 1)).toEqual({ dx: 0, dy: 0 })
    expect(crowdOffsets([{ id: 'a', x: 5, y: 5, settled: true }]).size).toBe(0)
  })

  it('★ THE RED: five bodies on one tile draw at five DIFFERENT screen points', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const { sx, sy } = screenOf(i, 5)
      seen.add(`${round(sx)},${round(sy)}`)
    }
    expect(seen.size).toBe(5)
  })

  it('and the gap between neighbours is a readable fraction of a drawn figure', () => {
    // A figure is BODY_SPRITE_W wide. Neighbours overlap — a crowd does — but never by so
    // much that the one behind has no silhouette of its own left.
    for (const n of [2, 3, 4, 5]) {
      for (let i = 1; i < n; i++) {
        const gap = Math.abs(screenOf(i, n).sx - screenOf(i - 1, n).sx)
        expect(gap).toBeCloseTo(CROWD_PITCH_PX, 6)
        expect(gap).toBeGreaterThan(BODY_SPRITE_W * 0.15)
      }
    }
  })

  it('adjacent bodies differ in DEPTH, so the nearer one owns the seam', () => {
    for (let i = 1; i < 6; i++) {
      const gap = screenOf(i, 6).sy - screenOf(i - 1, 6).sy
      expect(Math.abs(gap)).toBeCloseTo(CROWD_DEPTH_PX, 6)
    }
  })

  it('★ and the DEPTH SORT agrees with the picture: no two of a rank tie', () => {
    // A tie in depthSeed is settled by id, i.e. by nothing. The alternating step exists so
    // that never happens, and this is the assertion that says so.
    const seeds = new Set<number>()
    for (let i = 0; i < 5; i++) {
      const o = crowdOffset(i, 5)
      seeds.add(round(depthSeed(bodyDepthBox(`b${i}`, 40 + o.dx, 40 + o.dy))))
    }
    expect(seeds.size).toBe(5)
  })

  it('the rank is centred on its tile — the crowd stands where the record says it does', () => {
    for (const n of [2, 3, 4, 5, 9]) {
      let sx = 0
      for (let i = 0; i < n; i++) sx += screenOf(i, n).sx
      expect(round(sx)).toBe(0)
    }
  })

  it('★ and it never marches off across the town: the span is capped', () => {
    for (const n of [2, 3, 5, 8, 12, 40]) {
      const span = screenOf(n - 1, n).sx - screenOf(0, n).sx
      expect(span).toBeLessThanOrEqual(CROWD_SPAN_PX + 1e-9)
    }
    // and the cap is the thing that binds past five, not the pitch
    expect(screenOf(11, 12).sx - screenOf(0, 12).sx).toBeCloseTo(CROWD_SPAN_PX, 6)
  })

  it('screenToWorldOffset inverts the projection exactly', () => {
    for (const [sx, sy] of [
      [14, 4],
      [-31, -7],
      [0, 0],
      [72, -13],
    ] as const) {
      const o = screenToWorldOffset(sx, sy)
      const back = tileToScreen(o.dx, o.dy)
      expect(round(back.sx)).toBe(sx)
      expect(round(back.sy)).toBe(sy)
    }
  })

  it('out-of-range slots are the identity rather than a throw', () => {
    expect(crowdOffset(-1, 4)).toEqual({ dx: 0, dy: 0 })
    expect(crowdOffset(4, 4)).toEqual({ dx: 0, dy: 0 })
  })
})

describe('who takes a slot', () => {
  const bodies = [
    { id: 'yusuf', x: 103, y: 77, settled: true },
    { id: 'amara', x: 103, y: 77, settled: true },
    { id: 'nadia', x: 103, y: 77, settled: true },
    { id: 'salma', x: 103, y: 77, settled: true },
    { id: 'omar', x: 20, y: 9, settled: true },
  ]

  it('★ the four at one door are ranked and the fifth across town is untouched', () => {
    const out = crowdOffsets(bodies)
    expect([...out.keys()].sort()).toEqual(['amara', 'nadia', 'salma', 'yusuf'])
    expect(out.get('omar')).toBeUndefined()
  })

  it('★ slots go by SORTED ID, so two browsers lay the same crowd out', () => {
    const a = crowdOffsets(bodies)
    const b = crowdOffsets([...bodies].reverse())
    for (const id of a.keys()) expect(b.get(id)).toEqual(a.get(id))
    // amara sorts first, so amara takes the left of the rank
    expect(a.get('amara')!.dx).toBeLessThan(a.get('yusuf')!.dx)
  })

  it('★ a WALKER is not ranked, and does not shove the group it passes through', () => {
    const passing = [...bodies.slice(0, 4), { id: 'cass', x: 103, y: 77, settled: false }]
    const out = crowdOffsets(passing)
    expect(out.get('cass')).toBeUndefined()
    // and the four who were standing there are ranked exactly as they were
    const before = crowdOffsets(bodies)
    for (const id of ['amara', 'nadia', 'salma', 'yusuf']) {
      expect(out.get(id)).toEqual(before.get(id))
    }
  })

  it('a body between tiles is grouped by the tile it is nearest', () => {
    const out = crowdOffsets([
      { id: 'a', x: 40.4, y: 40, settled: true },
      { id: 'b', x: 39.6, y: 40, settled: true },
    ])
    expect(out.size).toBe(2)
  })

  it('two bodies on tiles that merely touch are two crowds of one, i.e. none', () => {
    expect(
      crowdOffsets([
        { id: 'a', x: 40, y: 40, settled: true },
        { id: 'b', x: 41, y: 40, settled: true },
      ]).size,
    ).toBe(0)
  })
})

describe('the rank keeps the frame honest', () => {
  it('★ STACKED, the paint order is the NAMES; ranked, it is the ground', () => {
    // Five identical boxes tie in `depthSeed`, so `depthOrder` falls through to the id
    // tie-break; giving each slot its own ground stops the order caring what anybody is called.
    const slotOrder = (ids: string[], rank: boolean): number[] => {
      const boxes = ids.map((id, i) => {
        const o = rank ? crowdOffset(i, ids.length) : { dx: 0, dy: 0 }
        return bodyDepthBox(id, 40 + o.dx, 40 + o.dy)
      })
      const slot = new Map(ids.map((id, i) => [id, i]))
      return depthOrder(boxes).map((id) => slot.get(id)!)
    }
    const names = ['a', 'b', 'c', 'd', 'e']
    const renamed = ['e', 'd', 'c', 'b', 'a']

    expect(slotOrder(names, false)).toEqual([0, 1, 2, 3, 4])
    expect(slotOrder(renamed, false)).toEqual([4, 3, 2, 1, 0]) // the defect, stated

    expect(slotOrder(names, true)).toEqual(slotOrder(renamed, true))
  })

  it('★ and every ranked pair geometry has an opinion about is painted the way it says', () => {
    // `inFrontOf` asks whether a box is past the other's FAR EDGE, so it needs a whole tile of
    // separation: under six bodies every pair returns null and `depthSeed` settles the rank.
    let ruled = 0
    for (const n of [2, 3, 4, 5, 6, 8, 12]) {
      const boxes = Array.from({ length: n }, (_, i) => {
        const o = crowdOffset(i, n)
        return bodyDepthBox(`b${i}`, 40 + o.dx, 40 + o.dy)
      })
      const at = new Map(depthOrder(boxes).map((id, i) => [id, i]))
      for (const a of boxes) {
        for (const b of boxes) {
          if (a === b || geometricEdge(a, b) !== a) continue
          ruled++
          expect(at.get(a.id)!).toBeGreaterThan(at.get(b.id)!)
        }
      }
      // and in EITHER regime the order is a function of the ground alone
      const bySeed = [...boxes].sort((p, q) => depthSeed(p) - depthSeed(q)).map((b) => b.id)
      if (n <= 5) expect(depthOrder(boxes)).toEqual(bySeed)
    }
    expect(ruled).toBeGreaterThan(0) // the larger ranks are not vacuous
  })

  it('the settle glide is the product’s `move`, and inside the band', () => {
    expect(CROWD_SETTLE_MS).toBe(MOTION.move.ms)
    expect(CROWD_SETTLE_MS).toBeGreaterThanOrEqual(MOTION_FLOOR_MS)
    expect(CROWD_SETTLE_MS).toBeLessThanOrEqual(MOTION_CEILING_MS)
  })
})
