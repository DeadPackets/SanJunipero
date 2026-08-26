// The integer-downscale post path for a single-subject sprite: pick a WHOLE factor first, crop a
// factor-sized window around the subject, and divide by it — never a fractional resample.
import { chromaKey } from '../post/chromaKey.js'
import { quantize } from '../post/quantize.js'
import type { RawImage } from '../post/raw.js'
import { despeckle, erodeAlpha, opaqueArea, opaqueBbox, sweepMagenta } from '../sheet.js'
import { MIN_DOWNSCALE_FACTOR } from '../assetResolution.js'
import { ART_MIN_ISLAND, CHROMA_BAND_PX, countIslands } from './postItem.js'

export type IntegralCell = {
  cell: RawImage
  factor: number       // whole-number division between the crop and the cell
  crop: { w: number; h: number }
  islands: number
  opaqueFrac: number
}

// The smallest whole factor whose window still holds the subject: the smaller the factor,
// the more of the cell the subject fills. Bounded above by what the generation can supply.
export function chooseCropFactor(subjectLongPx: number, cellPx: number, genPx: number): number {
  const fit = Math.ceil(subjectLongPx / cellPx)
  const ceiling = Math.max(MIN_DOWNSCALE_FACTOR, Math.floor(genPx / cellPx))
  return Math.min(ceiling, Math.max(MIN_DOWNSCALE_FACTOR, fit))
}

// A block is opaque only when at least half its pixels are, which keeps alpha binary by
// construction; the colour is the median, which survives dither where a corner sample would not.
function blockSample(
  img: RawImage, x0: number, y0: number, f: number,
): [number, number, number, number] {
  const rs: number[] = [], gs: number[] = [], bs: number[] = []
  let seen = 0
  for (let y = y0; y < y0 + f; y++) {
    if (y < 0 || y >= img.height) continue
    for (let x = x0; x < x0 + f; x++) {
      if (x < 0 || x >= img.width) continue
      seen++
      const i = (y * img.width + x) * 4
      if (img.data[i + 3]! < 128) continue
      rs.push(img.data[i]!); gs.push(img.data[i + 1]!); bs.push(img.data[i + 2]!)
    }
  }
  if (seen === 0 || rs.length * 2 < f * f) return [0, 0, 0, 0]
  const mid = (v: number[]): number => v.sort((a, b) => a - b)[v.length >> 1]!
  return [mid(rs), mid(gs), mid(bs), 255]
}

export function integralSpriteCell(
  raw: RawImage, cellPx: number,
  opts: { minFactor?: number; keepEmpty?: boolean } = {},
): IntegralCell {
  const keyed = opts.keepEmpty === true ? raw : chromaKey(raw)
  const cleaned = opts.keepEmpty === true
    ? keyed
    : despeckle(keyed, Math.max(3, Math.ceil(opaqueArea(keyed) * 0.01)))
  const b = opaqueBbox(cleaned)
  if (!b) throw new Error('integralSpriteCell: no opaque pixels after keying')
  const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1

  const genPx = Math.min(raw.width, raw.height)
  const factor = Math.max(opts.minFactor ?? MIN_DOWNSCALE_FACTOR,
    chooseCropFactor(Math.max(bw, bh), cellPx, genPx))
  const window = cellPx * factor

  // Erode only the chroma blend band: it is a few source pixels wide whatever the art pitch
  // is, and eroding more than that eats a pail's handle.
  const source = opts.keepEmpty === true
    ? cleaned
    : erodeAlpha(cleaned, Math.min(CHROMA_BAND_PX, Math.max(1, Math.floor(Math.min(bw, bh) / 4))))

  // Centre the window on the subject; anything it overhangs comes back transparent.
  const ox = Math.round(b.x0 + bw / 2 - window / 2)
  const oy = Math.round(b.y0 + bh / 2 - window / 2)

  const data = new Uint8ClampedArray(cellPx * cellPx * 4)
  for (let cy = 0; cy < cellPx; cy++)
    for (let cx = 0; cx < cellPx; cx++)
      data.set(blockSample(source, ox + cx * factor, oy + cy * factor, factor), (cy * cellPx + cx) * 4)

  const raw2: RawImage = { width: cellPx, height: cellPx, data }
  const cell = opts.keepEmpty === true
    ? raw2
    : quantize(sweepMagenta(despeckle(raw2, ART_MIN_ISLAND)))
  return {
    cell, factor, crop: { w: window, h: window },
    islands: countIslands(cell),
    opaqueFrac: opaqueArea(cell) / (cellPx * cellPx),
  }
}
