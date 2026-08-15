import type { RawImage } from './post/raw.js'

export type Tint = { r: number; g: number; b: number }

// Spec §7 atmosphere: deep blue moonlit night, golden dawn, grey-green storm, snow-blued winter.
export const TINTS: Record<'day' | 'night' | 'dawn' | 'storm' | 'winter', Tint> = {
  day:    { r: 1.00, g: 1.00, b: 1.00 },
  night:  { r: 0.45, g: 0.52, b: 0.95 },
  dawn:   { r: 1.12, g: 0.94, b: 0.78 },
  storm:  { r: 0.72, g: 0.82, b: 0.76 },
  winter: { r: 0.86, g: 0.93, b: 1.10 },
}

export function applyTint(img: RawImage, t: Tint): RawImage {
  const out = new Uint8ClampedArray(img.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = Math.min(255, Math.round(out[i]! * t.r))
    out[i + 1] = Math.min(255, Math.round(out[i + 1]! * t.g))
    out[i + 2] = Math.min(255, Math.round(out[i + 2]! * t.b))
  }
  return { width: img.width, height: img.height, data: out }
}
