import { chromaKey } from '../post/chromaKey.js'
import { quantize } from '../post/quantize.js'
import { downscaleNearest, type RawImage } from '../post/raw.js'
import {
  despeckle, sweepMagenta, opaqueArea, opaqueBbox, estimatePitch,
  erodeAlpha, resampleToArtHeight,
} from '../sheet.js'

export const ITEM_PITCH_RANGE: [number, number] = [4, 24]
export const ART_MIN_ISLAND = 3
export const CHROMA_BAND_PX = 4

export type SpriteCell = {
  cell: RawImage
  pitch: number      // measured art-cell size of the generation, in source pixels
  artCells: number   // how many art cells the figure spans on its long side
  islands: number    // 4-connected opaque components in the finished cell
  opaqueFrac: number // share of the cell that is opaque
}

// The 512 px generation carries its own big-pixel lattice. Point-sampling it down to 16 px
// samples sub-pixels at a random phase and returns noise, so the chain resamples ON the
// lattice instead: median per art cell, opaque only where the cell is mostly opaque.
export function toSpriteCell(raw: RawImage, px: number): SpriteCell {
  const keyed = chromaKey(raw)
  const cleaned = despeckle(keyed, Math.max(3, Math.ceil(opaqueArea(keyed) * 0.01)))
  const b = opaqueBbox(cleaned)
  if (!b) throw new Error('toSpriteCell: no opaque pixels after keying')

  const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1
  // Fit the LONG side: a saw is far wider than it is tall and must not run off the canvas.
  const targetH = Math.max(1, Math.min(px, Math.round(px * bh / Math.max(bw, bh))))

  let pitch = Number.NaN
  try { pitch = estimatePitch(cleaned, ITEM_PITCH_RANGE) } catch { /* a flat figure has no lattice */ }

  // Erode only the chroma blend band, which is a few source pixels wide whatever the art
  // pitch is. Eroding half an art cell (the character-sheet rule) eats a pail's handle.
  const radius = Math.min(CHROMA_BAND_PX, Math.max(1, Math.floor(Math.min(bw, bh) / 4)))
  const art = resampleToArtHeight(erodeAlpha(cleaned, radius), targetH)
  const fitted = art.width > px
    ? downscaleNearest(art, px, Math.max(1, Math.round(art.height * px / art.width)))
    : art

  // Despeckle again at ART resolution: a thin arch (a pail handle, a rod) resamples into
  // disconnected single cells, which the judge reads as floating pixels and rejects.
  const cell = padSquare(quantize(sweepMagenta(despeckle(fitted, ART_MIN_ISLAND))), px)
  return {
    cell, pitch,
    artCells: Number.isFinite(pitch) ? Math.max(bw, bh) / pitch : Number.NaN,
    islands: countIslands(cell),
    opaqueFrac: opaqueArea(cell) / (px * px),
  }
}

export function countIslands(img: RawImage): number {
  const seen = new Uint8Array(img.width * img.height)
  let n = 0
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || img.data[start * 4 + 3] === 0) continue
    n++
    const stack = [start]
    seen[start] = 1
    while (stack.length) {
      const p = stack.pop()!
      const x = p % img.width, y = (p / img.width) | 0
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue
        const q = ny * img.width + nx
        if (!seen[q] && img.data[q * 4 + 3]! > 0) { seen[q] = 1; stack.push(q) }
      }
    }
  }
  return n
}

export function padSquare(img: RawImage, px: number): RawImage {
  if (img.width === px && img.height === px) return img
  const data = new Uint8ClampedArray(px * px * 4)
  const w = Math.min(img.width, px), h = Math.min(img.height, px)
  const ox = (px - w) >> 1, oy = (px - h) >> 1
  for (let y = 0; y < h; y++)
    data.set(img.data.subarray(y * img.width * 4, y * img.width * 4 + w * 4), ((y + oy) * px + ox) * 4)
  return { width: px, height: px, data }
}

// Rank by silhouette cleanliness, lower is better: one connected subject beats a subject
// plus floating debris, and among equals the fuller cell wins. The plan named pixel pitch,
// but estimatePitch pins to its range floor on these painterly generations and cannot
// separate two candidates — islands can, and it is what the judge actually rejects on.
export function candidateRank(c: { islands: number; opaqueFrac: number }): number {
  return c.islands - c.opaqueFrac
}
