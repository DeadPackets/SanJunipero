import type { RawImage } from './post/raw.js'
import type { Rgb } from './palette.js'

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

// DEPRECATED for sprite post-processing (pipeline v3): the round-trip metric is
// degenerate — smaller blocks always fit better on non-lattice art, so it oversamples
// the true pitch. Use resampleToArtHeight instead. Kept for grid-true inputs.
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

// DEPRECATED for sprite post-processing (pipeline v3) — see detectArtScale note.
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

// Removes chroma-key halos (magenta -> maroon family): an opaque edge pixel matching
// the contamination predicate takes the most frequent clean opaque neighbor color in
// its 3x3 window; with no clean neighbor it desaturates to r=b=(r+b)/2. Alpha untouched.
export function defringe(img: RawImage): RawImage {
  const out = new Uint8ClampedArray(img.data)
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= img.width || y >= img.height ? -1 : (y * img.width + x) * 4
  const contaminated = (i: number) => {
    const r = img.data[i]!, g = img.data[i + 1]!, b = img.data[i + 2]!
    return (r > g + 30 && b > g + 15) || r > g + 50 || (b > g + 25 && r > g + 10)
  }
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

// Removes opaque pixels having any transparent 4-neighbor, once per radius iteration.
// Strips chroma-blended edge halos before resampling instead of recoloring them.
export function erodeAlpha(img: RawImage, radius = 1): RawImage {
  let cur = img.data
  for (let r = 0; r < radius; r++) {
    const next = new Uint8ClampedArray(cur)
    const alphaAt = (x: number, y: number) =>
      x < 0 || y < 0 || x >= img.width || y >= img.height ? 0 : cur[(y * img.width + x) * 4 + 3]!
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      if (cur[i + 3] === 0) continue
      if (alphaAt(x - 1, y) === 0 || alphaAt(x + 1, y) === 0 || alphaAt(x, y - 1) === 0 || alphaAt(x, y + 1) === 0)
        next.fill(0, i, i + 4)
    }
    cur = next
  }
  return { width: img.width, height: img.height, data: cur }
}

// Pitch-derived erosion (controller-approved): radius = max(1, round(sourcePitch/2))
// with sourcePitch = opaque bboxH / targetH, measured BEFORE erosion — the chroma blend
// band scales with the art pitch, so the erosion must too.
export function erodeForPitch(img: RawImage, targetH: number): RawImage {
  let y0 = img.height, y1 = -1
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++)
    if (img.data[(y * img.width + x) * 4 + 3]! > 0) {
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  if (y1 < 0) throw new Error('erodeForPitch: no opaque pixels')
  return erodeAlpha(img, Math.max(1, Math.round((y1 - y0 + 1) / targetH / 2)))
}

// Resamples big-pixel art to its true art pitch: lattice of pitch = bboxH/targetH,
// phased at the bbox bottom-center; per cell, channel-wise MEDIAN of opaque pixels in
// the central 1/3 x 1/3 (fallback: whole cell); opaque iff >=50% of the region is opaque.
export function resampleToArtHeight(img: RawImage, targetH: number): RawImage {
  let x0 = img.width, x1 = -1, y0 = img.height, y1 = -1
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++)
    if (img.data[(y * img.width + x) * 4 + 3]! > 0) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  if (x1 < 0) throw new Error('resampleToArtHeight: no opaque pixels')
  const bboxW = x1 - x0 + 1, bboxH = y1 - y0 + 1
  const pitch = bboxH / targetH
  const outW = Math.max(1, Math.round(bboxW / pitch))
  const yBottom = y1 + 1, cx = x0 + bboxW / 2
  const out = new Uint8ClampedArray(outW * targetH * 4)

  function sample(xLo: number, xHi: number, yLo: number, yHi: number) {
    const rs: number[] = [], gs: number[] = [], bs: number[] = []
    let total = 0
    for (let y = Math.max(0, Math.floor(yLo)); y < Math.min(img.height, Math.ceil(yHi)); y++) {
      if (y + 0.5 < yLo || y + 0.5 >= yHi) continue
      for (let x = Math.max(0, Math.floor(xLo)); x < Math.min(img.width, Math.ceil(xHi)); x++) {
        if (x + 0.5 < xLo || x + 0.5 >= xHi) continue
        total++
        const i = (y * img.width + x) * 4
        if (img.data[i + 3] === 0) continue
        rs.push(img.data[i]!); gs.push(img.data[i + 1]!); bs.push(img.data[i + 2]!)
      }
    }
    return { total, rs, gs, bs }
  }
  const median = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)]!

  for (let j = 0; j < targetH; j++) {
    const yLo = yBottom - (targetH - j) * pitch, yHi = yBottom - (targetH - 1 - j) * pitch
    for (let i = 0; i < outW; i++) {
      const xLo = cx + (i - outW / 2) * pitch, xHi = cx + (i + 1 - outW / 2) * pitch
      const third = (hi: number, lo: number) => (hi - lo) / 3
      let s = sample(xLo + third(xHi, xLo), xHi - third(xHi, xLo), yLo + third(yHi, yLo), yHi - third(yHi, yLo))
      if (s.total === 0) s = sample(xLo, xHi, yLo, yHi)
      if (s.total === 0 || s.rs.length === 0 || s.rs.length * 2 < s.total) continue
      const d = (j * outW + i) * 4
      out[d] = median(s.rs); out[d + 1] = median(s.gs); out[d + 2] = median(s.bs); out[d + 3] = 255
    }
  }
  return { width: outW, height: targetH, data: out }
}

// Fractional art pitch via gradient comb: per-column/-row sums of |color delta| over
// both-opaque neighbor pairs peak at lattice boundaries; the candidate pitch whose comb
// (best phase) catches the highest mean profile value wins. Octave guard: the smallest
// pitch within 97% of the best score is preferred (2x the true pitch scores as high).
export function estimatePitch(img: RawImage, range: [number, number] = [4, 12], step = 0.05): number {
  const colD = new Float64Array(img.width), rowD = new Float64Array(img.height)
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width - 1; x++) {
    const i = (y * img.width + x) * 4, j = i + 4
    if (img.data[i + 3] === 0 || img.data[j + 3] === 0) continue
    colD[x + 1]! += Math.abs(img.data[i]! - img.data[j]!) + Math.abs(img.data[i + 1]! - img.data[j + 1]!) + Math.abs(img.data[i + 2]! - img.data[j + 2]!)
  }
  for (let y = 0; y < img.height - 1; y++) for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 4, j = i + img.width * 4
    if (img.data[i + 3] === 0 || img.data[j + 3] === 0) continue
    rowD[y + 1]! += Math.abs(img.data[i]! - img.data[j]!) + Math.abs(img.data[i + 1]! - img.data[j + 1]!) + Math.abs(img.data[i + 2]! - img.data[j + 2]!)
  }
  // Octave-proof score = lift x coverage. lift = how concentrated the profile is at
  // lattice lines (mean-at-lattice / overall mean; a 2x octave keeps this high by
  // cherry-picking strong boundaries, a 1/2 pitch dilutes it with mid-block zeros).
  // coverage = fraction of total gradient energy the comb captures (a 2x octave only
  // reaches half the boundaries). The true pitch alone maximizes the product.
  function combScore(D: Float64Array, p: number): number {
    let tot = 0
    for (const v of D) tot += v
    if (tot === 0) return 0
    const overallMean = tot / D.length
    let best = 0
    for (let phase = 0; phase < p; phase += 0.25) {
      let s = 0, n = 0
      for (let pos = phase; pos < D.length; pos += p) { s += D[Math.round(pos)] ?? 0; n++ }
      if (n <= 2) continue
      best = Math.max(best, (s / n / overallMean) * (s / tot))
    }
    return best
  }
  const score = (p: number) => combScore(colD, p) + combScore(rowD, p)
  let bestP = range[0], bestS = -1
  for (let p = range[0]; p <= range[1] + 1e-9; p += step) {
    const s = score(p)
    if (s > bestS) { bestS = s; bestP = p }
  }
  // The comb score is a plateau around the true pitch (rounding absorbs small drift over
  // few lattice lines), so re-scan locally and return the plateau's midpoint.
  const fine: [number, number][] = []
  let fineMax = -1
  for (let p = Math.max(range[0], bestP - 0.6); p <= Math.min(range[1], bestP + 0.6) + 1e-9; p += 0.02) {
    const s = score(p)
    fine.push([p, s])
    if (s > fineMax) fineMax = s
  }
  const argmax = fine.findIndex(([, s]) => s === fineMax)
  let lo = argmax, hi = argmax
  while (lo > 0 && fine[lo - 1]![1] >= 0.999 * fineMax) lo--
  while (hi < fine.length - 1 && fine[hi + 1]![1] >= 0.999 * fineMax) hi++
  return (fine[lo]![0] + fine[hi]![0]) / 2
}

export type Lattice = { px: number; py: number; ox: number; oy: number }

// Coordinate descent (±pitch/4, halving over 3 rounds) on {ox, oy, px, py}, minimizing
// mean within-cell color variance over interior cells (fully inside the bbox, ≥60% opaque).
export function refineLattice(img: RawImage, pitch: number, phase0: { ox: number; oy: number } = { ox: 0, oy: 0 }): Lattice {
  let bx0 = img.width, bx1 = -1, by0 = img.height, by1 = -1
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++)
    if (img.data[(y * img.width + x) * 4 + 3]! > 0) {
      if (x < bx0) bx0 = x
      if (x > bx1) bx1 = x
      if (y < by0) by0 = y
      if (y > by1) by1 = y
    }
  if (bx1 < 0) throw new Error('refineLattice: no opaque pixels')

  function cost(l: Lattice, stride = 1): number {
    if (l.px < 2 || l.py < 2) return Infinity
    let total = 0, cells = 0
    const i0 = Math.floor((bx0 - l.ox) / l.px), i1 = Math.floor((bx1 - l.ox) / l.px)
    const j0 = Math.floor((by0 - l.oy) / l.py), j1 = Math.floor((by1 - l.oy) / l.py)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const xLo = l.ox + i * l.px, xHi = xLo + l.px, yLo = l.oy + j * l.py, yHi = yLo + l.py
      if (xLo < bx0 || xHi > bx1 + 1 || yLo < by0 || yHi > by1 + 1) continue
      let n = 0, area = 0
      let sr = 0, sg = 0, sb = 0, qr = 0, qg = 0, qb = 0
      for (let y = Math.ceil(yLo - 0.5); y + 0.5 < yHi; y += stride) for (let x = Math.ceil(xLo - 0.5); x + 0.5 < xHi; x += stride) {
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
        area++
        const s = (y * img.width + x) * 4
        if (img.data[s + 3] === 0) continue
        const r = img.data[s]!, g = img.data[s + 1]!, b = img.data[s + 2]!
        n++; sr += r; sg += g; sb += b; qr += r * r; qg += g * g; qb += b * b
      }
      if (area === 0 || n < 4 || n < 0.6 * area) continue
      total += (qr / n - (sr / n) ** 2) + (qg / n - (sg / n) ** 2) + (qb / n - (sb / n) ** 2)
      cells++
    }
    return cells ? total / cells : Infinity
  }

  // px/py stay within ±pitch/4 of the estimate: the variance objective is degenerate
  // toward tiny cells, so refinement corrects, never re-decides, the pitch.
  const clamp = (v: number) => Math.min(pitch * 1.25, Math.max(pitch * 0.75, v))
  let lat: Lattice = { px: pitch, py: pitch, ox: phase0.ox, oy: phase0.oy }
  let best = cost(lat)
  let step = pitch / 4
  for (let round = 0; round < 3; round++) {
    for (let pass = 0; pass < 2; pass++) {
      for (const key of ['ox', 'oy', 'px', 'py'] as const) {
        let improved = true
        while (improved) {
          improved = false
          for (const d of [step, -step, step / 2, -step / 2]) {
            let v = lat[key] + d
            if (key === 'px' || key === 'py') v = clamp(v)
            if (v === lat[key]) continue
            const cand = { ...lat, [key]: v }
            const c = cost(cand)
            if (c < best) { lat = cand; best = c; improved = true }
          }
        }
      }
    }
    step /= 2
  }
  // Joint pitch x phase polish per axis: pitch and phase sit in a coupled valley that
  // per-coordinate moves cannot cross (a wrong pitch relocates the optimal phase).
  // Scan (p, φ) jointly on a subsampled cost, then confirm at full resolution.
  for (const axis of ['y', 'x'] as const) {
    const pKey = axis === 'x' ? 'px' : 'py', oKey = axis === 'x' ? 'ox' : 'oy'
    let bestPair = { p: lat[pKey], o: lat[oKey] }
    let bestC = cost(lat, 2)
    for (let p = pitch * 0.85; p <= pitch * 1.15 + 1e-9; p += 0.05) {
      for (let o = lat[oKey] - p / 2; o <= lat[oKey] + p / 2 + 1e-9; o += 0.1) {
        const c = cost({ ...lat, [pKey]: p, [oKey]: o }, 2)
        if (c < bestC) { bestC = c; bestPair = { p, o } }
      }
    }
    const cand = { ...lat, [pKey]: bestPair.p, [oKey]: bestPair.o }
    if (cost(cand) < cost(lat)) lat = cand
  }
  return lat
}

// Mode-color resample on an explicit lattice: per cell, bin the central-60% opaque pixels
// at 5 bits/channel, output the densest bin's mean color; if dominance < 40%, retry with
// the window nudged ±pitch/4 in each axis direction and keep the most dominant result.
// dominance[] parallels out (0 for transparent); origin maps lattice indices to out pixels.
export function resampleModeLattice(img: RawImage, lat: Lattice):
  { out: RawImage; dominance: Float32Array; origin: { i0: number; j0: number } } {
  let bx0 = img.width, bx1 = -1, by0 = img.height, by1 = -1
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++)
    if (img.data[(y * img.width + x) * 4 + 3]! > 0) {
      if (x < bx0) bx0 = x
      if (x > bx1) bx1 = x
      if (y < by0) by0 = y
      if (y > by1) by1 = y
    }
  if (bx1 < 0) throw new Error('resampleModeLattice: no opaque pixels')
  const i0 = Math.floor((bx0 - lat.ox) / lat.px), i1 = Math.floor((bx1 - lat.ox) / lat.px)
  const j0 = Math.floor((by0 - lat.oy) / lat.py), j1 = Math.floor((by1 - lat.oy) / lat.py)
  const outW = i1 - i0 + 1, outH = j1 - j0 + 1
  const out = new Uint8ClampedArray(outW * outH * 4)
  const dominance = new Float32Array(outW * outH)

  function sampleWindow(xLo: number, xHi: number, yLo: number, yHi: number) {
    let total = 0, opaque = 0
    const bins = new Map<number, { n: number; sr: number; sg: number; sb: number }>()
    let bestKey = -1, bestN = 0
    for (let y = Math.max(0, Math.floor(yLo)); y < Math.min(img.height, Math.ceil(yHi)); y++) {
      if (y + 0.5 < yLo || y + 0.5 >= yHi) continue
      for (let x = Math.max(0, Math.floor(xLo)); x < Math.min(img.width, Math.ceil(xHi)); x++) {
        if (x + 0.5 < xLo || x + 0.5 >= xHi) continue
        total++
        const s = (y * img.width + x) * 4
        if (img.data[s + 3] === 0) continue
        opaque++
        const r = img.data[s]!, g = img.data[s + 1]!, b = img.data[s + 2]!
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
        let bin = bins.get(key)
        if (!bin) { bin = { n: 0, sr: 0, sg: 0, sb: 0 }; bins.set(key, bin) }
        bin.n++; bin.sr += r; bin.sg += g; bin.sb += b
        if (bin.n > bestN) { bestN = bin.n; bestKey = key }
      }
    }
    if (opaque === 0 || bestKey < 0) return { total, opaque, dom: 0, color: null as null | [number, number, number] }
    const bin = bins.get(bestKey)!
    return {
      total, opaque, dom: bin.n / opaque,
      color: [Math.round(bin.sr / bin.n), Math.round(bin.sg / bin.n), Math.round(bin.sb / bin.n)] as [number, number, number],
    }
  }

  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const cxLo = lat.ox + i * lat.px, cyLo = lat.oy + j * lat.py
    const mx = 0.2 * lat.px, my = 0.2 * lat.py
    let s = sampleWindow(cxLo + mx, cxLo + lat.px - mx, cyLo + my, cyLo + lat.py - my)
    if (s.color && s.dom < 0.4) {
      for (const [dx, dy] of [[lat.px / 4, 0], [-lat.px / 4, 0], [0, lat.py / 4], [0, -lat.py / 4]] as const) {
        const alt = sampleWindow(cxLo + mx + dx, cxLo + lat.px - mx + dx, cyLo + my + dy, cyLo + lat.py - my + dy)
        if (alt.color && alt.dom > s.dom) s = alt
      }
    }
    if (!s.color || s.opaque * 2 < s.total) continue
    const d = ((j - j0) * outW + (i - i0)) * 4
    out[d] = s.color[0]; out[d + 1] = s.color[1]; out[d + 2] = s.color[2]; out[d + 3] = 255
    dominance[(j - j0) * outW + (i - i0)] = s.dom
  }
  return { out: { width: outW, height: outH, data: out }, dominance, origin: { i0, j0 } }
}

// Jumble metrics: ambiguousPct = % of opaque output pixels sampled at <50% dominance;
// dupRowCount = adjacent byte-identical opaque rows; reconErr = mean per-channel distance
// between each opaque source pixel and its lattice cell's output color (both-opaque only).
export function sheetMetrics(cells: {
  out: RawImage; dominance: Float32Array; eroded: RawImage; lat: Lattice; origin: { i0: number; j0: number }
}[]): { ambiguousPct: number; dupRowCount: number; reconErr: number } {
  let opaque = 0, ambiguous = 0, dupRows = 0, reconSum = 0, reconN = 0
  for (const c of cells) {
    for (let i = 0; i < c.out.width * c.out.height; i++)
      if (c.out.data[i * 4 + 3]! > 0) { opaque++; if (c.dominance[i]! < 0.5) ambiguous++ }
    for (let y = 0; y < c.out.height - 1; y++) {
      const rowLen = c.out.width * 4
      const a = c.out.data.subarray(y * rowLen, (y + 1) * rowLen)
      const b = c.out.data.subarray((y + 1) * rowLen, (y + 2) * rowLen)
      let same = true, any = false
      for (let k = 0; k < rowLen; k++) if (a[k] !== b[k]) { same = false; break }
      for (let k = 3; k < rowLen; k += 4) if (a[k]! > 0) { any = true; break }
      if (same && any) dupRows++
    }
    for (let y = 0; y < c.eroded.height; y++) for (let x = 0; x < c.eroded.width; x++) {
      const s = (y * c.eroded.width + x) * 4
      if (c.eroded.data[s + 3] === 0) continue
      const i = Math.floor((x - c.lat.ox) / c.lat.px) - c.origin.i0
      const j = Math.floor((y - c.lat.oy) / c.lat.py) - c.origin.j0
      if (i < 0 || j < 0 || i >= c.out.width || j >= c.out.height) continue
      const d = (j * c.out.width + i) * 4
      if (c.out.data[d + 3] === 0) continue
      reconSum += (Math.abs(c.eroded.data[s]! - c.out.data[d]!) + Math.abs(c.eroded.data[s + 1]! - c.out.data[d + 1]!)
        + Math.abs(c.eroded.data[s + 2]! - c.out.data[d + 2]!)) / (3 * 255)
      reconN++
    }
  }
  return {
    ambiguousPct: opaque ? (100 * ambiguous) / opaque : 0,
    dupRowCount: dupRows,
    reconErr: reconN ? reconSum / reconN : 0,
  }
}

// Modal detected art scale across a set of images; ties break to the smallest scale.
export function sheetScale(imgs: RawImage[]): number {
  const counts = new Map<number, number>()
  for (const img of imgs) {
    const k = detectArtScale(img)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let best = -1, bestN = 0
  for (const [k, n] of [...counts].sort((a, b) => a[0] - b[0]))
    if (n > bestN) { bestN = n; best = k }
  return best
}

// Horizontal-only registration: the dx (|dx| <= maxShift) that minimizes opaque-mask
// mismatch when img is shifted by dx onto ref. Ties prefer the smallest |dx|.
export function registerToReference(ref: RawImage, img: RawImage, maxShift = 8): { dx: number } {
  if (ref.width !== img.width || ref.height !== img.height)
    throw new Error(`size mismatch: ${ref.width}x${ref.height} vs ${img.width}x${img.height}`)
  const opaque = (im: RawImage, x: number, y: number) =>
    x >= 0 && x < im.width && im.data[(y * im.width + x) * 4 + 3]! > 0
  let best = 0, bestErr = Infinity
  for (let a = 0; a <= maxShift; a++) for (const dx of a === 0 ? [0] : [-a, a]) {
    let err = 0
    for (let y = 0; y < ref.height; y++) for (let x = 0; x < ref.width; x++)
      if (opaque(ref, x, y) !== opaque(img, x - dx, y)) err++
    if (err < bestErr) { bestErr = err; best = dx }
  }
  return { dx: best }
}

// Removes opaque 4-connected islands smaller than minIsland pixels.
export function despeckle(img: RawImage, minIsland = 3): RawImage {
  const out = new Uint8ClampedArray(img.data)
  const seen = new Uint8Array(img.width * img.height)
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || img.data[start * 4 + 3] === 0) continue
    const stack = [start], island: number[] = []
    seen[start] = 1
    while (stack.length) {
      const p = stack.pop()!
      island.push(p)
      const x = p % img.width, y = (p / img.width) | 0
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue
        const n = ny * img.width + nx
        if (!seen[n] && img.data[n * 4 + 3]! > 0) { seen[n] = 1; stack.push(n) }
      }
    }
    if (island.length < minIsland) for (const p of island) out.fill(0, p * 4, p * 4 + 4)
  }
  return { width: img.width, height: img.height, data: out }
}

// Fills transparent 4-connected islands of <= maxHole pixels that are fully enclosed
// by opaque pixels (never touching the border), using the most frequent adjacent color.
export function fillPinholes(img: RawImage, maxHole = 2): RawImage {
  const out = new Uint8ClampedArray(img.data)
  const seen = new Uint8Array(img.width * img.height)
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || img.data[start * 4 + 3]! > 0) continue
    const stack = [start], hole: number[] = []
    let touchesBorder = false
    seen[start] = 1
    while (stack.length) {
      const p = stack.pop()!
      hole.push(p)
      const x = p % img.width, y = (p / img.width) | 0
      if (x === 0 || y === 0 || x === img.width - 1 || y === img.height - 1) touchesBorder = true
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue
        const n = ny * img.width + nx
        if (!seen[n] && img.data[n * 4 + 3] === 0) { seen[n] = 1; stack.push(n) }
      }
    }
    if (touchesBorder || hole.length > maxHole) continue
    for (const p of hole) {
      const x = p % img.width, y = (p / img.width) | 0
      const counts = new Map<number, number>()
      let best = -1, bestN = 0
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        const n = (ny * img.width + nx) * 4
        if (img.data[n + 3] === 0) continue
        const key = (img.data[n]! << 16) | (img.data[n + 1]! << 8) | img.data[n + 2]!
        const c = (counts.get(key) ?? 0) + 1
        counts.set(key, c)
        if (c > bestN) { bestN = c; best = key }
      }
      if (best < 0) continue
      const i = p * 4
      out[i] = best >> 16; out[i + 1] = (best >> 8) & 255; out[i + 2] = best & 255; out[i + 3] = 255
    }
  }
  return { width: img.width, height: img.height, data: out }
}

// Frequency-ranked union of exact opaque colors across images, capped at k.
export function unionPalette(imgs: RawImage[], k = 48): Rgb[] {
  const counts = new Map<number, number>()
  for (const img of imgs) for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue
    const key = (img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, k)
    .map(([c]) => [c >> 16, (c >> 8) & 255, c & 255] as Rgb)
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
