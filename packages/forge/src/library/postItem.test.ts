import { describe, it, expect } from 'vitest'
import type { RawImage } from '../post/raw.js'
import { toSpriteCell, candidateRank, countIslands } from './postItem.js'

// A big-pixel figure on magenta, exactly what the generator returns: BLOCK-sized art cells.
function bigPixelArt(
  w: number,
  h: number,
  block: number,
  cells: (x: number, y: number) => [number, number, number] | null,
): RawImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = cells((x / block) | 0, (y / block) | 0)
      const i = (y * w + x) * 4
      const rgb = c ?? [255, 0, 255]
      data[i] = rgb[0]
      data[i + 1] = rgb[1]
      data[i + 2] = rgb[2]
      data[i + 3] = 255
    }
  return { width: w, height: h, data }
}

// 16 art cells across a 256 px canvas: a plus with a lighter cap row, so the cell has
// both figure and background after the trim.
const plus = (cx: number, cy: number, r: number) =>
  bigPixelArt(256, 256, 16, (x, y) => {
    const on =
      (Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= r) ||
      (Math.abs(y - cy) <= 1 && Math.abs(x - cx) <= r)
    return on ? (y === cy - r ? [242, 214, 175] : [176, 124, 78]) : null
  })

describe('toSpriteCell', () => {
  it('lands on a square canvas of exactly the target size', () => {
    for (const px of [16, 24]) {
      const { cell } = toSpriteCell(plus(8, 8, 5), px)
      expect(cell.width, `${px}`).toBe(px)
      expect(cell.height, `${px}`).toBe(px)
    }
  })

  it('keeps the figure — not a scatter of noise', () => {
    const { cell } = toSpriteCell(plus(8, 8, 5), 24)
    let opaque = 0
    for (let i = 3; i < cell.data.length; i += 4) if (cell.data[i] !== 0) opaque++
    expect(opaque).toBeGreaterThan(24 * 24 * 0.2)
    expect(opaque).toBeLessThan(24 * 24)
  })

  it('leaves no magenta behind', () => {
    const { cell } = toSpriteCell(plus(8, 8, 5), 24)
    for (let i = 0; i < cell.data.length; i += 4) {
      if (cell.data[i + 3] === 0) continue
      const r = cell.data[i]!,
        g = cell.data[i + 1]!,
        b = cell.data[i + 2]!
      expect(r > g + 40 && b > g + 25, `magenta at ${i / 4}`).toBe(false)
    }
  })

  // A saw is much wider than it is tall: fitting the long side keeps it inside the canvas.
  it('fits a wide figure by its long side instead of overflowing', () => {
    const wide = bigPixelArt(256, 256, 16, (x, y) =>
      y === 8 && x >= 1 && x <= 14 ? [176, 124, 78] : null,
    )
    const { cell } = toSpriteCell(wide, 16)
    expect(cell.width).toBe(16)
    expect(cell.height).toBe(16)
    let opaque = 0
    for (let i = 3; i < cell.data.length; i += 4) if (cell.data[i] !== 0) opaque++
    expect(opaque).toBeGreaterThan(0)
  })

  // The judge's most common rejection: floating pixels left by a thin arch or a rod.
  it('drops isolated specks left by the lattice resample', () => {
    const withSpeck = bigPixelArt(256, 256, 16, (x, y) => {
      const body = Math.abs(x - 8) <= 3 && Math.abs(y - 9) <= 3
      const speck = x === 13 && y === 2
      return body || speck ? [176, 124, 78] : null
    })
    const { cell } = toSpriteCell(withSpeck, 24)
    // The speck sits in the top-right corner region; the body is centred.
    let cornerOpaque = 0
    for (let y = 0; y < 4; y++)
      for (let x = 20; x < 24; x++) if (cell.data[(y * 24 + x) * 4 + 3] !== 0) cornerOpaque++
    expect(cornerOpaque).toBe(0)
  })

  it('is deterministic', () => {
    const src = plus(8, 8, 5)
    expect([...toSpriteCell(src, 24).cell.data]).toEqual([...toSpriteCell(src, 24).cell.data])
  })

  // A dense two-tone block: the comb has a real lattice to lock onto.
  const dense = bigPixelArt(256, 256, 16, (x, y) =>
    x >= 2 && x <= 12 && y >= 2 && y <= 12
      ? (x + y) % 2
        ? [242, 214, 175]
        : [176, 124, 78]
      : null,
  )

  it('measures the source lattice and scores a candidate by its cell count', () => {
    const { pitch, artCells } = toSpriteCell(dense, 24)
    expect(pitch).toBeGreaterThan(14) // the fixture is painted in 16 px blocks
    expect(pitch).toBeLessThan(18)
    expect(artCells).toBeGreaterThan(9) // 11 blocks across
    expect(artCells).toBeLessThan(13)
  })

  it('ranks a clean single silhouette above a subject with floating debris', () => {
    const clean = toSpriteCell(dense, 24)
    expect(clean.islands).toBe(1)
    const debris = { ...clean, islands: 3 }
    expect(candidateRank(clean)).toBeLessThan(candidateRank(debris))
    // Among equally clean candidates the fuller cell wins.
    expect(candidateRank(clean)).toBeLessThan(
      candidateRank({ ...clean, opaqueFrac: clean.opaqueFrac / 2 }),
    )
    expect(countIslands({ width: 2, height: 1, data: new Uint8ClampedArray(8) })).toBe(0)
  })
})
