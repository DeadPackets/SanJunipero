import { describe, it, expect } from 'vitest'
import type { RawImage } from './post/raw.js'
import { FACINGS, POSES, assembleGrid, sliceGrid, mirrorX, cellDistance, duplicateReport, downscaleMajority, STRAIGHT_DUPE, MIRROR_DUPE } from './sheet.js'

type Px = [number, number, number, number]
function img(w: number, h: number, px: (x: number, y: number) => Px): RawImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4)
  return { width: w, height: h, data }
}
const solid = (w: number, h: number, p: Px) => img(w, h, () => p)
const RED: Px = [255, 0, 0, 255], BLUE: Px = [0, 0, 255, 255], CLEAR: Px = [0, 0, 0, 0]

describe('sheet constants', () => {
  it('exports facing/pose orders and thresholds', () => {
    expect(FACINGS).toEqual(['sw', 'se', 'ne', 'nw'])
    expect(POSES).toEqual(['idle', 'walk-a', 'walk-b'])
    expect(STRAIGHT_DUPE).toBe(0.10)
    expect(MIRROR_DUPE).toBe(0.06)
  })
})

describe('assembleGrid / sliceGrid', () => {
  it('round-trips a 2x2 grid of distinct 2x2 cells', () => {
    const cells = [
      [solid(2, 2, RED), solid(2, 2, BLUE)],
      [solid(2, 2, [0, 255, 0, 255]), solid(2, 2, [1, 2, 3, 255])],
    ]
    const sheet = assembleGrid(cells, 2, 2)
    expect(sheet.width).toBe(4); expect(sheet.height).toBe(4)
    const back = sliceGrid(sheet, 2, 2)
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++)
      expect(back[r]![c]!.data).toEqual(cells[r]![c]!.data)
  })
  it('blits row-major: top-left pixel of sheet comes from cells[0][0]', () => {
    const sheet = assembleGrid([[solid(1, 1, RED), solid(1, 1, BLUE)]], 1, 1)
    expect([...sheet.data.slice(0, 4)]).toEqual(RED)
    expect([...sheet.data.slice(4, 8)]).toEqual(BLUE)
  })
  it('throws on a size-mismatched cell', () => {
    expect(() => assembleGrid([[solid(2, 2, RED), solid(1, 2, BLUE)]], 2, 2)).toThrow()
  })
  it('sliceGrid throws when dimensions do not divide evenly', () => {
    expect(() => sliceGrid(solid(3, 2, RED), 2, 1)).toThrow()
  })
})

describe('mirrorX', () => {
  it('flips horizontally and is an involution', () => {
    const src = img(2, 1, x => (x === 0 ? RED : BLUE))
    const flipped = mirrorX(src)
    expect([...flipped.data.slice(0, 4)]).toEqual(BLUE)
    expect([...flipped.data.slice(4, 8)]).toEqual(RED)
    expect(mirrorX(flipped).data).toEqual(src.data)
  })
})

describe('cellDistance', () => {
  it('is 0 for identical images', () => {
    expect(cellDistance(solid(2, 2, RED), solid(2, 2, RED))).toBe(0)
  })
  it('is 1 for fully-opaque vs fully-transparent', () => {
    expect(cellDistance(solid(2, 2, RED), solid(2, 2, CLEAR))).toBe(1)
  })
  it('is symmetric', () => {
    const a = img(2, 2, x => (x === 0 ? RED : CLEAR))
    const b = solid(2, 2, BLUE)
    expect(cellDistance(a, b)).toBeCloseTo(cellDistance(b, a), 12)
  })
  it('ignores pixels transparent in both images', () => {
    const a = img(2, 1, x => (x === 0 ? RED : CLEAR))
    const b = img(2, 1, x => (x === 0 ? RED : CLEAR))
    expect(cellDistance(a, b)).toBe(0)
  })
})

describe('downscaleMajority', () => {
  it('dominant color wins over speckle noise', () => {
    // 4x4 -> 1x1: 13 red, 3 blue speckles -> red
    const speckles = new Set([1, 6, 11])
    const src = img(4, 4, (x, y) => (speckles.has(y * 4 + x) ? BLUE : RED))
    expect([...downscaleMajority(src, 1, 1).data]).toEqual(RED)
  })
  it('outputs transparent iff more than half the block is transparent', () => {
    // 9 of 16 transparent -> transparent
    const mostlyClear = img(4, 4, (x, y) => (y * 4 + x < 9 ? CLEAR : RED))
    expect(downscaleMajority(mostlyClear, 1, 1).data[3]).toBe(0)
    // exactly 8 of 16 transparent -> opaque, majority color
    const halfClear = img(4, 4, (x, y) => (y * 4 + x < 8 ? CLEAR : RED))
    expect([...downscaleMajority(halfClear, 1, 1).data]).toEqual(RED)
  })
  it('breaks frequency ties by first-seen scan order', () => {
    const src = img(2, 2, (x, y) => (y === 0 ? BLUE : RED)) // 2 blue then 2 red
    expect([...downscaleMajority(src, 1, 1).data]).toEqual(BLUE)
  })
  it('preserves quadrant colors on a clean 2x downscale', () => {
    const src = img(4, 4, (x, y) => (x < 2 ? (y < 2 ? RED : BLUE) : (y < 2 ? [0, 255, 0, 255] as Px : CLEAR)))
    const out = downscaleMajority(src, 2, 2)
    expect([...out.data.slice(0, 4)]).toEqual(RED)
    expect([...out.data.slice(4, 8)]).toEqual([0, 255, 0, 255])
    expect([...out.data.slice(8, 12)]).toEqual(BLUE)
    expect(out.data[15]).toBe(0)
  })
})

describe('duplicateReport', () => {
  const half = (left: Px, right: Px) => img(4, 4, x => (x < 2 ? left : right))
  it('flags an exact mirror pair as a mirrored dupe and leaves distinct cells alone', () => {
    const a = half(RED, CLEAR)
    const findings = duplicateReport(
      [{ label: 'a', img: a }, { label: 'b', img: mirrorX(a) }, { label: 'c', img: solid(4, 4, BLUE) }],
      STRAIGHT_DUPE, MIRROR_DUPE)
    expect(findings).toEqual([{ a: 'a', b: 'b', distance: 0, mirrored: true }])
  })
  it('flags an exact straight duplicate', () => {
    const a = half(RED, BLUE)
    const findings = duplicateReport([{ label: 'x', img: a }, { label: 'y', img: a }], STRAIGHT_DUPE, MIRROR_DUPE)
    expect(findings).toEqual([{ a: 'x', b: 'y', distance: 0, mirrored: false }])
  })
})
