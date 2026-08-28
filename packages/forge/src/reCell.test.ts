import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { decodePng, type RawImage } from './post/raw.js'
import { keyBg } from './post/chromaKey.js'
import { opaqueBbox } from './sheet.js'
import {
  integerScaleGate,
  alphaBinaryGate,
  nativeDensityGate,
  classDensityGate,
  spriteDensity,
} from './pixelGates.js'
import { TOWN_TILE } from './assetResolution.js'
import { BUILDING_ZOOM_STOP, CHAR_FIGURE_PX, buildingCellPx, spriteCell } from './reCell.js'

// ---------------------------------------------------------------- the sizes

describe('buildingCellPx', () => {
  it('is the deepest zoom stop drawn 1:1 — 32*(w+h) world px times the 4x stop', () => {
    expect(BUILDING_ZOOM_STOP).toBe(4)
    expect(buildingCellPx({ w: 1, h: 1 })).toBe(256)
    expect(buildingCellPx({ w: 1, h: 2 })).toBe(384)
    expect(buildingCellPx({ w: 2, h: 2 })).toBe(512)
  })

  it("gives the whole class ONE density, which is what today's trimmed cells cannot do", () => {
    const fps = [
      { w: 1, h: 1 },
      { w: 1, h: 2 },
      { w: 2, h: 2 },
    ]
    const members = fps.map((fp) => ({
      name: `${fp.w}x${fp.h}`,
      density: spriteDensity({
        canvas: { w: buildingCellPx(fp), h: buildingCellPx(fp) },
        footprint: fp,
        tile: TOWN_TILE,
      }),
    }))
    expect(members.map((m) => m.density)).toEqual([8, 8, 8])
    expect(classDensityGate(members).ok).toBe(true)
    for (const [i, fp] of fps.entries())
      expect(
        nativeDensityGate({
          name: members[i]!.name,
          canvas: { w: buildingCellPx(fp), h: buildingCellPx(fp) },
          footprint: fp,
          tile: TOWN_TILE,
        }).ok,
      ).toBe(true)
  })

  it('RED-proves the shipped cells: 810x866 over a 1x1 is neither whole nor square', () => {
    expect(
      nativeDensityGate({
        name: 'shed',
        canvas: { w: 810, h: 866 },
        footprint: { w: 1, h: 1 },
        tile: TOWN_TILE,
      }).ok,
    ).toBe(false)
    expect(integerScaleGate({ w: 1024, h: 1024 }, { w: 810, h: 866 }).failures).toHaveLength(2)
  })
})

describe('CHAR_FIGURE_PX', () => {
  it('is the figure height that renders 1:1 at the deepest zoom stop', () => {
    // characters.ts: scale = CHAR_TARGET_PX / figureH, and CHAR_TARGET_PX is 52
    expect(CHAR_FIGURE_PX).toBe(52 * BUILDING_ZOOM_STOP)
    expect((52 / CHAR_FIGURE_PX) * 4).toBe(1)
  })
})

// ---------------------------------------------------------------- the cell

const CREAM = [0xff, 0xf6, 0xe9, 255] as const

// spriteCell takes an already-keyed generation: clear background, one solid subject
function fakeGeneration(size: number, subject: number, top = -1): RawImage {
  const data = new Uint8ClampedArray(size * size * 4)
  const ox = Math.floor((size - subject) / 2)
  const oy = top < 0 ? ox : top
  for (let y = oy; y < oy + subject; y++)
    for (let x = ox; x < ox + subject; x++) data.set(CREAM, (y * size + x) * 4)
  return { width: size, height: size, data }
}

const bbox = (img: RawImage) => opaqueBbox(img)!

describe('spriteCell', () => {
  it('divides by a WHOLE factor and never resamples the source', () => {
    const r = spriteCell(fakeGeneration(1024, 800), { w: 256, h: 256, anchor: 'centre' })
    expect(r.cell.width).toBe(256)
    expect(r.cell.height).toBe(256)
    expect(r.plan).toMatchObject({ factor: 4, window: 1024 })
    expect(integerScaleGate({ w: 1024, h: 1024 }, { w: 256, h: 256 })).toMatchObject({
      ok: true,
      factor: 4,
    })
  })

  it('takes the next whole factor up rather than shrinking a subject that overruns', () => {
    // 882 px of subject into a 384 cell: factor 2 would clip it, so the factor is 3 and the
    // subject sits smaller in a 1152 window that overhangs the 1024 generation.
    const r = spriteCell(fakeGeneration(1024, 882), { w: 384, h: 384, anchor: 'centre' })
    expect(r.plan.factor).toBe(3)
    expect(r.plan.window).toBe(1152)
    const b = bbox(r.cell)
    expect(b.x1 - b.x0 + 1).toBeLessThan(384)
  })

  it('keeps the whole subject: nothing is cropped away by the window', () => {
    const r = spriteCell(fakeGeneration(1024, 1000), { w: 256, h: 256, anchor: 'centre' })
    const b = bbox(r.cell)
    // 1000 px of subject minus the 4 px chroma band, divided by the factor of 4
    expect(b.x1 - b.x0 + 1).toBeGreaterThan(240)
    expect(b.y1 - b.y0 + 1).toBeGreaterThan(240)
  })

  it('anchors feet on the last row and centre in the middle', () => {
    const high = fakeGeneration(1024, 400, 100)
    expect(bbox(spriteCell(high, { w: 256, h: 256, anchor: 'feet' }).cell).y1).toBe(255)
    const centred = bbox(spriteCell(high, { w: 256, h: 256, anchor: 'centre' }).cell)
    expect(Math.abs(255 - centred.y1 - centred.y0)).toBeLessThanOrEqual(2)
  })

  // ★ The 4-frame rig sheet: 128x32, and a subject taller than that aspect. A square cell cut
  // down to the target used to take 16 rows off the top and the bottom.
  it('★ a NON-SQUARE target keeps a tall subject whole, head and feet', () => {
    const src: RawImage = { width: 512, height: 512, data: new Uint8ClampedArray(512 * 512 * 4) }
    for (let y = 224; y < 288; y++)
      for (let x = 192; x < 320; x++) src.data.set(CREAM, (y * 512 + x) * 4)

    const r = spriteCell(src, { w: 128, h: 32, anchor: 'centre' })

    expect([r.cell.width, r.cell.height]).toEqual([128, 32])
    // 128x64 of subject (less the 4 px band) into 128x32: the height is what picks the factor.
    expect(r.plan.factor).toBe(2)
    const b = bbox(r.cell)
    expect(b.y0, 'the top of the subject is cut off').toBeGreaterThan(0)
    expect(b.y1, 'the bottom of the subject is cut off').toBeLessThan(31)
  })

  it('is deterministic', () => {
    const src = fakeGeneration(1024, 800)
    const a = spriteCell(src, { w: 256, h: 256, anchor: 'feet' })
    const b = spriteCell(src, { w: 256, h: 256, anchor: 'feet' })
    expect([...a.cell.data]).toEqual([...b.cell.data])
  })
})

// ------------------------------------------------- the chain, on one real provider generation

// `stages/00-raw.png` from the 2026-08-27 sprite-chain trace: the house/sw generation that cost
// $0.1027, untouched provider bytes. The only fixture in this package that a model actually drew.
describe('keyBg → spriteCell on a real 2048 generation', () => {
  it('lands a 512 cell on a whole factor, binary alpha and the model’s own colours', async () => {
    const raw = await decodePng(
      readFileSync(new URL('./fixtures/house-sw-raw.png', import.meta.url)),
    )
    expect([raw.width, raw.height]).toEqual([2048, 2048])

    const r = spriteCell(keyBg(raw), { w: 512, h: 512, anchor: 'feet' })

    expect(Number.isInteger(r.plan.factor)).toBe(true)
    expect(r.plan.factor).toBe(4)
    expect([r.cell.width, r.cell.height]).toEqual([512, 512])
    // the GENERATION divides by the cell, which is what the gate on this path now measures
    expect(integerScaleGate({ w: raw.width, h: raw.height }, { w: 512, h: 512 }).ok).toBe(true)
    expect(alphaBinaryGate(r.cell).softPixels).toBe(0)

    const colours = new Set<number>()
    for (let i = 0; i < r.cell.data.length; i += 4) {
      if (r.cell.data[i + 3] === 0) continue
      colours.add((r.cell.data[i]! << 16) | (r.cell.data[i + 1]! << 8) | r.cell.data[i + 2]!)
    }
    // the old chain quantized this same cell to 29 colours, which is what the user saw as mush
    expect(colours.size).toBeGreaterThan(1000)

    expect(bbox(r.cell).y1).toBe(511)
  })
})
