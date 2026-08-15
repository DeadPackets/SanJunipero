import sharp from 'sharp'

export type RawImage = { width: number; height: number; data: Uint8ClampedArray }

export async function decodePng(buf: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) }
}

export async function encodePng(img: RawImage): Promise<Buffer> {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength),
    { raw: { width: img.width, height: img.height, channels: 4 } }).png().toBuffer()
}

// keeps x/y scale factors equal when a square generation feeds a non-square target
export function centerCropToAspect(img: RawImage, tw: number, th: number): RawImage {
  if (img.width * th === img.height * tw) return img
  let cw = img.width, ch = img.height
  if (img.width * th > img.height * tw) cw = Math.max(1, Math.round(img.height * tw / th))
  else ch = Math.max(1, Math.round(img.width * th / tw))
  const x0 = (img.width - cw) >> 1, y0 = (img.height - ch) >> 1
  const out = new Uint8ClampedArray(cw * ch * 4)
  for (let y = 0; y < ch; y++)
    out.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + cw) * 4), y * cw * 4)
  return { width: cw, height: ch, data: out }
}

export function downscaleNearest(img: RawImage, w: number, h: number): RawImage {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y + 0.5) * img.height / h))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x + 0.5) * img.width / w))
      const s = (sy * img.width + sx) * 4, d = (y * w + x) * 4
      out[d] = img.data[s]!; out[d + 1] = img.data[s + 1]!; out[d + 2] = img.data[s + 2]!; out[d + 3] = img.data[s + 3]!
    }
  }
  return { width: w, height: h, data: out }
}
