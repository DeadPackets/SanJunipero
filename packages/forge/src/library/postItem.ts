import type { RawImage } from '../post/raw.js'
import { opaqueArea } from '../sheet.js'

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
      const x = p % img.width,
        y = (p / img.width) | 0
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue
        const q = ny * img.width + nx
        if (!seen[q] && img.data[q * 4 + 3]! > 0) {
          seen[q] = 1
          stack.push(q)
        }
      }
    }
  }
  return n
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
