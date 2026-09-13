import type { RawImage } from './post/raw.js'

export type Tint = { r: number; g: number; b: number }

export function applyTint(img: RawImage, t: Tint): RawImage {
  const out = new Uint8ClampedArray(img.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = Math.min(255, Math.round(out[i]! * t.r))
    out[i + 1] = Math.min(255, Math.round(out[i + 1]! * t.g))
    out[i + 2] = Math.min(255, Math.round(out[i + 2]! * t.b))
  }
  return { width: img.width, height: img.height, data: out }
}
