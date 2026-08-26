import { describe, expect, it } from 'vitest'
import { packCharacterAtlas } from './atlasV4.js'
import { CELL_NAMES_V4 } from './mirror.js'
import type { RawImage } from './post/raw.js'

// distinct sizes per pose so rect math is actually exercised
const SIZES: Record<string, { w: number; h: number }> = {
  idle: { w: 6, h: 12 },
  'contact-a': { w: 8, h: 11 },
  'passing-a': { w: 7, h: 11 },
  'contact-b': { w: 8, h: 11 },
  'passing-b': { w: 7, h: 11 },
  sleep: { w: 14, h: 7 },
}

function solidCell(w: number, h: number, mark: number): RawImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([mark, 0, 0, 255], i * 4)
  return { width: w, height: h, data }
}

function makeCells(): Map<string, RawImage> {
  const cells = new Map<string, RawImage>()
  CELL_NAMES_V4.forEach((name, i) => {
    const pose = name.slice(0, name.lastIndexOf('-'))
    const s = SIZES[pose]!
    cells.set(name, solidCell(s.w, s.h, i + 1))
  })
  return cells
}

describe('packCharacterAtlas', () => {
  it('packs all 24 cells with correct rects and feet anchors', () => {
    const cells = makeCells()
    const { image, manifest } = packCharacterAtlas(cells, 12)
    expect(manifest.version).toBe('v4-hires-atlas')
    expect(manifest.figureH).toBe(12)
    expect(Object.keys(manifest.cells)).toHaveLength(24)
    // row width = sum of the 6 pose widths; height = 4 rows of the max pose height
    expect(image.width).toBe(6 + 8 + 7 + 8 + 7 + 14)
    expect(image.height).toBe(4 * 12)
    for (const name of CELL_NAMES_V4) {
      const c = manifest.cells[name]!
      const src = cells.get(name)!
      expect({ w: c.w, h: c.h }).toEqual({ w: src.width, h: src.height })
      // every pixel of the placed rect carries the cell's marker byte
      const mark = src.data[0]!
      const corner = (c.y * image.width + c.x) * 4
      const last = ((c.y + c.h - 1) * image.width + c.x + c.w - 1) * 4
      expect(image.data[corner]).toBe(mark)
      expect(image.data[last]).toBe(mark)
      // feet anchor = bottom-center of the (fully opaque) cell
      expect(c.feetY).toBe(src.height - 1)
      expect(c.feetX).toBe(Math.round((src.width - 1) / 2))
    }
  })

  it('rejects a missing cell', () => {
    const cells = makeCells()
    cells.delete('sleep-nw')
    expect(() => packCharacterAtlas(cells, 12)).toThrow(/missing cells sleep-nw/)
  })
})
