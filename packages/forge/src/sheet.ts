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

// Majority-vote reduction for big-pixel source art: each output pixel is the most
// frequent opaque RGBA in its source block (ties: first-seen); transparent iff >50%
// of the block is transparent. Robust to speckle noise, unlike point sampling.
export function downscaleMajority(img: RawImage, w: number, h: number): RawImage {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * img.height / h), y1 = Math.floor((y + 1) * img.height / h)
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * img.width / w), x1 = Math.floor((x + 1) * img.width / w)
      const counts = new Map<number, number>()
      let clear = 0, total = 0, best = -1, bestN = 0
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
        total++
        const i = (sy * img.width + sx) * 4
        if (img.data[i + 3]! === 0) { clear++; continue }
        const key = (img.data[i]! << 24 | img.data[i + 1]! << 16 | img.data[i + 2]! << 8 | img.data[i + 3]!) >>> 0
        const n = (counts.get(key) ?? 0) + 1
        counts.set(key, n)
        if (n > bestN) { bestN = n; best = key } // strict > keeps first-seen on ties
      }
      const d = (y * w + x) * 4
      if (clear * 2 > total || best < 0) continue // stays transparent
      out[d] = best >>> 24; out[d + 1] = (best >>> 16) & 255; out[d + 2] = (best >>> 8) & 255; out[d + 3] = best & 255
    }
  }
  return { width: w, height: h, data: out }
}

// Finds the art-pixel size of big-pixel source art: the block size whose
// majority-downscale -> integer-upscale round trip loses the least detail.
export function detectArtScale(img: RawImage, candidates: number[] = [4, 5, 6, 7, 8, 9, 10, 11, 12]): number {
  let best = candidates[0]!, bestErr = Infinity
  for (const k of candidates) {
    const w = Math.max(1, Math.round(img.width / k)), h = Math.max(1, Math.round(img.height / k))
    const down = downscaleMajority(img, w, h)
    const cw = Math.min(img.width, w * k), ch = Math.min(img.height, h * k)
    const a = crop(img, cw, ch), b = crop(upscaleInt(down, k), cw, ch)
    const err = cellDistance(a, b)
    if (err < bestErr) { bestErr = err; best = k }
  }
  return best
}

function crop(img: RawImage, w: number, h: number): RawImage {
  if (img.width === w && img.height === h) return img
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) data.set(img.data.subarray(y * img.width * 4, (y * img.width + w) * 4), y * w * 4)
  return { width: w, height: h, data }
}

function upscaleInt(img: RawImage, k: number): RawImage {
  const w = img.width * k, h = img.height * k
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4
    out.set(img.data.subarray(s, s + 4), (y * w + x) * 4)
  }
  return { width: w, height: h, data: out }
}

// Reduces big-pixel art to its native resolution (one output pixel per art pixel).
export function snapToGrid(img: RawImage): RawImage {
  const k = detectArtScale(img)
  return downscaleMajority(img, Math.max(1, Math.round(img.width / k)), Math.max(1, Math.round(img.height / k)))
}

// Places the sprite's opaque bounding box horizontally centered with its bottom row at feetY.
export function anchorToCanvas(img: RawImage, canvasW: number, canvasH: number, feetY: number): RawImage {
  let x0 = img.width, x1 = -1, y0 = img.height, y1 = -1
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++)
    if (img.data[(y * img.width + x) * 4 + 3]! > 0) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  if (x1 < 0) throw new Error('anchorToCanvas: sprite has no opaque pixels')
  const w = x1 - x0 + 1, h = y1 - y0 + 1
  const left = Math.floor((canvasW - w) / 2), top = feetY - h + 1
  if (w > canvasW || top < 0 || feetY >= canvasH)
    throw new Error(`anchorToCanvas: ${w}x${h} sprite exceeds ${canvasW}x${canvasH} canvas at feetY ${feetY}`)
  const out = new Uint8ClampedArray(canvasW * canvasH * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((y0 + y) * img.width + x0 + x) * 4
    out.set(img.data.subarray(s, s + 4), ((top + y) * canvasW + left + x) * 4)
  }
  return { width: canvasW, height: canvasH, data: out }
}

// Removes magenta chroma-key halos: an opaque edge pixel whose r AND b both exceed
// g by >40 takes the most frequent clean (non-contaminated) opaque neighbor color in
// its 3x3 window; with no clean neighbor it desaturates to r=b=(r+b)/2. Alpha untouched.
export function defringe(img: RawImage): RawImage {
  const out = new Uint8ClampedArray(img.data)
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= img.width || y >= img.height ? -1 : (y * img.width + x) * 4
  const contaminated = (i: number) =>
    img.data[i]! - img.data[i + 1]! > 40 && img.data[i + 2]! - img.data[i + 1]! > 40
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const i = at(x, y)!
    if (img.data[i + 3] === 0 || !contaminated(i)) continue
    let onEdge = false
    for (let dy = -1; dy <= 1 && !onEdge; dy++) for (let dx = -1; dx <= 1; dx++) {
      const n = at(x + dx, y + dy)
      if (n < 0 || img.data[n + 3] === 0) { onEdge = true; break }
    }
    if (!onEdge) continue
    const counts = new Map<number, number>()
    let best = -1, bestN = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const n = at(x + dx, y + dy)
      if (n < 0 || img.data[n + 3] === 0 || contaminated(n)) continue
      const key = (img.data[n]! << 16) | (img.data[n + 1]! << 8) | img.data[n + 2]!
      const c = (counts.get(key) ?? 0) + 1
      counts.set(key, c)
      if (c > bestN) { bestN = c; best = key }
    }
    if (best >= 0) { out[i] = best >> 16; out[i + 1] = (best >> 8) & 255; out[i + 2] = best & 255 }
    else { const m = Math.round((img.data[i]! + img.data[i + 2]!) / 2); out[i] = m; out[i + 2] = m }
  }
  return { width: img.width, height: img.height, data: out }
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
