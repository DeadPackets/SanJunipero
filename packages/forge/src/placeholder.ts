import type { RawImage } from './post/raw.js'
import { paletteRgb } from './palette.js'
import type { AssetClass } from '@sj/shared'

// Deterministic warm-grey checkerboard with a dark border — the "art pending" sprite.
export function makePlaceholder(_klass: AssetClass, target: { w: number; h: number }): RawImage {
  const pal = paletteRgb()
  const light = pal[24]!, dark = pal[25]!, border = pal[31]! // #E9E2DA, #CFC6BC, #241F2B
  const data = new Uint8ClampedArray(target.w * target.h * 4)
  for (let y = 0; y < target.h; y++) for (let x = 0; x < target.w; x++) {
    const onBorder = x === 0 || y === 0 || x === target.w - 1 || y === target.h - 1
    const c = onBorder ? border : ((x >> 2) + (y >> 2)) % 2 === 0 ? light : dark
    data.set([c[0], c[1], c[2], 255], (y * target.w + x) * 4)
  }
  return { width: target.w, height: target.h, data }
}
