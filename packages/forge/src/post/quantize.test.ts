import { describe, it, expect } from 'vitest'
import { makeQuantizer, quantize } from './quantize.js'
import { paletteRgb } from '../palette.js'

describe('makeQuantizer', () => {
  it('exact palette colors map to their own index', () => {
    const pal = paletteRgb()
    const { nearest } = makeQuantizer(pal)
    pal.forEach(([r, g, b], i) => {
      expect(nearest(r, g, b)).toBe(i)
    })
  })
  it('off-palette colors snap to the nearest by squared RGB distance', () => {
    // biome-ignore format: pixel grid
    const { nearest } = makeQuantizer([[0, 0, 0], [100, 100, 100]])
    expect(nearest(10, 10, 10)).toBe(0)
    expect(nearest(90, 80, 95)).toBe(1)
  })
  it('caches lookups by packed rgb', () => {
    const q = makeQuantizer([[0, 0, 0]])
    q.nearest(5, 5, 5)
    q.nearest(5, 5, 5)
    q.nearest(6, 5, 5)
    expect(q.cache.size).toBe(2)
  })
})

describe('quantize', () => {
  it('snaps opaque pixels to the palette and canonicalizes transparent pixels', () => {
    const img = {
      width: 2,
      height: 1,
      // biome-ignore format: pixel grid
      data: new Uint8ClampedArray([
        0xff, 0xf5, 0xe8, 255, // near cream #FFF6E9
        42, 42, 42, 0,         // transparent garbage
      ]),
    }
    const out = quantize(img)
    expect([...out.data.slice(0, 4)]).toEqual([0xff, 0xf6, 0xe9, 255])
    expect([...out.data.slice(4, 8)]).toEqual([0, 0, 0, 0])
  })
})
