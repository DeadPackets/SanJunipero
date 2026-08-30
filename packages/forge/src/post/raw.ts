import sharp from 'sharp'

export type RawImage = { width: number; height: number; data: Uint8ClampedArray }

export async function decodePng(buf: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) }
}

const fromRaw = (img: RawImage): sharp.Sharp =>
  sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: 4 },
  })

export async function encodePng(img: RawImage): Promise<Buffer> {
  return fromRaw(img).png().toBuffer()
}

/** The shipped art's container. `effort: 6` is sharp's slowest and smallest — ~1 s per character
 *  atlas, so this belongs at rest and never on a request. */
export async function encodeWebp(img: RawImage): Promise<Buffer> {
  return fromRaw(img).webp({ lossless: true, effort: 6 }).toBuffer()
}

/** libwebp rewrites the RGB under alpha = 0 to whatever compresses, so a byte-for-byte compare
 *  of two WebP images reports differences no draw of them can ever show. */
export function visiblePixelDiffs(a: RawImage, b: RawImage): number {
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    const alpha = a.data[i + 3]
    if (alpha !== b.data[i + 3]) n++
    else if (
      alpha !== 0 &&
      (a.data[i] !== b.data[i] ||
        a.data[i + 1] !== b.data[i + 1] ||
        a.data[i + 2] !== b.data[i + 2])
    )
      n++
  }
  return n
}

// keeps x/y scale factors equal when a square generation feeds a non-square target
export function centerCropToAspect(img: RawImage, tw: number, th: number): RawImage {
  if (img.width * th === img.height * tw) return img
  let cw = img.width,
    ch = img.height
  if (img.width * th > img.height * tw) cw = Math.max(1, Math.round((img.height * tw) / th))
  else ch = Math.max(1, Math.round((img.width * th) / tw))
  const x0 = (img.width - cw) >> 1,
    y0 = (img.height - ch) >> 1
  const out = new Uint8ClampedArray(cw * ch * 4)
  for (let y = 0; y < ch; y++)
    out.set(
      img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + cw) * 4),
      y * cw * 4,
    )
  return { width: cw, height: ch, data: out }
}

export function downscaleNearest(img: RawImage, w: number, h: number): RawImage {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(((y + 0.5) * img.height) / h))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(((x + 0.5) * img.width) / w))
      const s = (sy * img.width + sx) * 4,
        d = (y * w + x) * 4
      out[d] = img.data[s]!
      out[d + 1] = img.data[s + 1]!
      out[d + 2] = img.data[s + 2]!
      out[d + 3] = img.data[s + 3]!
    }
  }
  return { width: w, height: h, data: out }
}
