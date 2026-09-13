import type { RawImage } from '../post/raw.js'
import { opaqueArea, opaqueIslands } from '../sheet.js'

export function countIslands(img: RawImage): number {
  return [...opaqueIslands(img)].length
}

export function silhouetteStats(cell: RawImage): { islands: number; opaqueFrac: number } {
  return {
    islands: countIslands(cell),
    opaqueFrac: opaqueArea(cell) / (cell.width * cell.height),
  }
}

// Rank by silhouette cleanliness, lower is better. Pixel pitch cannot separate two candidates —
// `estimatePitch` pins to its range floor on these painterly generations — and islands can.
export function candidateRank(c: { islands: number; opaqueFrac: number }): number {
  return c.islands - c.opaqueFrac
}
