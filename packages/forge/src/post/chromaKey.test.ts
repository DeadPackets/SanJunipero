import { describe, it, expect } from 'vitest'
import { chromaKey } from './chromaKey.js'

describe('chromaKey', () => {
  it('pure magenta and near-magenta go transparent; content stays opaque', () => {
    const img = {
      width: 3,
      height: 1,
      // biome-ignore format: pixel grid
      data: new Uint8ClampedArray([
        255, 0, 255, 255,   // pure magenta
        250, 40, 240, 255,  // near magenta (jpeg-ish drift)
        200, 180, 90, 255,  // honey wood — content
      ]),
    }
    const out = chromaKey(img)
    expect(out.data[3]).toBe(0)
    expect(out.data[7]).toBe(0)
    expect(out.data[11]).toBe(255)
  })
  it('alpha is strictly binary — semi-transparent inputs are forced to 0 or 255', () => {
    const img = {
      width: 2,
      height: 1,
      // biome-ignore format: pixel grid
      data: new Uint8ClampedArray([
        255, 0, 255, 128, // magenta with partial alpha → 0
        10, 20, 30, 128,  // content with partial alpha → 255
      ]),
    }
    const out = chromaKey(img)
    expect(out.data[3]).toBe(0)
    expect(out.data[7]).toBe(255)
  })
  it('dusty rose (#F2C6C2) is NOT keyed out at default tolerance', () => {
    const img = { width: 1, height: 1, data: new Uint8ClampedArray([0xf2, 0xc6, 0xc2, 255]) }
    expect(chromaKey(img).data[3]).toBe(255)
  })
  it('does not mutate its input', () => {
    const img = { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 255, 255]) }
    chromaKey(img)
    expect(img.data[3]).toBe(255)
  })
})
