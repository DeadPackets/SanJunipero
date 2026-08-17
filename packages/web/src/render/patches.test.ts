import { describe, expect, it } from 'vitest'
import { TILE_H, TILE_W, tileToScreen } from './iso.js'
import {
  FURROW_SPACING_TILES, HEADLAND_COLOR, KERB_COLOR, furrowLines, patchOutline,
} from './patches.js'

// The forge's 40-colour master palette (packages/forge/src/palette.ts). @sj/web cannot import
// it — forge pulls sharp and better-sqlite3 — so it is restated here, the same way
// importantFeed.ts restates its own subset, and every colour below must be a member.
const MASTER_PALETTE = [
  0xfff6e9, 0xf6e8d5, 0xe8d5bc, 0xd4bc9e, 0xb89d7e,
  0xf2c879, 0xe0a95e, 0xc68a48, 0xa66e38, 0x7e512b,
  0xdce8c8, 0xb9d19a, 0x93b573, 0x6f9455, 0x4f7040,
  0xf2c6c2, 0xe09e9b, 0xc47876, 0x9e5a5c,
  0xd6eaf2, 0xa8cfe0, 0x7fb0c9, 0x5a8cab, 0x3e6786,
  0xe9e2da, 0xcfc6bc, 0xaba198, 0x857d75, 0x5d5751,
  0x43394a, 0x322b38, 0x241f2b, 0x171420,
  0xf7a66b, 0xe8785a, 0x8a6fa8, 0xf4e289,
  0xf5d3b3, 0xd9a876, 0x9c6b47,
]

const rect = (w: number, h: number, ox = 0, oy = 0): Array<{ x: number; y: number }> => {
  const out: Array<{ x: number; y: number }> = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push({ x: ox + x, y: oy + y })
  return out
}

// A deterministic shuffle, so "order-independent" is tested rather than asserted.
const shuffled = <T,>(list: T[]): T[] => {
  const a = [...list]
  let s = 7
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    const j = (s >>> 16) % (i + 1)
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

const pointsIn = (poly: number[]): number => poly.length / 2

describe('patchOutline', () => {
  it('traces a single tile as one 4-point diamond', () => {
    const out = patchOutline([{ x: 3, y: 5 }])
    expect(out).toHaveLength(1)
    expect(pointsIn(out[0]!)).toBe(4)
    const { sx, sy } = tileToScreen(3, 5)
    const xs = out[0]!.filter((_, i) => i % 2 === 0)
    const ys = out[0]!.filter((_, i) => i % 2 === 1)
    expect(Math.min(...xs)).toBe(sx - TILE_W / 2)
    expect(Math.max(...xs)).toBe(sx + TILE_W / 2)
    expect(Math.min(...ys)).toBe(sy)
    expect(Math.max(...ys)).toBe(sy + TILE_H)
  })

  it('traces a 2x2 block as ONE 8-point outline with no interior segment', () => {
    const out = patchOutline(rect(2, 2))
    expect(out).toHaveLength(1)
    expect(pointsIn(out[0]!)).toBe(8)
  })

  it('keeps two diagonally touching tiles as TWO outlines, not a figure of eight', () => {
    const out = patchOutline([{ x: 0, y: 0 }, { x: 1, y: 1 }])
    expect(out).toHaveLength(2)
    for (const o of out) expect(pointsIn(o)).toBe(4)
  })

  it('traces the concave corner of an L', () => {
    // three tiles: (0,0) (1,0) (0,1) — one reflex corner
    const out = patchOutline([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }])
    expect(out).toHaveLength(1)
    // 3 tiles x 4 edges = 12, less 2 shared edges counted twice = 8 boundary edges
    expect(pointsIn(out[0]!)).toBe(8)
  })

  it('says nothing about an empty patch', () => {
    expect(patchOutline([])).toEqual([])
  })

  it('is order-independent', () => {
    const tiles = rect(3, 2, 4, 7)
    expect(patchOutline(shuffled(tiles))).toEqual(patchOutline(tiles))
  })

  it('separates two patches that never touch', () => {
    expect(patchOutline([...rect(2, 2), ...rect(2, 2, 9, 9)])).toHaveLength(2)
  })
})

describe('furrowLines', () => {
  it('ploughs a wide field along its long axis, one furrow per row', () => {
    const lines = furrowLines(rect(4, 2))
    expect(lines).toHaveLength(2)
    for (const l of lines) {
      expect(pointsIn(l)).toBe(2)
      // a furrow along x runs down-right on screen: both coords grow
      expect(l[2]!).toBeGreaterThan(l[0]!)
      expect(l[3]!).toBeGreaterThan(l[1]!)
    }
  })

  it('turns the furrows when the field is tall instead of wide', () => {
    const lines = furrowLines(rect(2, 4))
    expect(lines).toHaveLength(2)
    for (const l of lines) {
      // a furrow along y runs down-LEFT on screen
      expect(l[2]!).toBeLessThan(l[0]!)
      expect(l[3]!).toBeGreaterThan(l[1]!)
    }
  })

  it('spaces furrows in whole tiles, so they read as ploughing', () => {
    expect(FURROW_SPACING_TILES).toBe(1)
    expect(furrowLines(rect(6, 3))).toHaveLength(3)
  })

  it('says nothing about an empty field', () => {
    expect(furrowLines([])).toEqual([])
  })

  it('is order-independent', () => {
    const tiles = rect(5, 3, 2, 2)
    expect(furrowLines(shuffled(tiles))).toEqual(furrowLines(tiles))
  })
})

describe('the edge colours', () => {
  it('are both master palette members', () => {
    expect(MASTER_PALETTE).toContain(KERB_COLOR)
    expect(MASTER_PALETTE).toContain(HEADLAND_COLOR)
  })

  it('speak the same language as a road edge — a field rim IS a road shoulder', async () => {
    const { ROAD_SHOULDER_DARK } = await import('./groundField.js')
    expect(HEADLAND_COLOR).toBe(ROAD_SHOULDER_DARK)
  })
})
