import { beforeEach, describe, expect, it } from 'vitest'
import { depthKey } from './iso.js'
import { structureZIndex } from './entities.js'
import {
  DEPTH_BUDGET, bodyDepthBox, depthFallbacks, depthOrder, depthSeed, geometricEdge, inFrontOf,
  resetDepthFallbacks, screenOverlap, structureDepthBox, tileDepthBox, type DepthBox,
  type EdgeRule,
} from './depth.js'

const HOUSE = { x: 20, y: 20, w: 2, h: 2 }
const house = structureDepthBox('house', HOUSE)
const before = (order: string[], a: string, b: string): boolean => order.indexOf(a) < order.indexOf(b)

beforeEach(() => resetDepthFallbacks())

describe('F-3(b) — the exact tie the old scalar produced', () => {
  it('LANDED BUG: a body at tile (20,22) and a 2×2 house at (20,20) both computed 42021', () => {
    expect(structureZIndex(HOUSE)).toBe(42021)
    expect(depthKey(20, 22) + 1).toBe(42021)   // characters.ts wrote depthKey(...) + 1
  })

  it('puts the body in front of the house it is standing south of', () => {
    const body = bodyDepthBox('body', 20, 22)
    expect(before(depthOrder([house, body]), 'house', 'body')).toBe(true)
    expect(before(depthOrder([body, house]), 'house', 'body')).toBe(true)  // input order is irrelevant
  })
})

describe('F-3(c) — a rounded depth against an unrounded position', () => {
  // One body walks past another standing at (20,22). Two bodies share a rank, so this is the
  // pure geometric case with nothing else deciding it.
  const still = bodyDepthBox('still', 20, 22)
  const walk = (steps: number, from = 20.5, to = 23.5): number[] => {
    const flips: number[] = []
    let prev: boolean | null = null
    for (let i = 0; i <= steps; i++) {
      const py = from + ((to - from) * i) / steps
      const inFront = before(depthOrder([still, bodyDepthBox('walker', 20, py)]), 'still', 'walker')
      if (prev !== null && inFront !== prev) flips.push(Number(py.toFixed(6)))
      prev = inFront
    }
    return flips
  }

  it('flips exactly once, where the walker reaches the tile the other is standing on', () => {
    expect(walk(30)).toEqual([22])
  })

  it('crosses in the same PLACE however finely the walk is sampled — no pop', () => {
    expect(walk(300)).toEqual([22])
    expect(walk(60)).toEqual([22])
  })

  it('is monotonic walking up to a building too — one transition, never a flicker', () => {
    const flips: Array<{ py: number; front: boolean }> = []
    let prev: boolean | null = null
    for (let i = 0; i <= 400; i++) {
      const py = 16 + i / 100
      const front = before(depthOrder([house, bodyDepthBox('body', 20, py)]), 'house', 'body')
      if (prev !== null && front !== prev) flips.push({ py, front })
      prev = front
    }
    expect(flips).toHaveLength(1)
    expect(flips[0]!.front).toBe(true)   // it comes OUT from behind and stays out
  })

  it('the landed rule popped instead: the rounded key jumps a whole row at py = 21.5', () => {
    expect(depthKey(Math.round(20), Math.round(21.49)) + 1).toBe(depthKey(20, 21) + 1)
    expect(depthKey(Math.round(20), Math.round(21.5)) + 1).toBe(depthKey(20, 22) + 1)
  })
})

describe('F-3(a) — a footprint is a range, not a corner', () => {
  const RING: Array<[string, number, number]> = [
    ['e', 23.5, 20.5], ['se', 22.5, 22.5], ['s', 20.5, 23.5], ['sw', 18.5, 22.5],
    ['w', 17.5, 20.5], ['nw', 18.5, 18.5], ['n', 20.5, 17.5], ['ne', 22.5, 18.5],
  ]

  it('answers every decisive tile on a ring around the house from the geometry', () => {
    const decisive: Record<string, boolean> = {}
    for (const [name, x, y] of RING) {
      const b = bodyDepthBox(name, x, y)
      const bodyFront = inFrontOf(b, house), houseFront = inFrontOf(house, b)
      if (bodyFront === houseFront) continue          // mutually diagonal — the seed decides
      decisive[name] = bodyFront
      expect(before(depthOrder([house, b]), 'house', name), name).toBe(bodyFront)
    }
    expect(decisive).toEqual({ e: true, se: true, s: true, w: false, nw: false, n: false })
  })

  it('names the two genuinely ambiguous diagonals and resolves them the same way twice', () => {
    const ambiguous = RING.filter(([name, x, y]) => {
      const b = bodyDepthBox(name, x, y)
      return inFrontOf(b, house) === inFrontOf(house, b)
    }).map(([name]) => name)
    expect(ambiguous).toEqual(['sw', 'ne'])
    for (const [name, x, y] of RING) {
      const b = bodyDepthBox(name, x, y)
      expect(depthOrder([house, b])).toEqual(depthOrder([b, house]))
    }
  })

  it('a 2×2 house occupies four tiles of ground, not one corner', () => {
    expect([house.x0, house.y0, house.x1, house.y1]).toEqual([19.5, 19.5, 21.5, 21.5])
  })
})

describe('inFrontOf', () => {
  const boxes = [
    bodyDepthBox('a', 3, 3), bodyDepthBox('b', 5, 3), bodyDepthBox('c', 3, 7),
    structureDepthBox('d', { x: 8, y: 8, w: 2, h: 3 }), tileDepthBox('e', 12, 4),
  ]

  it('is irreflexive', () => {
    for (const b of boxes) expect(inFrontOf(b, b), b.id).toBe(false)
  })

  it('is antisymmetric except for a pair that is past the other on OPPOSITE axes', () => {
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b) continue
        if (!(inFrontOf(a, b) && inFrontOf(b, a))) continue
        // the only way both can hold: one is entirely east, the other entirely south
        const eastWhileSouth = (a.x0 >= b.x1 && b.y0 >= a.y1) || (b.x0 >= a.x1 && a.y0 >= b.y1)
        expect(eastWhileSouth, `${a.id}/${b.id}`).toBe(true)
      }
    }
  })

  it('lets an anti-diagonal pair fall through to the seed rather than inventing an answer', () => {
    const a = tileDepthBox('a', 5, 4), b = tileDepthBox('b', 4, 5)
    expect(inFrontOf(a, b)).toBe(true)
    expect(inFrontOf(b, a)).toBe(true)
    expect(depthOrder([a, b])).toEqual(depthOrder([b, a]))
    expect(depthOrder([b, a])[0]).toBe(depthSeed(a) < depthSeed(b) ? 'a' : 'b')
  })

  it('makes no constraint at all between two things that cannot overlap on screen', () => {
    const a = tileDepthBox('a', 4, 4), b = tileDepthBox('b', 40, 40)
    expect(screenOverlap(a, b)).toBe(false)
    expect(depthOrder([b, a])).toEqual(['a', 'b'])   // seed order, unconstrained
  })
})

describe('the counted deterministic fallback', () => {
  const three: DepthBox[] = [bodyDepthBox('p', 4, 4), bodyDepthBox('q', 5, 4), bodyDepthBox('r', 4, 5)]
  // A forced pinwheel: p → q → r → p. The geometric rule cannot produce this (below), so the
  // branch is exercised through the edge seam rather than left untested.
  const cyclic: EdgeRule = (a, b) => {
    const ring = ['p', 'q', 'r']
    const ia = ring.indexOf(a.id), ib = ring.indexOf(b.id)
    if (ia < 0 || ib < 0) return null
    return (ia + 1) % 3 === ib ? b : a
  }

  it('returns every id exactly once, with no throw', () => {
    const order = depthOrder(three, cyclic)
    expect([...order].sort()).toEqual(['p', 'q', 'r'])
    expect(new Set(order).size).toBe(3)
  })

  it('resolves a cycle the same way twice — deterministic, not arbitrary', () => {
    expect(depthOrder(three, cyclic)).toEqual(depthOrder([...three].reverse(), cyclic))
  })

  it('COUNTS the fallback — the number the gate cites', () => {
    expect(depthFallbacks()).toEqual({ frames: 0, nodes: 0 })
    depthOrder(three, cyclic)
    expect(depthFallbacks().frames).toBe(1)
    expect(depthFallbacks().nodes).toBe(3)
  })

  it('MEASURED: how often 20 000 dense random scenes actually reach the fallback', () => {
    // Separation alone cannot produce a cycle — a mutually-in-front pair drops its edge. The
    // OVERLAP RANK can: a body standing on a building jumps in front of it regardless.
    let seed = 20260817
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return (seed / 2147483648) * n
    }
    for (let scene = 0; scene < 20000; scene++) {
      const boxes: DepthBox[] = []
      for (let i = 0; i < 5; i++) {
        boxes.push(rnd(1) < 0.5
          ? bodyDepthBox(`b${i}`, 20 + rnd(6), 20 + rnd(6))
          : structureDepthBox(`s${i}`, {
            x: 20 + Math.floor(rnd(6)), y: 20 + Math.floor(rnd(6)),
            w: 1 + Math.floor(rnd(3)), h: 1 + Math.floor(rnd(3)),
          }))
      }
      depthOrder(boxes)
    }
    const { frames, nodes } = depthFallbacks()
    expect(frames).toBe(304)          // 1.52 % of 20 000 — pinned so a rule change is visible
    expect(nodes).toBe(1203)
    expect(frames / 20000).toBeLessThan(0.02)
  })

  it('puts a body standing IN a doorway in front of the building, never inside it', () => {
    const inDoorway = bodyDepthBox('body', 20, 21)   // the south-centre tile of the 2×2 house
    expect(before(depthOrder([house, inDoorway]), 'house', 'body')).toBe(true)
    expect(before(depthOrder([inDoorway, house]), 'house', 'body')).toBe(true)
  })

  it('counts a frame that blows the budget and still returns everything', () => {
    const many = Array.from({ length: DEPTH_BUDGET + 44 }, (_, i) => bodyDepthBox(`b${i}`, i % 20, Math.floor(i / 20)))
    const order = depthOrder(many)
    expect(order).toHaveLength(DEPTH_BUDGET + 44)
    expect(new Set(order).size).toBe(DEPTH_BUDGET + 44)
    expect(depthFallbacks().frames).toBe(1)
    expect(depthFallbacks().nodes).toBe(DEPTH_BUDGET + 44)
  })

  it('resets, so a gate can measure one run rather than one process', () => {
    depthOrder(Array.from({ length: DEPTH_BUDGET + 1 }, (_, i) => bodyDepthBox(`b${i}`, i, 0)))
    expect(depthFallbacks().frames).toBe(1)
    resetDepthFallbacks()
    expect(depthFallbacks()).toEqual({ frames: 0, nodes: 0 })
  })
})

describe('determinism', () => {
  const world: DepthBox[] = [
    structureDepthBox('s1', { x: 10, y: 10, w: 2, h: 2 }),
    structureDepthBox('s2', { x: 13, y: 10, w: 1, h: 1 }),
    structureDepthBox('s3', { x: 10, y: 14, w: 2, h: 3 }),
    bodyDepthBox('a1', 11.4, 12.2), bodyDepthBox('a2', 12, 13), bodyDepthBox('a3', 9.5, 11),
    tileDepthBox('i1', 12, 11), tileDepthBox('c1', 11, 15),
  ]

  it('gives the same answer for 20 shuffles of the same input', () => {
    const expected = depthOrder(world)
    let seed = 7
    for (let n = 0; n < 20; n++) {
      const shuffled = [...world]
      for (let i = shuffled.length - 1; i > 0; i--) {
        seed = (seed * 1103515245 + 12345) % 2147483648
        const j = seed % (i + 1)
        ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
      }
      expect(depthOrder(shuffled)).toEqual(expected)
    }
    expect(depthFallbacks().frames).toBe(0)
  })

  it('two bodies on the same tile order by id and never swap', () => {
    const a = bodyDepthBox('aaa', 5, 5), b = bodyDepthBox('bbb', 5, 5)
    expect(depthOrder([a, b])).toEqual(['aaa', 'bbb'])
    expect(depthOrder([b, a])).toEqual(['aaa', 'bbb'])
  })
})

describe('the drain produces the order the sort-and-shift queue produced', () => {
  /** `depthOrder` exactly as it stood before the ready queue lost its `sort` and `shift`, kept
   *  as the pin: the painter's order two browsers agree on may not move. */
  const legacyDepthOrder = (boxes: readonly DepthBox[], edge: EdgeRule = geometricEdge): string[] => {
    const seeded = [...boxes].sort((a, b) => depthSeed(a) - depthSeed(b) || (a.id < b.id ? -1 : 1))
    const n = seeded.length
    if (n > DEPTH_BUDGET) return seeded.map((b) => b.id)
    const after: number[][] = seeded.map(() => [])
    const indeg = new Array<number>(n).fill(0)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const front = edge(seeded[i]!, seeded[j]!)
        if (front === null) continue
        if (front === seeded[j]!) { after[i]!.push(j); indeg[j]!++ } else { after[j]!.push(i); indeg[i]!++ }
      }
    }
    const out: string[] = []
    const ready: number[] = []
    for (let i = 0; i < n; i++) if (indeg[i] === 0) ready.push(i)
    while (ready.length > 0) {
      ready.sort((p, q) => p - q)
      const i = ready.shift()!
      out.push(seeded[i]!.id)
      for (const j of after[i]!) if (--indeg[j]! === 0) ready.push(j)
    }
    if (out.length < n) for (let i = 0; i < n; i++) if (indeg[i]! > 0) out.push(seeded[i]!.id)
    return out
  }

  /** A town, not a pair: three rings of houses with bodies, items and crops between them. */
  const fixtureTown = (): DepthBox[] => {
    const boxes: DepthBox[] = []
    for (let ring = 1; ring <= 3; ring++) {
      for (let k = 0; k < ring * 6; k++) {
        const a = (k / (ring * 6)) * Math.PI * 2
        const x = 40 + Math.round(Math.cos(a) * ring * 5), y = 40 + Math.round(Math.sin(a) * ring * 5)
        boxes.push(structureDepthBox(`s${ring}_${k}`, { x, y, w: 1 + (k % 3), h: 1 + ((k + 1) % 3) }))
        boxes.push(bodyDepthBox(`b${ring}_${k}`, x + 0.25 * (k % 5), y + 0.2 * (k % 7)))
        boxes.push(tileDepthBox(`i${ring}_${k}`, x + 1, y + 1))
        boxes.push(tileDepthBox(`c${ring}_${k}`, x - 1, y + 2))
      }
    }
    return boxes
  }

  it('agrees on a three-ring town, and on every rotation of its input order', () => {
    const town = fixtureTown()
    expect(town.length).toBeGreaterThan(100)
    expect(depthOrder(town)).toEqual(legacyDepthOrder(town))
    for (const cut of [1, 37, 100]) {
      const rotated = [...town.slice(cut), ...town.slice(0, cut)]
      expect(depthOrder(rotated)).toEqual(legacyDepthOrder(rotated))
    }
  })

  it('agrees on 400 dense random scenes — the constrained cases, not the sparse ones', () => {
    let seed = 20260826
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return (seed / 2147483648) * n
    }
    for (let scene = 0; scene < 400; scene++) {
      const boxes: DepthBox[] = []
      for (let i = 0; i < 12; i++) {
        boxes.push(rnd(1) < 0.5
          ? bodyDepthBox(`b${i}`, 20 + rnd(8), 20 + rnd(8))
          : structureDepthBox(`s${i}`, {
            x: 20 + Math.floor(rnd(8)), y: 20 + Math.floor(rnd(8)),
            w: 1 + Math.floor(rnd(3)), h: 1 + Math.floor(rnd(3)),
          }))
      }
      expect(depthOrder(boxes), `scene ${scene}`).toEqual(legacyDepthOrder(boxes))
    }
  })

  it('agrees where a cycle forces the fallback, and above the budget', () => {
    const ring = ['p', 'q', 'r']
    const cyclic: EdgeRule = (a, b) => {
      const ia = ring.indexOf(a.id), ib = ring.indexOf(b.id)
      if (ia < 0 || ib < 0) return null
      return (ia + 1) % 3 === ib ? b : a
    }
    const three = [bodyDepthBox('p', 4, 4), bodyDepthBox('q', 5, 4), bodyDepthBox('r', 4, 5)]
    expect(depthOrder(three, cyclic)).toEqual(legacyDepthOrder(three, cyclic))
    const many = Array.from({ length: DEPTH_BUDGET + 44 }, (_, i) => bodyDepthBox(`b${i}`, i % 20, Math.floor(i / 20)))
    expect(depthOrder(many)).toEqual(legacyDepthOrder(many))
  })
})
