import type { RawImage } from './raw.js'
import { paletteRgb, type Rgb } from '../palette.js'

export function makeQuantizer(palette: Rgb[]) {
  const cache = new Map<number, number>()
  function nearest(r: number, g: number, b: number): number {
    const key = (r << 16) | (g << 8) | b
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    let best = 0,
      bestD = Infinity
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i]!
      const d = (r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    cache.set(key, best)
    return best
  }
  return { nearest, cache }
}

export function quantize(img: RawImage, palette: Rgb[] = paletteRgb()): RawImage {
  const { nearest } = makeQuantizer(palette)
  const out = new Uint8ClampedArray(img.data)
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) {
      out[i] = 0
      out[i + 1] = 0
      out[i + 2] = 0
      continue
    }
    const p = palette[nearest(out[i]!, out[i + 1]!, out[i + 2]!)]!
    out[i] = p[0]
    out[i + 1] = p[1]
    out[i + 2] = p[2]
  }
  return { width: img.width, height: img.height, data: out }
}
