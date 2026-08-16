import { describe, expect, it } from 'vitest'
import type { RawImage } from './post/raw.js'
import { paletteRgb } from './palette.js'
import { opaqueBbox } from './sheet.js'
import { STRIP_POSES_V4, deriveSheet, CELL_NAMES_V4, type AuthoredSet } from './mirror.js'
import {
  HIRES_MARGIN, trimToFigure, normalizeFigureHeight, cellAnchor, buildManifestV4,
  processHiResCell,
} from './hires.js'

// Solid-color rectangle figure at (x0,y0)-(x1,y1) on a transparent w×h canvas.
function rect(w: number, h: number, x0: number, y0: number, x1: number, y1: number,
  rgb: [number, number, number] = [147, 181, 115]): RawImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * w + x) * 4
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255
  }
  return { width: w, height: h, data }
}

describe('trimToFigure', () => {
  it('crops to the opaque bbox plus a uniform transparent margin', () => {
    const img = rect(100, 80, 20, 10, 59, 69) // figure 40×60
    const t = trimToFigure(img)
    expect(t.width).toBe(40 + HIRES_MARGIN * 2)
    expect(t.height).toBe(60 + HIRES_MARGIN * 2)
    const b = opaqueBbox(t)!
    expect(b).toEqual({
      x0: HIRES_MARGIN, x1: HIRES_MARGIN + 39,
      y0: HIRES_MARGIN, y1: HIRES_MARGIN + 59,
    })
  })
})

describe('normalizeFigureHeight', () => {
  it('scales the opaque figure height to the target within 1px, preserving aspect', () => {
    const img = trimToFigure(rect(100, 100, 10, 10, 49, 89)) // figure 40×80
    const n = normalizeFigureHeight(img, 60)
    const b = opaqueBbox(n)!
    const bh = b.y1 - b.y0 + 1, bw = b.x1 - b.x0 + 1
    expect(Math.abs(bh - 60)).toBeLessThanOrEqual(1)
    // original aspect 40/80 = 0.5
    expect(Math.abs(bw / bh - 0.5)).toBeLessThan(0.05)
  })

  it('is a no-op when already at target height', () => {
    const img = trimToFigure(rect(50, 50, 5, 5, 24, 44)) // figure height 40
    expect(normalizeFigureHeight(img, 40)).toBe(img)
  })
})

describe('cellAnchor', () => {
  it('reports feet as the bottom-center of the opaque bbox', () => {
    const img = rect(64, 64, 10, 8, 39, 55)
    expect(cellAnchor(img)).toEqual({ w: 64, h: 64, feetX: Math.round((10 + 39) / 2), feetY: 55 })
  })
})

describe('processHiResCell', () => {
  it('outputs only palette colors and keeps native (non-lattice) resolution', () => {
    const img = rect(200, 300, 20, 20, 179, 279, [150, 180, 110]) // off-palette green
    const cell = processHiResCell(img)
    expect(cell.height).toBe(260 + HIRES_MARGIN * 2) // no coarsening
    const palette = new Set(paletteRgb().map(p => (p[0] << 16) | (p[1] << 8) | p[2]))
    for (let i = 0; i < cell.data.length; i += 4) {
      if (cell.data[i + 3] === 0) continue
      expect(palette.has((cell.data[i]! << 16) | (cell.data[i + 1]! << 8) | cell.data[i + 2]!)).toBe(true)
    }
  })

  it('height-normalizes when a target is given', () => {
    const img = rect(200, 300, 20, 20, 179, 279)
    const cell = processHiResCell(img, 130)
    const b = opaqueBbox(cell)!
    expect(Math.abs(b.y1 - b.y0 + 1 - 130)).toBeLessThanOrEqual(1)
  })

  it('drops background speckle islands so they cannot inflate the bbox', () => {
    const img = rect(200, 300, 60, 60, 139, 239) // figure 80×180 = 14400 px
    img.data[(10 * 200 + 10) * 4 + 3] = 255      // 1px speckle far outside the figure
    img.data[(290 * 200 + 190) * 4 + 3] = 255
    const cell = processHiResCell(img)
    expect(cell.width).toBe(80 + HIRES_MARGIN * 2)
    expect(cell.height).toBe(180 + HIRES_MARGIN * 2)
  })
})

describe('buildManifestV4', () => {
  function authored(): AuthoredSet {
    const strip = () => Object.fromEntries(
      STRIP_POSES_V4.map((p, i) => [p, rect(30 + i, 50, 2, 2, 20 + i, 45)]),
    ) as Record<(typeof STRIP_POSES_V4)[number], RawImage>
    return { strips: { se: strip(), ne: strip() }, sleep: rect(60, 30, 4, 4, 55, 25) }
  }

  it('covers the full 24-cell contract with sane anchors', () => {
    const cells = deriveSheet(authored())
    const m = buildManifestV4(cells, 44)
    expect(m.version).toBe('v4-hires')
    expect(m.figureH).toBe(44)
    expect(Object.keys(m.cells).sort()).toEqual([...CELL_NAMES_V4].sort())
    for (const [name, a] of Object.entries(m.cells)) {
      const img = cells.get(name)!
      expect(a.w).toBe(img.width)
      expect(a.h).toBe(img.height)
      expect(a.feetX).toBeGreaterThanOrEqual(0)
      expect(a.feetX).toBeLessThan(a.w)
      expect(a.feetY).toBeGreaterThanOrEqual(0)
      expect(a.feetY).toBeLessThan(a.h)
      expect(cellAnchor(img)).toEqual(a)
    }
  })

  it('anchors flip with the cell: derived SW feetX mirrors SE feetX', () => {
    const cells = deriveSheet(authored())
    const m = buildManifestV4(cells, 44)
    const se = m.cells['idle-se']!, sw = m.cells['idle-sw']!
    expect(sw.w).toBe(se.w)
    expect(sw.feetY).toBe(se.feetY)
    expect(sw.feetX).toBe(se.w - 1 - se.feetX)
  })

  it('throws when a contract cell is missing', () => {
    const cells = deriveSheet(authored())
    cells.delete('sleep-nw')
    expect(() => buildManifestV4(cells, 44)).toThrow(/missing cells sleep-nw/)
  })

  it('throws on cells outside the contract', () => {
    const cells = deriveSheet(authored())
    cells.set('bogus-cell', rect(8, 8, 1, 1, 6, 6))
    expect(() => buildManifestV4(cells, 44)).toThrow(/unexpected cells bogus-cell/)
  })
})
