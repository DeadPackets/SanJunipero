import type { RawImage } from './raw.js'

// tol 72 keys generation drift around #FF00FF without touching dusty rose (#F2C6C2, g=198).
export function chromaKey(img: RawImage, opts: { tolerance?: number } = {}): RawImage {
  const tol = opts.tolerance ?? 72
  const out = new Uint8ClampedArray(img.data)
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]!,
      g = out[i + 1]!,
      b = out[i + 2]!
    const isBg = 255 - r <= tol && g <= tol && 255 - b <= tol
    out[i + 3] = isBg ? 0 : 255
  }
  return { width: img.width, height: img.height, data: out }
}
