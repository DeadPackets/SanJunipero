import { describe, it, expect } from 'vitest'
import type { RawImage } from './post/raw.js'
import { integerScaleGate, alphaBinaryGate, paletteGate, nativeDensityGate, classDensityGate, spriteDensity } from './pixelGates.js'
import { TOWN_TILE } from './assetResolution.js'
import {
  BUILDING_ZOOM_STOP, CHAR_FIGURE_PX, buildingCellPx, planReCell, reCell,
} from './reCell.js'

// ---------------------------------------------------------------- the sizes

describe('buildingCellPx', () => {
  it('is the deepest zoom stop drawn 1:1 — 32*(w+h) world px times the 4x stop', () => {
    expect(BUILDING_ZOOM_STOP).toBe(4)
    expect(buildingCellPx({ w: 1, h: 1 })).toBe(256)
    expect(buildingCellPx({ w: 1, h: 2 })).toBe(384)
    expect(buildingCellPx({ w: 2, h: 2 })).toBe(512)
  })

  it('gives the whole class ONE density, which is what today\'s trimmed cells cannot do', () => {
    const fps = [{ w: 1, h: 1 }, { w: 1, h: 2 }, { w: 2, h: 2 }]
    const members = fps.map(fp => ({
      name: `${fp.w}x${fp.h}`,
      density: spriteDensity({ canvas: { w: buildingCellPx(fp), h: buildingCellPx(fp) }, footprint: fp, tile: TOWN_TILE }),
    }))
    expect(members.map(m => m.density)).toEqual([8, 8, 8])
    expect(classDensityGate(members).ok).toBe(true)
    for (const [i, fp] of fps.entries()) expect(nativeDensityGate({
      name: members[i]!.name, canvas: { w: buildingCellPx(fp), h: buildingCellPx(fp) },
      footprint: fp, tile: TOWN_TILE,
    }).ok).toBe(true)
  })

  it('RED-proves the shipped cells: 810x866 over a 1x1 is neither whole nor square', () => {
    expect(nativeDensityGate({
      name: 'shed', canvas: { w: 810, h: 866 }, footprint: { w: 1, h: 1 }, tile: TOWN_TILE,
    }).ok).toBe(false)
    expect(integerScaleGate({ w: 1024, h: 1024 }, { w: 810, h: 866 }).failures).toHaveLength(2)
  })
})

describe('CHAR_FIGURE_PX', () => {
  it('is the figure height that renders 1:1 at the deepest zoom stop', () => {
    // characters.ts: scale = CHAR_TARGET_PX / figureH, and CHAR_TARGET_PX is 52
    expect(CHAR_FIGURE_PX).toBe(52 * BUILDING_ZOOM_STOP)
    expect(52 / CHAR_FIGURE_PX * 4).toBe(1)
  })
})

// ---------------------------------------------------------------- the plan

describe('planReCell', () => {
  it('divides by a whole number and takes the window straight out of the source', () => {
    // a 1x1 building: 874 px of subject into a 256 cell wants a 4x window, and 1024 has it
    const p = planReCell({ subjectPx: 874, cellPx: 256, sourcePx: 1024 })
    expect(p).toEqual({ factor: 4, window: 1024, sourceScale: 1, scaledSourcePx: 1024 })
    expect(integerScaleGate({ w: p.window, h: p.window }, { w: 256, h: 256 })).toMatchObject({ ok: true, factor: 4 })
  })

  it('drops a factor and shrinks the source when the window it wants overruns the generation', () => {
    // the wagon: 882 px of subject into a 384 cell wants 3x = 1152, and the raw is 1024
    const p = planReCell({ subjectPx: 882, cellPx: 384, sourcePx: 1024 })
    expect(p.factor).toBe(2)
    expect(p.window).toBe(768)
    expect(p.sourceScale).toBeLessThan(1)
    // the subject must actually fit the window after the correction, with nothing cropped
    expect(882 * p.sourceScale).toBeLessThanOrEqual(768)
    expect(p.scaledSourcePx).toBe(Math.round(1024 * p.sourceScale))
  })

  it('fill takes the factor DOWN so the subject reaches the cell edge', () => {
    // the shed: 866 px of subject, 256 cell. Contain leaves 15% of the window empty and the
    // renderer draws the building 15% smaller than the cell that was signed off.
    const contain = planReCell({ subjectPx: 866, cellPx: 256, sourcePx: 1024 })
    expect(contain).toMatchObject({ factor: 4, window: 1024, sourceScale: 1 })
    expect(866 / contain.window).toBeLessThan(0.86)

    const fill = planReCell({ subjectPx: 866, cellPx: 256, sourcePx: 1024, fill: true })
    expect(fill.factor).toBe(3)
    expect(fill.window).toBe(768)
    expect(866 * fill.sourceScale).toBeCloseTo(768, 5)
    expect(integerScaleGate({ w: fill.window, h: fill.window }, { w: 256, h: 256 })).toMatchObject({ ok: true, factor: 3 })
  })

  it('fill still refuses to enlarge: a subject under two cells keeps its margin', () => {
    // the storehouse: 866 px of subject into a 512 cell cannot fill without upscaling
    const p = planReCell({ subjectPx: 866, cellPx: 512, sourcePx: 1024, fill: true })
    expect(p).toMatchObject({ factor: 2, window: 1024, sourceScale: 1 })
  })

  it('never enlarges a source: a correction throws information away, it does not invent it', () => {
    for (const subjectPx of [200, 500, 874, 882, 1000])
      for (const cellPx of [128, 256, 384, 512])
        expect(planReCell({ subjectPx, cellPx, sourcePx: 1024 }).sourceScale).toBeLessThanOrEqual(1)
  })

  it('holds a target figure height exactly, which is what a walk cycle needs', () => {
    // the two generation families this cast came back in: 840 px of figure in a 1024 frame
    // and 2100 px in a 2528 one. Both must land on the same figure height.
    const a = planReCell({ subjectPx: 840, cellPx: 256, sourcePx: 1024, figurePx: 840, targetFigurePx: 208 })
    const b = planReCell({ subjectPx: 2100, cellPx: 256, sourcePx: 2528, figurePx: 2100, targetFigurePx: 208 })
    expect(a.factor).toBe(4)
    expect(b.factor).toBe(10)
    expect(Math.round(840 * a.sourceScale / a.factor)).toBe(208)
    expect(Math.round(2100 * b.sourceScale / b.factor)).toBe(208)
    // the correction is a nudge, not a resample: both are within 6% of 1
    expect(Math.abs(1 - a.sourceScale)).toBeLessThan(0.06)
    expect(Math.abs(1 - b.sourceScale)).toBeLessThan(0.06)
  })
})

// ---------------------------------------------------------------- the cell

const CREAM = [0xff, 0xf6, 0xe9, 255] as const

// reCell takes an already-keyed generation: clear background, one solid subject in the middle
function fakeGeneration(size: number, subject: number): RawImage {
  const data = new Uint8ClampedArray(size * size * 4)
  const o = Math.floor((size - subject) / 2)
  for (let y = o; y < o + subject; y++) for (let x = o; x < o + subject; x++) data.set(CREAM, (y * size + x) * 4)
  return { width: size, height: size, data }
}

describe('reCell', () => {
  it('lands on the cell size by a whole-number division and clears the pixel bar', () => {
    const r = reCell(fakeGeneration(1024, 800), { cellPx: 256 })
    expect(r.cell.width).toBe(256)
    expect(r.cell.height).toBe(256)
    expect(Number.isInteger(r.plan.factor)).toBe(true)
    expect(integerScaleGate({ w: r.plan.window, h: r.plan.window }, { w: 256, h: 256 }).ok).toBe(true)
    expect(alphaBinaryGate(r.cell).failures).toEqual([])
    expect(paletteGate(r.cell).failures).toEqual([])
  })

  it('normalises the figure to the target height across two generation scales', () => {
    const small = reCell(fakeGeneration(1024, 840), { cellPx: 256, targetFigurePx: 208 })
    const big = reCell(fakeGeneration(2528, 2100), { cellPx: 256, targetFigurePx: 208 })
    const figureH = (img: RawImage): number => {
      let y0 = -1, y1 = -1
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++)
        if (img.data[(y * img.width + x) * 4 + 3] !== 0) { if (y0 < 0) y0 = y; y1 = y; break }
      return y1 - y0 + 1
    }
    expect(Math.abs(figureH(small.cell) - 208)).toBeLessThanOrEqual(1)
    expect(Math.abs(figureH(big.cell) - 208)).toBeLessThanOrEqual(1)
  })

  it('keeps the whole subject: nothing is cropped away by the window', () => {
    const r = reCell(fakeGeneration(1024, 1000), { cellPx: 256 })
    // 1000 px of subject can only reach a 256 cell through a source correction; whatever
    // route it takes, the finished cell must still hold the whole square
    let opaqueRows = 0
    for (let y = 0; y < 256; y++) if (r.cell.data[(y * 256) * 4 + 3] !== 0 || r.cell.data[(y * 256 + 128) * 4 + 3] !== 0) opaqueRows++
    expect(opaqueRows).toBeGreaterThan(200)
    expect(opaqueRows).toBeLessThanOrEqual(256)
  })
})
