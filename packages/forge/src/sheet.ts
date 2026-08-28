import type { RawImage } from './post/raw.js'

export const FACINGS = ['sw', 'se', 'ne', 'nw'] as const // sheet column order, left→right
export type Facing = (typeof FACINGS)[number]
export const POSES = ['idle', 'walk-a', 'walk-b'] as const // sheet row order, top→bottom
export type Pose = (typeof POSES)[number]

export function assembleGrid(cells: RawImage[][], cellW: number, cellH: number): RawImage {
  const rows = cells.length,
    cols = cells[0]?.length ?? 0
  const out = new Uint8ClampedArray(cols * cellW * rows * cellH * 4)
  const sheetW = cols * cellW
  for (let r = 0; r < rows; r++) {
    if (cells[r]!.length !== cols)
      throw new Error(`ragged grid: row ${r} has ${cells[r]!.length} cells, expected ${cols}`)
    for (let c = 0; c < cols; c++) {
      const cell = cells[r]![c]!
      if (cell.width !== cellW || cell.height !== cellH)
        throw new Error(
          `cell [${r}][${c}] is ${cell.width}x${cell.height}, expected ${cellW}x${cellH}`,
        )
      for (let y = 0; y < cellH; y++) {
        const src = y * cellW * 4
        out.set(
          cell.data.subarray(src, src + cellW * 4),
          ((r * cellH + y) * sheetW + c * cellW) * 4,
        )
      }
    }
  }
  return { width: sheetW, height: rows * cellH, data: out }
}

/** Box bounds for output index `i` of `n` over `src` sources, as a partition that is its OWN
 *  MIRROR — including the odd-`src`/even-`n` case, where the centre column votes in both boxes. */
function boxBounds(i: number, n: number, src: number): [number, number] {
  const at = (j: number) =>
    j * 2 <= n ? Math.round((j * src) / n) : src - Math.round(((n - j) * src) / n)
  let lo = at(i),
    hi = at(i + 1)
  if (n % 2 === 0 && src % 2 === 1) {
    if (i === n / 2 - 1) hi = (src + 1) / 2
    if (i === n / 2) lo = (src - 1) / 2
  }
  return [lo, hi]
}

// Majority-vote reduction for big-pixel art: each output pixel is the most frequent opaque RGBA in
// its block (ties: smallest RGBA, so order does not matter). Mirror-equivariant, see `boxBounds`.
export function downscaleMajority(img: RawImage, w: number, h: number): RawImage {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const [y0, y1] = boxBounds(y, h, img.height)
    for (let x = 0; x < w; x++) {
      const [x0, x1] = boxBounds(x, w, img.width)
      const counts = new Map<number, number>()
      let clear = 0,
        total = 0
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++) {
          total++
          const i = (sy * img.width + sx) * 4
          if (img.data[i + 3] === 0) {
            clear++
            continue
          }
          const key =
            ((img.data[i]! << 24) |
              (img.data[i + 1]! << 16) |
              (img.data[i + 2]! << 8) |
              img.data[i + 3]!) >>>
            0
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
      const d = (y * w + x) * 4
      if (clear * 2 > total || counts.size === 0) continue // stays transparent
      let best = -1,
        bestN = 0
      for (const [key, n] of counts)
        if (n > bestN || (n === bestN && key < best)) {
          bestN = n
          best = key
        }
      out[d] = best >>> 24
      out[d + 1] = (best >>> 16) & 255
      out[d + 2] = (best >>> 8) & 255
      out[d + 3] = best & 255
    }
  }
  return { width: w, height: h, data: out }
}

// Bounding box of all opaque pixels; null when the image has none.
export function opaqueBbox(
  img: RawImage,
): { x0: number; x1: number; y0: number; y1: number } | null {
  let x0 = img.width,
    x1 = -1,
    y0 = img.height,
    y1 = -1
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3]! > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  return x1 < 0 ? null : { x0, x1, y0, y1 }
}

// Places the sprite's opaque bounding box horizontally centered with its bottom row at feetY.
export function anchorToCanvas(
  img: RawImage,
  canvasW: number,
  canvasH: number,
  feetY: number,
): RawImage {
  const b = opaqueBbox(img)
  if (!b) throw new Error('anchorToCanvas: sprite has no opaque pixels')
  const { x0, y0 } = b
  const w = b.x1 - b.x0 + 1,
    h = b.y1 - b.y0 + 1
  const left = Math.floor((canvasW - w) / 2),
    top = feetY - h + 1
  if (w > canvasW || top < 0 || feetY >= canvasH)
    throw new Error(
      `anchorToCanvas: ${w}x${h} sprite exceeds ${canvasW}x${canvasH} canvas at feetY ${feetY}`,
    )
  const out = new Uint8ClampedArray(canvasW * canvasH * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * img.width + x0 + x) * 4
      out.set(img.data.subarray(s, s + 4), ((top + y) * canvasW + left + x) * 4)
    }
  return { width: canvasW, height: canvasH, data: out }
}

// Removes opaque pixels having any transparent 4-neighbor, once per radius iteration.
// Strips chroma-blended edge halos before resampling instead of recoloring them.
export function erodeAlpha(img: RawImage, radius = 1): RawImage {
  let cur = img.data
  for (let r = 0; r < radius; r++) {
    const next = new Uint8ClampedArray(cur)
    const alphaAt = (x: number, y: number) =>
      x < 0 || y < 0 || x >= img.width || y >= img.height ? 0 : cur[(y * img.width + x) * 4 + 3]!
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4
        if (cur[i + 3] === 0) continue
        if (
          alphaAt(x - 1, y) === 0 ||
          alphaAt(x + 1, y) === 0 ||
          alphaAt(x, y - 1) === 0 ||
          alphaAt(x, y + 1) === 0
        )
          next.fill(0, i, i + 4)
      }
    cur = next
  }
  return { width: img.width, height: img.height, data: cur }
}

// Fractional art pitch via gradient comb: per-column sums of |colour delta| over both-opaque
// neighbour pairs peak at lattice boundaries; the candidate whose comb catches the most wins.
export function estimatePitch(
  img: RawImage,
  range: [number, number] = [4, 12],
  step = 0.05,
): number {
  const colD = new Float64Array(img.width),
    rowD = new Float64Array(img.height)
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width - 1; x++) {
      const i = (y * img.width + x) * 4,
        j = i + 4
      if (img.data[i + 3] === 0 || img.data[j + 3] === 0) continue
      colD[x + 1]! +=
        Math.abs(img.data[i]! - img.data[j]!) +
        Math.abs(img.data[i + 1]! - img.data[j + 1]!) +
        Math.abs(img.data[i + 2]! - img.data[j + 2]!)
    }
  for (let y = 0; y < img.height - 1; y++)
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4,
        j = i + img.width * 4
      if (img.data[i + 3] === 0 || img.data[j + 3] === 0) continue
      rowD[y + 1]! +=
        Math.abs(img.data[i]! - img.data[j]!) +
        Math.abs(img.data[i + 1]! - img.data[j + 1]!) +
        Math.abs(img.data[i + 2]! - img.data[j + 2]!)
    }
  if (colD.reduce((a, v) => a + v, 0) === 0 && rowD.reduce((a, v) => a + v, 0) === 0)
    throw new Error('estimatePitch: no opaque neighbor pairs')
  // Octave-proof score = lift x coverage: a 2x octave keeps lift high by cherry-picking strong
  // boundaries but only reaches half of them, so the true pitch alone maximises the product.
  function combScore(D: Float64Array, p: number): number {
    let tot = 0
    for (const v of D) tot += v
    if (tot === 0) return 0
    const overallMean = tot / D.length
    let best = 0
    for (let phase = 0; phase < p; phase += 0.25) {
      let s = 0,
        n = 0
      for (let pos = phase; pos < D.length; pos += p) {
        s += D[Math.round(pos)] ?? 0
        n++
      }
      if (n <= 2) continue
      best = Math.max(best, (s / n / overallMean) * (s / tot))
    }
    return best
  }
  const score = (p: number) => combScore(colD, p) + combScore(rowD, p)
  let bestP = range[0],
    bestS = -1
  for (let p = range[0]; p <= range[1] + 1e-9; p += step) {
    const s = score(p)
    if (s > bestS) {
      bestS = s
      bestP = p
    }
  }
  // The comb score is a plateau around the true pitch (rounding absorbs small drift over
  // few lattice lines), so re-scan locally and return the plateau's midpoint.
  const fine: [number, number][] = []
  let fineMax = -1
  for (
    let p = Math.max(range[0], bestP - 0.6);
    p <= Math.min(range[1], bestP + 0.6) + 1e-9;
    p += 0.02
  ) {
    const s = score(p)
    fine.push([p, s])
    if (s > fineMax) fineMax = s
  }
  const argmax = fine.findIndex(([, s]) => s === fineMax)
  let lo = argmax,
    hi = argmax
  while (lo > 0 && fine[lo - 1]![1] >= 0.999 * fineMax) lo--
  while (hi < fine.length - 1 && fine[hi + 1]![1] >= 0.999 * fineMax) hi++
  return (fine[lo]![0] + fine[hi]![0]) / 2
}

// Magenta is not a Style Bible colour, so recolouring a magenta-ish survivor is safe at art scale.
export function sweepMagenta(img: RawImage): RawImage {
  const out = new Uint8ClampedArray(img.data)
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      if (img.data[i + 3] === 0) continue
      const r = img.data[i]!,
        g = img.data[i + 1]!,
        b = img.data[i + 2]!
      if (!(r > g + 40 && b > g + 25)) continue
      const counts = new Map<number, number>()
      let best = -1,
        bestN = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx,
            ny = y + dy
          if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue
          const n = (ny * img.width + nx) * 4
          if (img.data[n + 3] === 0) continue
          const key = (img.data[n]! << 16) | (img.data[n + 1]! << 8) | img.data[n + 2]!
          const c = (counts.get(key) ?? 0) + 1
          counts.set(key, c)
          if (c > bestN) {
            bestN = c
            best = key
          }
        }
      if (best < 0) continue
      out[i] = best >> 16
      out[i + 1] = (best >> 8) & 255
      out[i + 2] = best & 255
    }
  return { width: img.width, height: img.height, data: out }
}

// Removes opaque 4-connected islands smaller than minIsland pixels.
export function despeckle(img: RawImage, minIsland = 3): RawImage {
  const out = new Uint8ClampedArray(img.data)
  const seen = new Uint8Array(img.width * img.height)
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || img.data[start * 4 + 3] === 0) continue
    const stack = [start],
      island: number[] = []
    seen[start] = 1
    while (stack.length) {
      const p = stack.pop()!
      island.push(p)
      const x = p % img.width,
        y = (p / img.width) | 0
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue
        const n = ny * img.width + nx
        if (!seen[n] && img.data[n * 4 + 3]! > 0) {
          seen[n] = 1
          stack.push(n)
        }
      }
    }
    if (island.length < minIsland) for (const p of island) out.fill(0, p * 4, p * 4 + 4)
  }
  return { width: img.width, height: img.height, data: out }
}

export function mirrorX(img: RawImage): RawImage {
  const out = new Uint8ClampedArray(img.data.length)
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4,
        d = (y * img.width + (img.width - 1 - x)) * 4
      out[d] = img.data[s]!
      out[d + 1] = img.data[s + 1]!
      out[d + 2] = img.data[s + 2]!
      out[d + 3] = img.data[s + 3]!
    }
  return { width: img.width, height: img.height, data: out }
}

// Mean per-channel-RGBA distance over pixels where EITHER image is opaque, normalized 0..1.
// Transparent-vs-opaque pixel counts as max distance for that pixel.
export function cellDistance(a: RawImage, b: RawImage): number {
  if (a.width !== b.width || a.height !== b.height)
    throw new Error(`size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`)
  let sum = 0,
    count = 0
  for (let i = 0; i < a.data.length; i += 4) {
    const aOn = a.data[i + 3]! > 0,
      bOn = b.data[i + 3]! > 0
    if (!aOn && !bOn) continue
    count++
    if (aOn !== bOn) {
      sum += 1
      continue
    }
    sum +=
      (Math.abs(a.data[i]! - b.data[i]!) +
        Math.abs(a.data[i + 1]! - b.data[i + 1]!) +
        Math.abs(a.data[i + 2]! - b.data[i + 2]!) +
        Math.abs(a.data[i + 3]! - b.data[i + 3]!)) /
      (4 * 255)
  }
  return count === 0 ? 0 : sum / count
}

// Median of all pairwise cellDistances (upper-median for even pair counts).
export function pairwiseMedian(imgs: RawImage[]): number {
  const ds: number[] = []
  for (let i = 0; i < imgs.length; i++)
    for (let j = i + 1; j < imgs.length; j++) ds.push(cellDistance(imgs[i]!, imgs[j]!))
  ds.sort((a, b) => a - b)
  return ds[Math.floor(ds.length / 2)]!
}

// ───────────────────────── Character asset standard v2 ─────────────────────────
// idle and the 4 walk phases generate as one 1×5 horizontal phase strip per facing; sleep is its
// own single-cell call per facing.

export const POSES_V2 = [
  'idle',
  'contact-a',
  'passing-a',
  'contact-b',
  'passing-b',
  'sleep',
] as const // sheet row order, top→bottom
export type PoseV2 = (typeof POSES_V2)[number]
export const WALK_POSES_V2 = ['contact-a', 'passing-a', 'contact-b', 'passing-b'] as const // renderer loop order, 8fps
export const CELL_V2 = 96
export const FEET_Y_V2 = 88
export const SHEET_W_V2 = CELL_V2 * FACINGS.length // 384
export const SHEET_H_V2 = CELL_V2 * POSES_V2.length // 576
export const STRIP_POSES_V2 = ['idle', 'contact-a', 'passing-a', 'contact-b', 'passing-b'] as const // 1×5 strip order
// Ratios are ×(pairwise median) of the sheet's cells, calibrated against the rejected v1 sheet:
// NEAR_DUPE catches the ne/nw back-view dupe, MIRROR_DUPE the sw/se mirror, STRIDE the rigid se.
export const NEAR_DUPE_RATIO = 0.55
export const MIRROR_DUPE_RATIO = 0.35
export const STRIDE_MIN_RATIO = 0.35
export const CONTACT_PASSING_MIN_RATIO = 0.25
export const SILHOUETTE_AREA_TOL = 0.18

// `limit` IS THE BOUND THE VALUE CROSSED, NOT THE TOLERANCE: silhouette is the one gate whose
// value is a RATIO around 1 while its tolerance is a half-width, so reporting 0.18 overstates it.
export const silhouetteBound = (areaRatio: number): number =>
  areaRatio > 1 ? 1 + SILHOUETTE_AREA_TOL : 1 - SILHOUETTE_AREA_TOL
export const HEAD_REGION_FRAC = 0.4
export const HEAD_DIFF_MAX = 0.2 // v1 legit frames measure ≤0.123; sw~se cross-facing measures 0.269

export type GateFailure = {
  gate:
    | 'near-dupe'
    | 'mirror-dupe'
    | 'stride'
    | 'contact-passing'
    | 'silhouette'
    | 'head'
    | 'lying'
    | 'lying-axis'
    | 'stance'
  a: string
  b: string
  value: number
  limit: number
}

// A contact frame is a STANCE: `strideGateV4` asks whether two frames DIFFER, and a body standing
// still differs from itself. Feet, not arms — the bottom quarter of the bbox, on the NATIVE cell.
export const STANCE_FRAC = 0.25
// The eye-refused standing candidates top out at 1.018 and the narrowest accepted stride is 1.206;
// 1.10 sits inside that gap. Passing frames overlap the contact band, so only contacts are asked.
export const STANCE_MIN_RATIO = 1.1

/** Width of the opaque mass in the bottom `frac` of the figure's bbox — the feet. */
export function footSpan(img: RawImage, frac = STANCE_FRAC): number {
  const b = opaqueBbox(img)
  if (!b) throw new Error('footSpan: sprite has no opaque pixels')
  const y0 = b.y1 - Math.max(0, Math.ceil((b.y1 - b.y0 + 1) * frac) - 1)
  let x0 = img.width,
    x1 = -1
  for (let y = y0; y <= b.y1; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3]! > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
      }
  return x1 < 0 ? 0 : x1 - x0 + 1
}

const SPECKLE_MIN_SHARE = 0.01 // a column run under 1% of the opaque pixels is speckle, not a figure
// Slices a 1×n phase strip by clustering opaque columns, dropping speckle runs and merging the
// smallest gaps down to n. Robust to uneven spacing — it NEVER assumes equal fifths.
export function sliceStrip(img: RawImage, n = 5): RawImage[] {
  const colMass = new Array<number>(img.width).fill(0)
  let total = 0
  for (let x = 0; x < img.width; x++)
    for (let y = 0; y < img.height; y++)
      if (img.data[(y * img.width + x) * 4 + 3]! > 0) {
        colMass[x]!++
        total++
      }
  if (total === 0) throw new Error('sliceStrip: no opaque pixels')
  type Run = { x0: number; x1: number; mass: number }
  const runs: Run[] = []
  for (let x = 0; x < img.width; x++) {
    if (colMass[x] === 0) continue
    if (runs.length && runs[runs.length - 1]!.x1 === x - 1) {
      runs[runs.length - 1]!.x1 = x
      runs[runs.length - 1]!.mass += colMass[x]!
    } else runs.push({ x0: x, x1: x, mass: colMass[x]! })
  }
  const solid = runs.filter((r) => r.mass >= SPECKLE_MIN_SHARE * total)
  if (solid.length < n)
    throw new Error(`sliceStrip: found ${solid.length} figure clusters, need ${n}`)
  while (solid.length > n) {
    let k = 0,
      gap = Infinity
    for (let i = 0; i < solid.length - 1; i++) {
      const g = solid[i + 1]!.x0 - solid[i]!.x1
      if (g < gap) {
        gap = g
        k = i
      }
    }
    solid[k]!.x1 = solid[k + 1]!.x1
    solid[k]!.mass += solid[k + 1]!.mass
    solid.splice(k + 1, 1)
  }
  return solid.map((r) => {
    const w = r.x1 - r.x0 + 1
    const data = new Uint8ClampedArray(w * img.height * 4)
    for (let y = 0; y < img.height; y++)
      data.set(
        img.data.subarray((y * img.width + r.x0) * 4, (y * img.width + r.x1 + 1) * 4),
        y * w * 4,
      )
    return { width: w, height: img.height, data }
  })
}

export function opaqueArea(img: RawImage): number {
  let count = 0
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i]! > 0) count++
  return count
}

// Opaque-mask disagreement over the top `frac` of each bbox. Centres align in HALF pixels: two
// bboxes of different width parity sit half a column apart, which no integer offset can express.
export function headRegionDiff(a: RawImage, b: RawImage, frac = HEAD_REGION_FRAC): number {
  const prep = (img: RawImage) => {
    const bb = opaqueBbox(img)
    if (!bb) throw new Error('headRegionDiff: no opaque pixels')
    return {
      img,
      bb,
      w: bb.x1 - bb.x0 + 1,
      rows: Math.max(1, Math.ceil((bb.y1 - bb.y0 + 1) * frac)),
    }
  }
  const A = prep(a),
    B = prep(b)
  const w = Math.max(A.w, B.w),
    h = Math.max(A.rows, B.rows)
  const on = (c: typeof A, u: number, y: number) => {
    if (y >= c.rows) return false
    const su = u - (w - c.w) // half-pixel column, inside this bbox
    if (su < 0 || su >= 2 * c.w) return false
    return c.img.data[((c.bb.y0 + y) * c.img.width + c.bb.x0 + (su >> 1)) * 4 + 3]! > 0
  }
  let diff = 0,
    union = 0
  for (let y = 0; y < h; y++)
    for (let u = 0; u < 2 * w; u++) {
      const pa = on(A, u, y),
        pb = on(B, u, y)
      if (pa || pb) union++
      if (pa !== pb) diff++
    }
  return union === 0 ? 0 : diff / union
}

// Every pair FAILS hard when the straight or mirrored distance falls under its ratio of the
// median — a failure, not a flag: a failed strip regenerates and a still-failing sheet is BLOCKED.
export function crossFacingDupeGate(
  cells: { label: string; img: RawImage }[],
  median: number,
): GateFailure[] {
  const failures: GateFailure[] = []
  for (let i = 0; i < cells.length; i++)
    for (let j = i + 1; j < cells.length; j++) {
      const { label: a, img: ai } = cells[i]!,
        { label: b, img: bi } = cells[j]!
      const straight = cellDistance(ai, bi)
      if (straight < NEAR_DUPE_RATIO * median) {
        failures.push({ gate: 'near-dupe', a, b, value: straight, limit: NEAR_DUPE_RATIO * median })
        continue
      }
      const mirrored = cellDistance(ai, mirrorX(bi))
      if (mirrored < MIRROR_DUPE_RATIO * median)
        failures.push({
          gate: 'mirror-dupe',
          a,
          b,
          value: mirrored,
          limit: MIRROR_DUPE_RATIO * median,
        })
    }
  return failures
}

// Every frame must agree with the facing's idle on silhouette area ±18% and head-region
// stability: independent per-frame generation drifts costume details.
export function frameCoherenceGate(
  facing: string,
  idle: RawImage,
  frames: { label: string; img: RawImage }[],
): GateFailure[] {
  const failures: GateFailure[] = []
  const idleLabel = `${facing}/idle`,
    idleArea = opaqueArea(idle)
  for (const { label, img } of frames) {
    const a = `${facing}/${label}`
    const areaRatio = opaqueArea(img) / idleArea
    if (Math.abs(areaRatio - 1) > SILHOUETTE_AREA_TOL)
      failures.push({
        gate: 'silhouette',
        a,
        b: idleLabel,
        value: areaRatio,
        limit: silhouetteBound(areaRatio),
      })
    const head = headRegionDiff(idle, img)
    if (head > HEAD_DIFF_MAX)
      failures.push({ gate: 'head', a, b: idleLabel, value: head, limit: HEAD_DIFF_MAX })
  }
  return failures
}
