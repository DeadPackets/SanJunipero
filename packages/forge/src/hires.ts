// Character cells are stored at NATIVE model resolution — chroma-keyed, alpha-trimmed, palette-
// quantized, height-normalized; the webview scales down through the per-cell manifest anchors.
import type { RawImage } from './post/raw.js'
import { downscaleNearest } from './post/raw.js'
import { quantize } from './post/quantize.js'
import { opaqueBbox, opaqueArea, despeckle, sweepMagenta } from './sheet.js'
import { CELL_NAMES_V4 } from './mirror.js'

export const HIRES_MARGIN = 4

// Crop to the opaque bbox plus a uniform transparent margin.
export function trimToFigure(img: RawImage, margin = HIRES_MARGIN): RawImage {
  const b = opaqueBbox(img)
  if (!b) throw new Error('trimToFigure: no opaque pixels')
  const w = b.x1 - b.x0 + 1 + margin * 2
  const h = b.y1 - b.y0 + 1 + margin * 2
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
    const s = (y * img.width + x) * 4
    if (img.data[s + 3] === 0) continue
    data.set(img.data.subarray(s, s + 4), ((y - b.y0 + margin) * w + (x - b.x0 + margin)) * 4)
  }
  return { width: w, height: h, data }
}

// Uniform nearest-neighbor scale so the opaque figure height lands on targetH
// (±1 from rounding — the manifest carries the exact result, so this is safe).
export function normalizeFigureHeight(img: RawImage, targetH: number): RawImage {
  const b = opaqueBbox(img)
  if (!b) throw new Error('normalizeFigureHeight: no opaque pixels')
  const bh = b.y1 - b.y0 + 1
  if (bh === targetH) return img
  const k = targetH / bh
  return downscaleNearest(img,
    Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)))
}

export type CellAnchor = { w: number; h: number; feetX: number; feetY: number }

// Feet = bottom-center of the opaque bbox.
export function cellAnchor(img: RawImage): CellAnchor {
  const b = opaqueBbox(img)
  if (!b) throw new Error('cellAnchor: no opaque pixels')
  return { w: img.width, h: img.height, feetX: Math.round((b.x0 + b.x1) / 2), feetY: b.y1 }
}

export type CharacterManifestV4 = {
  version: 'v4-hires'
  figureH: number
  cells: Record<string, CellAnchor>
}

// Manifest for the renderer: exactly the 24-cell contract, one anchor per cell.
export function buildManifestV4(cells: Map<string, RawImage>, figureH: number): CharacterManifestV4 {
  const missing = CELL_NAMES_V4.filter(n => !cells.has(n))
  if (missing.length) throw new Error(`buildManifestV4: missing cells ${missing.join(', ')}`)
  const extra = [...cells.keys()].filter(n => !CELL_NAMES_V4.includes(n))
  if (extra.length) throw new Error(`buildManifestV4: unexpected cells ${extra.join(', ')}`)
  const anchors: Record<string, CellAnchor> = {}
  for (const name of CELL_NAMES_V4) anchors[name] = cellAnchor(cells.get(name)!)
  return { version: 'v4-hires', figureH, cells: anchors }
}

// Despeckle first: background noise islands would inflate the bbox and skew trim and height
// normalization. Quantize before scaling — nearest preserves quantized colours exactly.
export function processHiResCell(keyed: RawImage, targetFigureH?: number): RawImage {
  const cleaned = despeckle(keyed, Math.max(3, Math.ceil(opaqueArea(keyed) * 0.01)))
  const q = quantize(sweepMagenta(trimToFigure(cleaned)))
  return targetFigureH === undefined ? q : normalizeFigureHeight(q, targetFigureH)
}
