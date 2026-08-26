// A bilinear tap between two palette members returns a colour that is in neither, so a cell is
// authored at the size the deepest zoom stop draws it — scale exactly 1, nothing to interpolate.
import type { Footprint } from '@sj/shared'
import { MIN_DOWNSCALE_FACTOR } from './assetResolution.js'
import { quantize } from './post/quantize.js'
import { downscaleNearest, type RawImage } from './post/raw.js'
import { ART_MIN_ISLAND } from './library/postItem.js'
import { despeckle, erodeAlpha, opaqueArea, opaqueBbox, sweepMagenta } from './sheet.js'

// packages/web/src/render/scene.ts — ZOOM_MIN 1, ZOOM_MAX 4, integer stops.
export const BUILDING_ZOOM_STOP = 4
// packages/web/src/render/charAnim.ts — CHAR_TARGET_PX 52; characters.ts scales the whole
// cell by CHAR_TARGET_PX / figureH, so this height makes that scale 1/4 and the 4x stop 1:1.
export const CHAR_FIGURE_PX = 52 * BUILDING_ZOOM_STOP

// buildingArt fits the cell into 32*(w+h) world px. Times the deepest stop, that is the art
// size at which the close-up neither blends nor invents a pixel.
export function buildingCellPx(fp: Footprint): number {
  return 32 * (fp.w + fp.h) * BUILDING_ZOOM_STOP
}

export type ReCellPlan = {
  factor: number // whole-number division between the crop window and the cell
  window: number // side of the source crop, in (corrected) source pixels
  sourceScale: number // <= 1; the correction applied to the generation before the divide
  scaledSourcePx: number
}

// `figurePx` + `targetFigurePx` pin the figure to one height across generations of different sizes;
// the renderer applies a SINGLE figureH to all 24 cells, so without them the walk cycle pulses.
export function planReCell(a: {
  subjectPx: number
  cellPx: number
  sourcePx: number
  fill?: boolean
  figurePx?: number
  targetFigurePx?: number
}): ReCellPlan {
  const ceiling = Math.max(MIN_DOWNSCALE_FACTOR, Math.floor(a.sourcePx / a.cellPx))

  if (a.figurePx !== undefined && a.targetFigurePx !== undefined) {
    // The figure decides the factor: whichever whole divisor lands the figure nearest its target.
    // Raising it scales window and source together, so it can only fix a subject wider than tall.
    let factor = Math.max(MIN_DOWNSCALE_FACTOR, Math.round(a.figurePx / a.targetFigurePx))
    const fits = (f: number): boolean =>
      a.subjectPx * ((a.targetFigurePx! * f) / a.figurePx!) <= a.cellPx * f
    while (!fits(factor) && factor < ceiling) factor++
    const sourceScale = Math.min(1, (a.targetFigurePx * factor) / a.figurePx)
    return {
      factor,
      window: a.cellPx * factor,
      sourceScale,
      scaledSourcePx: Math.round(a.sourcePx * sourceScale),
    }
  }

  // `fill` takes the factor DOWN, so the window is smaller than the subject and the correction
  // closes the gap; without it a 866 px subject leaves 15% of a 4x window empty.
  const want =
    a.fill === true
      ? Math.max(MIN_DOWNSCALE_FACTOR, Math.floor(a.subjectPx / a.cellPx))
      : Math.max(MIN_DOWNSCALE_FACTOR, Math.ceil(a.subjectPx / a.cellPx))
  const factor = Math.min(ceiling, want)
  const window = a.cellPx * factor
  // The window overran the generation only because the subject is too big for it: shrink the
  // source until the subject fits. A correction throws information away; it never invents any.
  const sourceScale = a.subjectPx > window ? window / a.subjectPx : 1
  return { factor, window, sourceScale, scaledSourcePx: Math.round(a.sourcePx * sourceScale) }
}

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

export type ReCelled = { cell: RawImage; plan: ReCellPlan; figurePx: number }

// `keyed` is already chroma-keyed (the callers sweep the tolerance themselves, because a
// generation that drifted off #FF00FF needs 110 where a clean one needs 72).
export function reCell(
  keyed: RawImage,
  opts: {
    cellPx: number
    fill?: boolean
    targetFigurePx?: number
    figureAxis?: 'height' | 'width'
    anchor?: 'centre' | 'feet'
    erode?: number
  },
): ReCelled {
  const cleaned = despeckle(keyed, Math.max(3, Math.ceil(opaqueArea(keyed) * 0.01)))
  const b0 = opaqueBbox(cleaned)
  if (!b0) throw new Error('reCell: no opaque pixels')

  // Erode the chroma blend band before anything measures the figure, while the band is still a
  // known few source pixels wide: eroding after a correction eats real art.
  const banded = erodeAlpha(
    cleaned,
    opts.erode ??
      Math.min(4, Math.max(1, Math.floor(Math.min(b0.x1 - b0.x0 + 1, b0.y1 - b0.y0 + 1) / 4))),
  )
  const b = opaqueBbox(banded)
  if (!b) throw new Error('reCell: the chroma band erased the subject')
  const bw = b.x1 - b.x0 + 1,
    bh = b.y1 - b.y0 + 1

  const plan = planReCell({
    subjectPx: Math.max(bw, bh),
    cellPx: opts.cellPx,
    sourcePx: Math.min(cleaned.width, cleaned.height),
    ...(opts.fill === true ? { fill: true } : {}),
    ...(opts.targetFigurePx === undefined
      ? {}
      : {
          // a lying figure is measured along its body, which is its WIDTH
          figurePx: opts.figureAxis === 'width' ? bw : bh,
          targetFigurePx: opts.targetFigurePx,
        }),
  })

  const source =
    plan.sourceScale === 1
      ? banded
      : downscaleNearest(
          banded,
          Math.max(1, Math.round(banded.width * plan.sourceScale)),
          Math.max(1, Math.round(banded.height * plan.sourceScale)),
        )

  const sb = opaqueBbox(source)
  if (!sb) throw new Error('reCell: the source correction erased the subject')
  const sw = sb.x1 - sb.x0 + 1,
    sh = sb.y1 - sb.y0 + 1
  // Centre the window on the subject; a feet-anchored subject sits on the window's floor so a
  // standing figure keeps its headroom instead of losing its feet.
  const ox = Math.round(sb.x0 + sw / 2 - plan.window / 2)
  const oy =
    opts.anchor === 'feet'
      ? sb.y1 + 1 + Math.round((plan.window - sh) * 0.12) - plan.window
      : Math.round(sb.y0 + sh / 2 - plan.window / 2)

  const data = new Uint8ClampedArray(opts.cellPx * opts.cellPx * 4)
  for (let cy = 0; cy < opts.cellPx; cy++)
    for (let cx = 0; cx < opts.cellPx; cx++)
      data.set(
        blockSample(source, ox + cx * plan.factor, oy + cy * plan.factor, plan.factor),
        (cy * opts.cellPx + cx) * 4,
      )

  const cell = quantize(
    sweepMagenta(despeckle({ width: opts.cellPx, height: opts.cellPx, data }, ART_MIN_ISLAND)),
  )
  const cb = opaqueBbox(cell)
  return { cell, plan, figurePx: cb === null ? 0 : cb.y1 - cb.y0 + 1 }
}
