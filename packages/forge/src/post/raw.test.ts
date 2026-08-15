import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { decodePng, encodePng, downscaleNearest, type RawImage } from './raw.js'

describe('raw png io', () => {
  it('decode/encode round-trips a 2x2 magenta png', async () => {
    const src = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } } }).png().toBuffer()
    const raw = await decodePng(src)
    expect(raw.width).toBe(2); expect(raw.height).toBe(2)
    expect([...raw.data.slice(0, 4)]).toEqual([255, 0, 255, 255])
    const again = await decodePng(await encodePng(raw))
    expect(again.data).toEqual(raw.data)
  })
})

describe('downscaleNearest', () => {
  it('4x4 (left red / right blue) → 2x2 stays pure, no blending', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4)
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++)
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
