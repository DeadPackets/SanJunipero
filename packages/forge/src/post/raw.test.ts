import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { decodePng, encodePng, downscaleNearest, centerCropToAspect, type RawImage } from './raw.js'

describe('raw png io', () => {
  it('decode/encode round-trips a 2x2 magenta png', async () => {
    const src = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer()
    const raw = await decodePng(src)
    expect(raw.width).toBe(2)
    expect(raw.height).toBe(2)
    expect([...raw.data.slice(0, 4)]).toEqual([255, 0, 255, 255])
    const again = await decodePng(await encodePng(raw))
    expect(again.data).toEqual(raw.data)
  })
})

describe('downscaleNearest', () => {
  it('4x4 (left red / right blue) → 2x2 stays pure, no blending', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4)
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++)
        data.set(x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 4 + x) * 4)
    const out = downscaleNearest({ width: 4, height: 4, data }, 2, 2)
    expect([...out.data.slice(0, 4)]).toEqual([255, 0, 0, 255])
    expect([...out.data.slice(4, 8)]).toEqual([0, 0, 255, 255])
  })
  it('does not mutate its input', () => {
    const img: RawImage = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(7) }
    const copy = new Uint8ClampedArray(img.data)
    downscaleNearest(img, 1, 1)
    expect(img.data).toEqual(copy)
  })
})

describe('centerCropToAspect', () => {
  it('returns the input untouched when the aspect already matches', () => {
    const img: RawImage = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(3) }
    expect(centerCropToAspect(img, 32, 32)).toBe(img)
    expect(centerCropToAspect({ ...img, width: 16, height: 4 }, 128, 32).width).toBe(16)
  })
  it('crops a square source to a centered wide band (4:1 → height/4)', () => {
    // 8x8: rows 0-2 red, 3-4 green, 5-7 blue → 4:1 band keeps only the green middle rows
    const data = new Uint8ClampedArray(8 * 8 * 4)
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        data.set(
          y < 3 ? [255, 0, 0, 255] : y < 5 ? [0, 255, 0, 255] : [0, 0, 255, 255],
          (y * 8 + x) * 4,
        )
    const out = centerCropToAspect({ width: 8, height: 8, data }, 128, 32)
    expect(out.width).toBe(8)
    expect(out.height).toBe(2)
    for (let i = 0; i < out.data.length; i += 4)
      expect([...out.data.slice(i, i + 3)]).toEqual([0, 255, 0])
  })
  it('crops a wide source to a centered tall band when target is taller', () => {
    // 8x2 → target aspect 1:1 keeps the middle 2 columns
    const data = new Uint8ClampedArray(8 * 2 * 4)
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 8; x++)
        data.set(x === 3 || x === 4 ? [0, 255, 0, 255] : [255, 0, 0, 255], (y * 8 + x) * 4)
    const out = centerCropToAspect({ width: 8, height: 2, data }, 16, 16)
    expect(out.width).toBe(2)
    expect(out.height).toBe(2)
    for (let i = 0; i < out.data.length; i += 4)
      expect([...out.data.slice(i, i + 3)]).toEqual([0, 255, 0])
  })
})
