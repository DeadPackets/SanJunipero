import { decodePng, encodePng, centerCropToAspect, type RawImage } from './raw.js'
import { keyBg } from './chromaKey.js'
import { spriteCell } from '../reCell.js'
import type { AssetClass } from '../styleBible.js'

type Anchor = 'feet' | 'centre'
type Target = { w: number; h: number }

// `null` is a class with no chroma key: a sheet with no background has no subject to anchor.
const ANCHOR: Record<AssetClass, Anchor | null> = {
  building: 'feet',
  item: 'centre',
  crop: 'centre',
  'rig-part': 'centre',
  terrain: null,
  portrait: null,
}

function centreCrop(img: RawImage, w: number, h: number): RawImage {
  if (img.width === w && img.height === h) return img
  const x0 = (img.width - w) >> 1,
    y0 = (img.height - h) >> 1
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    data.set(
      img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4),
      y * w * 4,
    )
  return { width: w, height: h, data }
}

// The MEDIAN of each block survives the generation's JPEG ringing where a point sample ships it.
// Every value is a byte, so a 256-bin count beats a comparator sort ~20x on a 2048 source.
function medianDownscale(img: RawImage, f: number): RawImage {
  if (f === 1) return img
  const w = img.width / f,
    h = img.height / f
  const out = new Uint8ClampedArray(w * h * 4)
  const bins = new Int32Array(4 * 256)
  const half = (f * f) >> 1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      bins.fill(0)
      for (let dy = 0; dy < f; dy++) {
        let i = ((y * f + dy) * img.width + x * f) * 4
        for (let dx = 0; dx < f; dx++, i += 4)
          for (let c = 0; c < 4; c++) {
            const k = c * 256 + img.data[i + c]!
            bins[k] = bins[k]! + 1
          }
      }
      const o = (y * w + x) * 4
      for (let c = 0; c < 4; c++) {
        let acc = 0,
          v = 0
        while (acc <= half) acc += bins[c * 256 + v++]!
        out[o + c] = v - 1
      }
    }
  return { width: w, height: h, data: out }
}

function keyedSprite(img: RawImage, anchor: Anchor, target: Target): RawImage {
  return spriteCell(keyBg(img), { w: target.w, h: target.h, anchor }).cell
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
  return medianDownscale(centreCrop(c, target.w * factor, target.h * factor), factor)
}

/** Throws on a generation the chain cannot cut; the caller treats that as a failed candidate. */
export async function postProcess(png: Buffer, klass: AssetClass, target: Target): Promise<Buffer> {
  const img = await decodePng(png)
  const anchor = ANCHOR[klass]
  return encodePng(anchor === null ? flatSheet(img, target) : keyedSprite(img, anchor, target))
}
