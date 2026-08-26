import type { RawImage } from './raw.js'
import { makeQuantizer } from './quantize.js'
import { paletteRgb, OUTLINE_DARKEN, type Rgb } from '../palette.js'

export function outlinePass(img: RawImage, palette: Rgb[] = paletteRgb()): RawImage {
  const { nearest } = makeQuantizer(palette)
  const out = new Uint8ClampedArray(img.data)
  const alphaAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= img.width || y >= img.height ? 0 : img.data[(y * img.width + x) * 4 + 3]!
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      if (img.data[i + 3] === 0) continue
      const onEdge =
        alphaAt(x - 1, y) === 0 ||
        alphaAt(x + 1, y) === 0 ||
        alphaAt(x, y - 1) === 0 ||
        alphaAt(x, y + 1) === 0
      if (!onEdge) continue
      const p =
        palette[
          nearest(
            Math.round(img.data[i]! * OUTLINE_DARKEN),
            Math.round(img.data[i + 1]! * OUTLINE_DARKEN),
            Math.round(img.data[i + 2]! * OUTLINE_DARKEN),
          )
        ]!
      out[i] = p[0]
      out[i + 1] = p[1]
      out[i + 2] = p[2]
    }
  return { width: img.width, height: img.height, data: out }
}
