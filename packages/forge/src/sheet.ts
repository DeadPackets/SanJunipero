import type { RawImage } from './post/raw.js'

export const FACINGS = ['sw', 'se', 'ne', 'nw'] as const // sheet column order, left→right
export type Facing = typeof FACINGS[number]
export const POSES = ['idle', 'walk-a', 'walk-b'] as const // sheet row order, top→bottom
export type Pose = typeof POSES[number]

// Dimetric ¾-view clauses (NOT compass-orthographic):
export const FACING_CLAUSES: Record<Facing, string> = {
  sw: 'facing the viewer front-left: three-quarter front view, body and face turned toward the bottom-left of the frame',
  se: 'facing the viewer front-right: three-quarter front view, body and face turned toward the bottom-right of the frame',
  ne: 'seen from behind, three-quarter back view, body turned toward the top-right of the frame; back of the head visible, NO face visible',
  nw: 'seen from behind, three-quarter back view, body turned toward the top-left of the frame; back of the head visible, NO face visible',
}
export const POSE_CLAUSES: Record<Pose, string> = {
  'idle': 'standing at rest, both feet planted, arms relaxed at the sides',
  'walk-a': 'mid-stride walking pose, left foot forward and lifted, right arm swung forward',
  'walk-b': 'mid-stride walking pose, right foot forward and lifted, left arm swung forward',
}

// Provisional dupe thresholds — live scripts print full distance matrices for recalibration.
export const STRAIGHT_DUPE = 0.10
export const MIRROR_DUPE = 0.06

export function assembleGrid(cells: RawImage[][], cellW: number, cellH: number): RawImage {
  const rows = cells.length, cols = cells[0]?.length ?? 0
  const out = new Uint8ClampedArray(cols * cellW * rows * cellH * 4)
  const sheetW = cols * cellW
  for (let r = 0; r < rows; r++) {
    if (cells[r]!.length !== cols) throw new Error(`ragged grid: row ${r} has ${cells[r]!.length} cells, expected ${cols}`)
    for (let c = 0; c < cols; c++) {
      const cell = cells[r]![c]!
      if (cell.width !== cellW || cell.height !== cellH)
        throw new Error(`cell [${r}][${c}] is ${cell.width}x${cell.height}, expected ${cellW}x${cellH}`)
      for (let y = 0; y < cellH; y++) {
        const src = y * cellW * 4
        out.set(cell.data.subarray(src, src + cellW * 4), ((r * cellH + y) * sheetW + c * cellW) * 4)
      }
    }
  }
  return { width: sheetW, height: rows * cellH, data: out }
}

export function sliceGrid(img: RawImage, cols: number, rows: number): RawImage[][] {
  if (img.width % cols !== 0 || img.height % rows !== 0)
    throw new Error(`${img.width}x${img.height} does not divide into ${cols}x${rows} cells`)
  const cellW = img.width / cols, cellH = img.height / rows
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const data = new Uint8ClampedArray(cellW * cellH * 4)
      for (let y = 0; y < cellH; y++) {
        const src = ((r * cellH + y) * img.width + c * cellW) * 4
        data.set(img.data.subarray(src, src + cellW * 4), y * cellW * 4)
      }
      return { width: cellW, height: cellH, data }
    }))
}

export function mirrorX(img: RawImage): RawImage {
  const out = new Uint8ClampedArray(img.data.length)
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const s = (y * img.width + x) * 4, d = (y * img.width + (img.width - 1 - x)) * 4
    out[d] = img.data[s]!; out[d + 1] = img.data[s + 1]!; out[d + 2] = img.data[s + 2]!; out[d + 3] = img.data[s + 3]!
  }
  return { width: img.width, height: img.height, data: out }
}

// Mean per-channel-RGBA distance over pixels where EITHER image is opaque, normalized 0..1.
// Transparent-vs-opaque pixel counts as max distance for that pixel.
export function cellDistance(a: RawImage, b: RawImage): number {
  if (a.width !== b.width || a.height !== b.height)
    throw new Error(`size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`)
  let sum = 0, count = 0
  for (let i = 0; i < a.data.length; i += 4) {
    const aOn = a.data[i + 3]! > 0, bOn = b.data[i + 3]! > 0
    if (!aOn && !bOn) continue
    count++
    if (aOn !== bOn) { sum += 1; continue }
    sum += (Math.abs(a.data[i]! - b.data[i]!) + Math.abs(a.data[i + 1]! - b.data[i + 1]!)
      + Math.abs(a.data[i + 2]! - b.data[i + 2]!) + Math.abs(a.data[i + 3]! - b.data[i + 3]!)) / (4 * 255)
  }
  return count === 0 ? 0 : sum / count
}

export type DupeFinding = { a: string; b: string; distance: number; mirrored: boolean }

export function duplicateReport(cells: { label: string; img: RawImage }[],
  straightThreshold: number, mirrorThreshold: number): DupeFinding[] {
  const findings: DupeFinding[] = []
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
    const { label: a, img: ai } = cells[i]!, { label: b, img: bi } = cells[j]!
    const straight = cellDistance(ai, bi)
    if (straight < straightThreshold) { findings.push({ a, b, distance: straight, mirrored: false }); continue }
    const mirrored = cellDistance(ai, mirrorX(bi))
    if (mirrored < mirrorThreshold) findings.push({ a, b, distance: mirrored, mirrored: true })
  }
  return findings
}
