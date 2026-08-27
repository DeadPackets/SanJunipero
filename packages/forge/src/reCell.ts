// A bilinear tap between two palette members returns a colour that is in neither, so a cell is
// authored at the size the deepest zoom stop draws it — scale exactly 1, nothing to interpolate.
import type { Footprint } from '@sj/shared'
import type { RawImage } from './post/raw.js'
import { erodeAlpha, opaqueBbox } from './sheet.js'

// packages/web/src/render/camera.ts — zoom stops [0.25, 0.5, 1, 2, 3, 4]; 4 is the deepest.
export const BUILDING_ZOOM_STOP = 4
// packages/web/src/render/charAnim.ts — CHAR_TARGET_PX 52; characters.ts scales the whole
// cell by CHAR_TARGET_PX / figureH, so this height makes that scale 1/4 and the 4x stop 1:1.
export const CHAR_FIGURE_PX = 52 * BUILDING_ZOOM_STOP
// The cell canvas: 208 px of figure needs headroom for hair and a lying pose's length.
export const CHAR_CELL_PX = 256

// The chroma blend band is this many source pixels wide whatever the art pitch is.
const CHROMA_BAND_PX = 4

// buildingArt fits the cell into 32*(w+h) world px. Times the deepest stop, that is the art
// size at which the close-up neither blends nor invents a pixel.
export function buildingCellPx(fp: Footprint): number {
  return 32 * (fp.w + fp.h) * BUILDING_ZOOM_STOP
}

export type SpritePlan = {
  factor: number // whole-number division between the crop window and the cell
  window: number // side of the source crop, in generation pixels
  ox: number
  oy: number
  subjectPx: number
}

export type SpriteCelled = { cell: RawImage; plan: SpritePlan }

// A block is opaque only when at least half of it is, which keeps alpha binary; the MEDIAN colour
// survives the generation's JPEG ringing where a point sample would ship it.
function blockSample(
  img: RawImage,
  x0: number,
  y0: number,
  f: number,
): [number, number, number, number] {
  const rs: number[] = [],
    gs: number[] = [],
    bs: number[] = []
  for (let y = y0; y < y0 + f; y++) {
    if (y < 0 || y >= img.height) continue
    for (let x = x0; x < x0 + f; x++) {
      if (x < 0 || x >= img.width) continue
      const i = (y * img.width + x) * 4
      if (img.data[i + 3]! < 128) continue
      rs.push(img.data[i]!)
      gs.push(img.data[i + 1]!)
      bs.push(img.data[i + 2]!)
    }
  }
  if (rs.length * 2 < f * f) return [0, 0, 0, 0]
  const mid = (v: number[]): number => v.sort((x, y) => x - y)[v.length >> 1]!
  return [mid(rs), mid(gs), mid(bs), 255]
}

// `keyed` is already chroma-keyed (the callers sweep the tolerance themselves, because a
// generation that drifted off #FF00FF needs 110 where a clean one needs 72).
// The factor is WHOLE and the source is never resampled: a subject too big for one factor takes
// the next one up and sits smaller in its window rather than being scaled or clipped.
export function spriteCell(
  keyed: RawImage,
  opts: { cellPx: number; anchor: 'feet' | 'centre' },
): SpriteCelled {
  const banded = erodeAlpha(keyed, CHROMA_BAND_PX)
  const b = opaqueBbox(banded)
  if (!b) throw new Error('spriteCell: the chroma band erased the subject')
  const bw = b.x1 - b.x0 + 1,
    bh = b.y1 - b.y0 + 1

  const subjectPx = Math.max(bw, bh)
  const factor = Math.max(1, Math.ceil(subjectPx / opts.cellPx))
  const window = opts.cellPx * factor
  const ox = Math.round(b.x0 + bw / 2 - window / 2)
  // Feet: the subject's last row is the window's last row, so a standing figure keeps its
  // headroom instead of losing its feet.
  const oy = opts.anchor === 'feet' ? b.y1 + 1 - window : Math.round(b.y0 + bh / 2 - window / 2)

  const data = new Uint8ClampedArray(opts.cellPx * opts.cellPx * 4)
  for (let cy = 0; cy < opts.cellPx; cy++)
    for (let cx = 0; cx < opts.cellPx; cx++)
      data.set(
        blockSample(banded, ox + cx * factor, oy + cy * factor, factor),
        (cy * opts.cellPx + cx) * 4,
      )

  return {
    cell: { width: opts.cellPx, height: opts.cellPx, data },
    plan: { factor, window, ox, oy, subjectPx },
  }
}
