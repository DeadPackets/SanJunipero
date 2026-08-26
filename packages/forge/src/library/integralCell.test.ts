import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { decodePng, type RawImage } from '../post/raw.js'
import { alphaBinaryGate, integerScaleGate, paletteGate } from '../pixelGates.js'
import { MIN_DOWNSCALE_FACTOR } from '../assetResolution.js'
import { chooseCropFactor, integralSpriteCell } from './integralCell.js'
import { toSpriteCell } from './postItem.js'
import { chromaKey } from '../post/chromaKey.js'
import { despeckle, opaqueBbox } from '../sheet.js'

const rawFixture = (): Promise<RawImage> =>
  decodePng(readFileSync(new URL('../fixtures/pixel-gates/generation-512.png', import.meta.url)))

describe('chooseCropFactor', () => {
  it('takes the smallest whole factor that still holds the subject, so it fills the cell', () => {
    // a 300 px subject into a 128 px cell: 3x gives a 384 window (78% full), 4x only 59%
    expect(chooseCropFactor(300, 128, 512)).toBe(3)
  })
  it('never goes below the factor floor, however small the subject is', () => {
    expect(chooseCropFactor(40, 128, 512)).toBe(MIN_DOWNSCALE_FACTOR)
  })
  it('never asks for a window larger than the generation', () => {
    expect(chooseCropFactor(500, 128, 512)).toBe(4)
    expect(128 * 4).toBeLessThanOrEqual(512)
  })
})

describe('integralSpriteCell', () => {
  it('RED-proves the old chain: toSpriteCell reaches 128 by a fractional resample', async () => {
    const raw = await rawFixture()
    const b = opaqueBbox(despeckle(chromaKey(raw), 3))!
    const bh = b.y1 - b.y0 + 1,
      bw = b.x1 - b.x0 + 1
    // toSpriteCell fits the LONG side of the bbox to the cell, so its pitch is bbox/cell —
    // whatever the subject happened to measure, and here not a whole number
    const oldPitch = bh / Math.min(128, Math.round((128 * bh) / Math.max(bw, bh)))
    expect(Number.isInteger(oldPitch)).toBe(false)
    expect(toSpriteCell(raw, 128).cell.width).toBe(128) // the canvas hides it; the pitch does not

    expect(Number.isInteger(integralSpriteCell(raw, 128).factor)).toBe(true)
  })

  it('lands on the cell by an exact whole-number division of its crop', async () => {
    const r = integralSpriteCell(await rawFixture(), 128)
    expect(r.cell.width).toBe(128)
    expect(r.cell.height).toBe(128)
    expect(Number.isInteger(r.factor)).toBe(true)
    expect(r.factor).toBeGreaterThanOrEqual(MIN_DOWNSCALE_FACTOR)
    expect(r.crop).toEqual({ w: 128 * r.factor, h: 128 * r.factor })
    expect(integerScaleGate(r.crop, { w: 128, h: 128 })).toMatchObject({
      ok: true,
      factor: r.factor,
    })
  })

  it('the finished cell clears the alpha and palette gates', async () => {
    const r = integralSpriteCell(await rawFixture(), 128)
    expect(alphaBinaryGate(r.cell).failures).toEqual([])
    expect(paletteGate(r.cell).failures).toEqual([])
  })

  it('the subject fills the cell rather than floating in a wide margin', async () => {
    const r = integralSpriteCell(await rawFixture(), 128)
    let x0 = 128,
      x1 = -1,
      y0 = 128,
      y1 = -1
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        if (r.cell.data[(y * 128 + x) * 4 + 3] === 0) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    expect(Math.max(x1 - x0 + 1, y1 - y0 + 1) / 128).toBeGreaterThan(0.6)
  })

  const cream = [0xff, 0xf6, 0xe9, 255],
    dark = [0x17, 0x14, 0x20, 255]
  const filled = (w: number, h: number): Uint8ClampedArray => {
    const d = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < d.length; i += 4) d.set(cream, i)
    return d
  }

  it('takes the majority colour of each block, not a corner sample', () => {
    // 4x4 source at factor 2: the top-left block is 3 cream to 1 shadow
    const data = filled(4, 4)
    data.set(dark, 0)
    const r = integralSpriteCell({ width: 4, height: 4, data }, 2, {
      minFactor: 2,
      keepEmpty: true,
    })
    expect([...r.cell.data.slice(0, 4)]).toEqual(cream)
  })

  it('a block that is mostly clear comes back clear, and alpha stays binary', () => {
    const data = filled(8, 8)
    for (const [x, y] of [
      [3, 0],
      [2, 1],
      [3, 1],
    ] as const)
      data.set([0, 0, 0, 0], (y * 8 + x) * 4)
    const r = integralSpriteCell({ width: 8, height: 8, data }, 4, {
      minFactor: 2,
      keepEmpty: true,
    })
    expect(r.cell.data[3]).toBe(255) // block (0,0): 4 of 4 opaque
    expect(r.cell.data[4 + 3]).toBe(0) // block (1,0): 1 of 4 opaque
    expect([...r.cell.data].filter((_, i) => i % 4 === 3).every((a) => a === 0 || a === 255)).toBe(
      true,
    )
  })
})
