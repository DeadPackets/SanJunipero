import { decodePng, encodePng, centerCropToAspect, type RawImage } from './raw.js'
import { keyBg } from './chromaKey.js'
import { spriteCell } from '../reCell.js'
import type { AssetClass } from '../styleBible.js'

const KEYED: Record<AssetClass, boolean> = {
  building: true,
  item: true,
  crop: true,
  'rig-part': true,
  terrain: false,
  portrait: false,
}

type Target = { w: number; h: number }

// The square cell is cut down to a non-square target (crop and rig sheets); the cell side is the
// target's longer edge, so a subject with the target's aspect loses nothing.
function cropTo(img: RawImage, w: number, h: number, anchor: 'feet' | 'centre'): RawImage {
  if (img.width === w && img.height === h) return img
  const x0 = (img.width - w) >> 1
  const y0 = anchor === 'feet' ? img.height - h : (img.height - h) >> 1
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    data.set(
      img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4),
      y * w * 4,
    )
  return { width: w, height: h, data }
}

// The MEDIAN of each block survives the generation's JPEG ringing where a point sample ships it.
function medianDownscale(img: RawImage, f: number): RawImage {
  if (f === 1) return img
  const w = img.width / f,
    h = img.height / f
  const data = new Uint8ClampedArray(w * h * 4)
  const block: number[] = []
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        block.length = 0
        for (let dy = 0; dy < f; dy++)
          for (let dx = 0; dx < f; dx++)
            block.push(img.data[((y * f + dy) * img.width + x * f + dx) * 4 + c]!)
        block.sort((a, b) => a - b)
        data[(y * w + x) * 4 + c] = block[block.length >> 1]!
      }
  return { width: w, height: h, data }
}

function keyedSprite(img: RawImage, klass: AssetClass, target: Target): RawImage {
  const anchor = klass === 'building' ? 'feet' : 'centre'
  const { cell } = spriteCell(keyBg(img), { cellPx: Math.max(target.w, target.h), anchor })
  return cropTo(cell, target.w, target.h, anchor)
}

// No subject to find and no alpha to erode, so the sheet keeps its framing: crop to the target
// aspect, then take the largest window a WHOLE factor divides.
function flatSheet(img: RawImage, target: Target): RawImage {
  const c = centerCropToAspect(img, target.w, target.h)
  const factor = Math.min(Math.floor(c.width / target.w), Math.floor(c.height / target.h))
  if (factor < 1)
    throw new Error(
      `postProcess: ${c.width}x${c.height} is under the ${target.w}x${target.h} target`,
    )
  return medianDownscale(cropTo(c, target.w * factor, target.h * factor, 'centre'), factor)
}

/** Throws on a generation the chain cannot cut; the caller treats that as a failed candidate. */
export async function postProcess(png: Buffer, klass: AssetClass, target: Target): Promise<Buffer> {
  const img = await decodePng(png)
  return encodePng(KEYED[klass] ? keyedSprite(img, klass, target) : flatSheet(img, target))
}
