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

// A generation that drifted off #FF00FF needs 110 where a clean one needs 72; under 10% keyed,
// the image is not a subject on magenta at all.
export function keyBg(img: RawImage): RawImage {
  for (const tolerance of [72, 110]) {
    const keyed = chromaKey(img, { tolerance })
    let clear = 0
    for (let i = 3; i < keyed.data.length; i += 4) if (keyed.data[i] === 0) clear++
    if (clear / (keyed.width * keyed.height) >= 0.1) return keyed
  }
  throw new Error('keyBg: <10% keyed even at tolerance 110')
}
