// Two laws over one row of a walk cycle that the frame-to-frame gates cannot see: a figure that
// shrinks mid-stride (dilara's contact-b shipped 29 px short) and a front-facing frame drawn from
// behind (tariq's passing frame shipped hair only, no face). Both read committed cells, no model.
import { opaqueBbox } from './sheet.js'
import type { RawImage } from './post/raw.js'

export const WALK_CELLS = ['idle', 'contact-a', 'passing-a', 'contact-b', 'passing-b'] as const

/** Measured over sixteen shipped sheets: a healthy row spreads 5–15 px (a contact pose dips
 *  the figure a few pixels below its idle); the defect measured 29 and 34. */
export const WALK_HEIGHT_SPREAD_MAX = 18

/** A front-facing frame keeps at least this share of the row's fullest head. Healthy front
 *  rows measure 0.61 and up; the back of a head measured 0.35. */
export const HEAD_SKIN_SHARE_MIN = 0.5

// The palette's three skin tones; the fringe over a face is hair, and hair is none of these.
const SKIN: readonly [number, number, number][] = [
  [0xf5, 0xd3, 0xb3],
  [0xd9, 0xa8, 0x76],
  [0x9c, 0x6b, 0x47],
]
const SKIN_TOLERANCE = 60

const isSkin = (r: number, g: number, b: number): boolean =>
  SKIN.some(
    ([sr, sg, sb]) => Math.abs(r - sr) + Math.abs(g - sg) + Math.abs(b - sb) <= SKIN_TOLERANCE,
  )

export function figureHeight(img: RawImage): number {
  const b = opaqueBbox(img)
  return b === null ? 0 : b.y1 - b.y0 + 1
}

/** Skin pixels in the head band — the top third of the figure's own bounding box. */
export function headSkinPixels(img: RawImage): number {
  const b = opaqueBbox(img)
  if (b === null) return 0
  const band = Math.round((b.y1 - b.y0 + 1) / 3)
  let n = 0
  for (let y = b.y0; y < b.y0 + band; y++)
    for (let x = b.x0; x <= b.x1; x++) {
      const i = (y * img.width + x) * 4
      if (img.data[i + 3]! > 0 && isSkin(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!)) n++
    }
  return n
}

/** Opaque pixels the chroma key left behind. A shadow disc under the feet measured 1 250; the
 *  shipped sheets carry 0–7 such pixels along an outline, which is the key's edge, not a disc. */
export const MAGENTA_RESIDUE_MAX = 20

export function magentaResidue(img: RawImage): number {
  let n = 0
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3]! === 0) continue
    const r = img.data[i]!,
      g = img.data[i + 1]!,
      b = img.data[i + 2]!
    if (r > 140 && b > 140 && g < 0.6 * Math.min(r, b)) n++
  }
  return n
}

export type WalkRowFailure = {
  gate: 'walk-height' | 'head-skin'
  cell: string
  value: number
  limit: number
}

/** One row of a facing: the five walk cells by name. `frontFacing` turns the face law on. */
export function walkRowGate(
  cells: Readonly<Record<(typeof WALK_CELLS)[number], RawImage>>,
  frontFacing: boolean,
): WalkRowFailure[] {
  const out: WalkRowFailure[] = []
  const heights = WALK_CELLS.map((c) => figureHeight(cells[c]))
  const spread = Math.max(...heights) - Math.min(...heights)
  if (spread > WALK_HEIGHT_SPREAD_MAX) {
    const shortest = WALK_CELLS[heights.indexOf(Math.min(...heights))]!
    out.push({ gate: 'walk-height', cell: shortest, value: spread, limit: WALK_HEIGHT_SPREAD_MAX })
  }
  if (frontFacing) {
    const skin = WALK_CELLS.map((c) => headSkinPixels(cells[c]))
    const most = Math.max(...skin)
    if (most > 0)
      for (const [i, c] of WALK_CELLS.entries()) {
        const share = skin[i]! / most
        if (share < HEAD_SKIN_SHARE_MIN)
          out.push({ gate: 'head-skin', cell: c, value: share, limit: HEAD_SKIN_SHARE_MIN })
      }
  }
  return out
}
