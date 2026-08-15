import { decodePng, type RawImage } from './post/raw.js'
import { chromaKey } from './post/chromaKey.js'
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
    const a = crop(img, cw, ch), b = crop(upscaleNearest(down, k), cw, ch)
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

export function upscaleNearest(img: RawImage, k: number): RawImage {
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

// Bounding box of all opaque pixels; null when the image has none.
export function opaqueBbox(img: RawImage): { x0: number; x1: number; y0: number; y1: number } | null {
  let x0 = img.width, x1 = -1, y0 = img.height, y1 = -1
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++)
    if (img.data[(y * img.width + x) * 4 + 3]! > 0) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  return x1 < 0 ? null : { x0, x1, y0, y1 }
}

// Places the sprite's opaque bounding box horizontally centered with its bottom row at feetY.
export function anchorToCanvas(img: RawImage, canvasW: number, canvasH: number, feetY: number): RawImage {
  const b = opaqueBbox(img)
  if (!b) throw new Error('anchorToCanvas: sprite has no opaque pixels')
  const { x0, y0 } = b
  const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1
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
  const b = opaqueBbox(img)
  if (!b) throw new Error('erodeForPitch: no opaque pixels')
  return erodeAlpha(img, Math.max(1, Math.round((b.y1 - b.y0 + 1) / targetH / 2)))
}

// Resamples big-pixel art to its true art pitch: lattice of pitch = bboxH/targetH,
// phased at the bbox bottom-center; per cell, channel-wise MEDIAN of opaque pixels in
// the central 1/3 x 1/3 (fallback: whole cell); opaque iff >=50% of the region is opaque.
export function resampleToArtHeight(img: RawImage, targetH: number): RawImage {
  const b = opaqueBbox(img)
  if (!b) throw new Error('resampleToArtHeight: no opaque pixels')
  const { x0, y1 } = b
  const bboxW = b.x1 - b.x0 + 1, bboxH = b.y1 - b.y0 + 1
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
// (best phase) catches the highest mean profile value wins.
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
  if (colD.reduce((a, v) => a + v, 0) === 0 && rowD.reduce((a, v) => a + v, 0) === 0)
    throw new Error('estimatePitch: no opaque neighbor pairs')
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
  const bb = opaqueBbox(img)
  if (!bb) throw new Error('refineLattice: no opaque pixels')
  const { x0: bx0, x1: bx1, y0: by0, y1: by1 } = bb

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
// DEPRECATED for sprite pipelines (v5): 5-bit bins split ε-close colors and the per-cell
// nudge is superseded by driftField — use resampleClusterLattice. Kept for metrics.
// When a drift field is passed, windows follow it and the nudge is disabled.
export function resampleModeLattice(img: RawImage, lat: Lattice, drift?: { rowOffsets: number[]; colOffsets: number[] }):
  { out: RawImage; dominance: Float32Array; origin: { i0: number; j0: number } } {
  const bb = opaqueBbox(img)
  if (!bb) throw new Error('resampleModeLattice: no opaque pixels')
  const { x0: bx0, x1: bx1, y0: by0, y1: by1 } = bb
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
    const ddx = drift?.colOffsets[i - i0] ?? 0, ddy = drift?.rowOffsets[j - j0] ?? 0
    const cxLo = lat.ox + i * lat.px + ddx, cyLo = lat.oy + j * lat.py + ddy
    const mx = 0.2 * lat.px, my = 0.2 * lat.py
    let s = sampleWindow(cxLo + mx, cxLo + lat.px - mx, cyLo + my, cyLo + lat.py - my)
    if (!drift && s.color && s.dom < 0.4) {
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

type Drift = { rowOffsets: number[]; colOffsets: number[] }

// ε-cluster of RGB samples via single-linkage union-find (per-channel distance ≤ eps).
// Returns the dominant cluster's fraction and its mean color.
function clusterDominant(px: [number, number, number][], eps = 8):
  { dom: number; color: [number, number, number] } | null {
  const n = px.length
  if (n === 0) return null
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (Math.abs(px[i]![0] - px[j]![0]) <= eps && Math.abs(px[i]![1] - px[j]![1]) <= eps && Math.abs(px[i]![2] - px[j]![2]) <= eps) {
      const a = find(i), b = find(j)
      if (a !== b) parent[a] = b
    }
  }
  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const g = groups.get(r)
    if (g) g.push(i)
    else groups.set(r, [i])
  }
  let best: number[] = []
  for (const g of groups.values()) if (g.length > best.length) best = g
  let sr = 0, sg = 0, sb = 0
  for (const i of best) { sr += px[i]![0]; sg += px[i]![1]; sb += px[i]![2] }
  return {
    dom: best.length / n,
    color: [Math.round(sr / best.length), Math.round(sg / best.length), Math.round(sb / best.length)],
  }
}

// DEPRECATED (v6 ruling): regressed reconErr on all real material — the recovered
// offsets were sprite-edge jitter, not drift; refineLattice already captures the lattice.
// Smooth lattice deformation: per art-row (and per art-column) integer offsets in
// [-2, 2] maximizing summed full-cell ε-cluster dominance across the band, solved by
// DP with |Δoffset| ≤ 1 between neighbors and a 0.5/px jump penalty. Full-cell windows
// (no margin) so a 1px misalignment already dents dominance.
export function driftField(img: RawImage, pitch: number, phase: { ox: number; oy: number }): Drift {
  const bb = opaqueBbox(img)
  if (!bb) throw new Error('driftField: no opaque pixels')
  const { x0: bx0, x1: bx1, y0: by0, y1: by1 } = bb

  function windowPixels(xLo: number, xHi: number, yLo: number, yHi: number): { total: number; px: [number, number, number][] } {
    const px: [number, number, number][] = []
    let total = 0
    for (let y = Math.max(0, Math.floor(yLo)); y < Math.min(img.height, Math.ceil(yHi)); y++) {
      if (y + 0.5 < yLo || y + 0.5 >= yHi) continue
      for (let x = Math.max(0, Math.floor(xLo)); x < Math.min(img.width, Math.ceil(xHi)); x++) {
        if (x + 0.5 < xLo || x + 0.5 >= xHi) continue
        total++
        const s = (y * img.width + x) * 4
        if (img.data[s + 3] === 0) continue
        px.push([img.data[s]!, img.data[s + 1]!, img.data[s + 2]!])
      }
    }
    return { total, px }
  }

  function solve(axis: 'row' | 'col'): number[] {
    const [o, p, lo, hi, crossLo, crossHi] = axis === 'row'
      ? [phase.oy, pitch, by0, by1, bx0, bx1] : [phase.ox, pitch, bx0, bx1, by0, by1]
    const j0 = Math.floor((lo - o) / p), j1 = Math.floor((hi - o) / p)
    const nBands = j1 - j0 + 1
    const c0 = Math.floor((crossLo - (axis === 'row' ? phase.ox : phase.oy)) / pitch)
    const c1 = Math.floor((crossHi - (axis === 'row' ? phase.ox : phase.oy)) / pitch)
    const DELTAS = [-2, -1, 0, 1, 2]
    const score: number[][] = []
    for (let b = 0; b < nBands; b++) {
      const row: number[] = []
      for (const d of DELTAS) {
        let s = 0
        for (let c = c0; c <= c1; c++) {
          const bandLo = o + (j0 + b) * p + d, bandHi = bandLo + p
          const crossStart = (axis === 'row' ? phase.ox : phase.oy) + c * pitch
          const w = axis === 'row'
            ? windowPixels(crossStart, crossStart + pitch, bandLo, bandHi)
            : windowPixels(bandLo, bandHi, crossStart, crossStart + pitch)
          if (w.total === 0 || w.px.length * 2 < w.total) continue
          const cl = clusterDominant(w.px)
          if (cl) s += cl.dom
        }
        row.push(s)
      }
      score.push(row)
    }
    // DP over offsets, |Δ| ≤ 1, penalty 0.5/px; ties prefer smaller |δ|
    const best: number[][] = [score[0]!.slice()]
    const from: number[][] = [DELTAS.map((_, k) => k)]
    for (let b = 1; b < nBands; b++) {
      const row: number[] = [], src: number[] = []
      for (let k = 0; k < DELTAS.length; k++) {
        let bv = -Infinity, bs = k
        for (let k2 = Math.max(0, k - 1); k2 <= Math.min(DELTAS.length - 1, k + 1); k2++) {
          const v = best[b - 1]![k2]! - 0.5 * Math.abs(DELTAS[k]! - DELTAS[k2]!)
          if (v > bv || (v === bv && Math.abs(DELTAS[k2]!) < Math.abs(DELTAS[bs]!))) { bv = v; bs = k2 }
        }
        row.push(bv + score[b]![k]!)
        src.push(bs)
      }
      best.push(row)
      from.push(src)
    }
    let k = 0
    for (let i = 1; i < DELTAS.length; i++) {
      const b = best[nBands - 1]!
      if (b[i]! > b[k]! || (b[i]! === b[k]! && Math.abs(DELTAS[i]!) < Math.abs(DELTAS[k]!))) k = i
    }
    const out = new Array<number>(nBands)
    for (let b = nBands - 1; b >= 0; b--) { out[b] = DELTAS[k]!; k = from[b]![k]! }
    return out
  }
  return { rowOffsets: solve('row'), colOffsets: solve('col') }
}

// ε-cluster resample (pipeline v5): like resampleModeLattice but the dominant color
// comes from single-linkage ε-clustering (≤8/channel) instead of 5-bit bins, and an
// optional drift field shifts each cell's sample window instead of per-cell nudging.
export function resampleClusterLattice(img: RawImage, lat: Lattice, drift?: Drift):
  { out: RawImage; dominance: Float32Array; origin: { i0: number; j0: number } } {
  const bb = opaqueBbox(img)
  if (!bb) throw new Error('resampleClusterLattice: no opaque pixels')
  const { x0: bx0, x1: bx1, y0: by0, y1: by1 } = bb
  const i0 = Math.floor((bx0 - lat.ox) / lat.px), i1 = Math.floor((bx1 - lat.ox) / lat.px)
  const j0 = Math.floor((by0 - lat.oy) / lat.py), j1 = Math.floor((by1 - lat.oy) / lat.py)
  const outW = i1 - i0 + 1, outH = j1 - j0 + 1
  const out = new Uint8ClampedArray(outW * outH * 4)
  const dominance = new Float32Array(outW * outH)
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const dx = drift?.colOffsets[i - i0] ?? 0, dy = drift?.rowOffsets[j - j0] ?? 0
    const xLo = lat.ox + i * lat.px + 0.2 * lat.px + dx, xHi = lat.ox + (i + 1) * lat.px - 0.2 * lat.px + dx
    const yLo = lat.oy + j * lat.py + 0.2 * lat.py + dy, yHi = lat.oy + (j + 1) * lat.py - 0.2 * lat.py + dy
    let total = 0
    const px: [number, number, number][] = []
    for (let y = Math.max(0, Math.floor(yLo)); y < Math.min(img.height, Math.ceil(yHi)); y++) {
      if (y + 0.5 < yLo || y + 0.5 >= yHi) continue
      for (let x = Math.max(0, Math.floor(xLo)); x < Math.min(img.width, Math.ceil(xHi)); x++) {
        if (x + 0.5 < xLo || x + 0.5 >= xHi) continue
        total++
        const s = (y * img.width + x) * 4
        if (img.data[s + 3] === 0) continue
        px.push([img.data[s]!, img.data[s + 1]!, img.data[s + 2]!])
      }
    }
    if (total === 0 || px.length === 0 || px.length * 2 < total) continue
    const cl = clusterDominant(px)
    if (!cl) continue
    const d = ((j - j0) * outW + (i - i0)) * 4
    out[d] = cl.color[0]; out[d + 1] = cl.color[1]; out[d + 2] = cl.color[2]; out[d + 3] = 255
    dominance[(j - j0) * outW + (i - i0)] = cl.dom
  }
  return { out: { width: outW, height: outH, data: out }, dominance, origin: { i0, j0 } }
}

// DEPRECATED (v6 ruling): single-linkage chaining collapses natural palettes (Δ2-5 color
// chains fuse across the gamut — the cottage roof merged into brown). Do not use blind.
// Sheet-wide near-duplicate color merge: union-find over every output color across the
// images (per-channel ≤ eps), each replaced by its cluster's population-weighted centroid.
export function mergeSheetColors(imgs: RawImage[], eps = 6): RawImage[] {
  const counts = new Map<number, number>()
  for (const img of imgs) for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue
    const key = (img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const colors = [...counts.keys()]
  const parent = colors.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  const ch = (c: number) => [c >> 16, (c >> 8) & 255, c & 255] as const
  for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) {
    const a = ch(colors[i]!), b = ch(colors[j]!)
    if (Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps) {
      const ra = find(i), rb = find(j)
      if (ra !== rb) parent[ra] = rb
    }
  }
  const acc = new Map<number, { n: number; r: number; g: number; b: number }>()
  colors.forEach((c, i) => {
    const root = find(i), n = counts.get(c)!, [r, g, b] = ch(c)
    const a = acc.get(root) ?? { n: 0, r: 0, g: 0, b: 0 }
    a.n += n; a.r += r * n; a.g += g * n; a.b += b * n
    acc.set(root, a)
  })
  const remap = new Map<number, [number, number, number]>()
  colors.forEach((c, i) => {
    const a = acc.get(find(i))!
    remap.set(c, [Math.round(a.r / a.n), Math.round(a.g / a.n), Math.round(a.b / a.n)])
  })
  return imgs.map(img => {
    const data = new Uint8ClampedArray(img.data)
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue
      const m = remap.get((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!)!
      data[i] = m[0]; data[i + 1] = m[1]; data[i + 2] = m[2]
    }
    return { width: img.width, height: img.height, data }
  })
}

// Census-aware sweep: a predicate-matching color is contamination only if RARE
// (count < max(2, 0.5% of opaque)) — frequent matchers are palette (wine outline).
export function sweepMagentaCensus(img: RawImage): RawImage {
  const out = new Uint8ClampedArray(img.data)
  const counts = new Map<number, number>()
  let opaque = 0
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue
    opaque++
    const key = (img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const threshold = Math.max(2, 0.005 * opaque)
  const contaminated = new Set<number>()
  for (const [key, n] of counts) {
    const r = key >> 16, g = (key >> 8) & 255, b = key & 255
    if (r > g + 40 && b > g + 25 && n < threshold) contaminated.add(key)
  }
  if (contaminated.size === 0) return { width: img.width, height: img.height, data: out }
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 4
    if (img.data[i + 3] === 0) continue
    const key = (img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!
    if (!contaminated.has(key)) continue
    const nb = new Map<number, number>()
    let best = -1, bestN = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue
      const n = (ny * img.width + nx) * 4
      if (img.data[n + 3] === 0) continue
      const nk = (img.data[n]! << 16) | (img.data[n + 1]! << 8) | img.data[n + 2]!
      if (contaminated.has(nk)) continue
      const c = (nb.get(nk) ?? 0) + 1
      nb.set(nk, c)
      if (c > bestN) { bestN = c; best = nk }
    }
    if (best < 0) continue
    out[i] = best >> 16; out[i + 1] = (best >> 8) & 255; out[i + 2] = best & 255
  }
  return { width: img.width, height: img.height, data: out }
}

// Outline↔fill blend repair (pipeline v7, two-sided snap): silhouette pixels whose
// color sits on the RGB segment between their inward fill color and the outline
// palette are generation blends; authored pixel art has no fractional-membership
// pixels, so each commits to its majority side — t >= 0.4 snaps to the nearest
// outline color, t in [0.15, 0.4) snaps to the fill color (no line-weight change,
// no new colors), t < 0.15 is already fill-committed within noise and stays.
// OOB counts as transparent because inputs are bbox-tight on a clear canvas.
export function repairOutlineBlends(img: RawImage):
  { out: RawImage; repainted: number; outlineSnaps: number; fillSnaps: number } {
  const EPS = 10, SEG_DIST = 12, OUTLINE_T = 0.4, FILL_T = 0.15
  const w = img.width, h = img.height, data = img.data
  const out = new Uint8ClampedArray(data)
  const opaque = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3]! > 0

  // (a) silhouette: opaque with >= 1 transparent 8-neighbor (covers diagonal-only
  // inner corners, so the (d) corner case is a subset of this set)
  const silhouette = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!opaque(x, y)) continue
    outer: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx !== 0 || dy !== 0) && !opaque(x + dx, y + dy)) { silhouette[y * w + x] = 1; break outer }
    }
  }

  // (b) outline palette: eps single-link clusters over silhouette colors; keep
  // clusters >= 15% of silhouette population within luma 30 of the darkest such cluster
  const counts = new Map<number, number>()
  let silTotal = 0
  for (let i = 0; i < w * h; i++) {
    if (!silhouette[i]) continue
    silTotal++
    const s = i * 4
    const key = (data[s]! << 16) | (data[s + 1]! << 8) | data[s + 2]!
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  if (silTotal === 0) return { out: { width: w, height: h, data: out }, repainted: 0, outlineSnaps: 0, fillSnaps: 0 }
  const keys = [...counts.keys()]
  const ch = (c: number) => [c >> 16, (c >> 8) & 255, c & 255] as const
  const parent = keys.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = ch(keys[i]!), b = ch(keys[j]!)
    if (Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS && Math.abs(a[2] - b[2]) <= EPS) {
      const ra = find(i), rb = find(j)
      if (ra !== rb) parent[ra] = rb
    }
  }
  const clusters = new Map<number, { n: number; r: number; g: number; b: number }>()
  keys.forEach((k, i) => {
    const root = find(i), n = counts.get(k)!, [r, g, b] = ch(k)
    const a = clusters.get(root) ?? { n: 0, r: 0, g: 0, b: 0 }
    a.n += n; a.r += r * n; a.g += g * n; a.b += b * n
    clusters.set(root, a)
  })
  const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b
  const eligible = [...clusters.entries()]
    .filter(([, a]) => a.n >= 0.15 * silTotal)
    .map(([root, a]) => ({ root, luma: luma(a.r / a.n, a.g / a.n, a.b / a.n) }))
  if (eligible.length === 0) return { out: { width: w, height: h, data: out }, repainted: 0, outlineSnaps: 0, fillSnaps: 0 }
  const darkest = Math.min(...eligible.map(e => e.luma))
  const outlineRoots = new Set(eligible.filter(e => e.luma <= darkest + 30).map(e => e.root))
  const members: [number, number, number][] = []
  keys.forEach((k, i) => { if (outlineRoots.has(find(i))) members.push([...ch(k)]) })

  const nearAny = (r: number, g: number, b: number, set: [number, number, number][]) =>
    set.some(m => Math.abs(m[0] - r) <= EPS && Math.abs(m[1] - g) <= EPS && Math.abs(m[2] - b) <= EPS)

  // inward fill color: mode of opaque non-silhouette 8-neighbors, else the nearest
  // opaque non-silhouette pixel within Chebyshev radius 4 (mode among distance ties)
  function fillColorFor(x: number, y: number): [number, number, number] | null {
    for (let r = 1; r <= 4; r++) {
      const cand: { color: [number, number, number]; d2: number }[] = []
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const nx = x + dx, ny = y + dy
        if (!opaque(nx, ny) || silhouette[ny * w + nx]) continue
        const s = (ny * w + nx) * 4
        cand.push({ color: [data[s]!, data[s + 1]!, data[s + 2]!], d2: dx * dx + dy * dy })
      }
      if (cand.length === 0) continue
      const dMin = Math.min(...cand.map(c => c.d2))
      const modes = new Map<number, number>()
      let best = -1, bestN = 0
      for (const c of cand) {
        if (c.d2 !== dMin) continue
        const key = (c.color[0] << 16) | (c.color[1] << 8) | c.color[2]
        const n = (modes.get(key) ?? 0) + 1
        modes.set(key, n)
        if (n > bestN) { bestN = n; best = key }
      }
      return [...ch(best)]
    }
    return null
  }

  function segProj(c: readonly number[], a: readonly number[], b: readonly number[]): { d: number; t: number } {
    const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
    const ac = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]
    const len2 = ab[0]! * ab[0]! + ab[1]! * ab[1]! + ab[2]! * ab[2]!
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (ac[0]! * ab[0]! + ac[1]! * ab[1]! + ac[2]! * ab[2]!) / len2))
    return { d: Math.hypot(a[0]! + t * ab[0]! - c[0]!, a[1]! + t * ab[1]! - c[1]!, a[2]! + t * ab[2]! - c[2]!), t }
  }

  // (c)+(d): segment test on every silhouette pixel that is neither outline nor fill
  let outlineSnaps = 0, fillSnaps = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!silhouette[y * w + x]) continue
    const s = (y * w + x) * 4
    const c = [data[s]!, data[s + 1]!, data[s + 2]!] as const
    if (nearAny(c[0], c[1], c[2], members)) continue
    const fill = fillColorFor(x, y)
    if (!fill) continue
    if (nearAny(c[0], c[1], c[2], [fill])) continue
    let o = members[0]!, oD = Infinity
    for (const m of members) {
      const d = (m[0] - c[0]) ** 2 + (m[1] - c[1]) ** 2 + (m[2] - c[2]) ** 2
      if (d < oD) { oD = d; o = m }
    }
    const { d, t } = segProj(c, fill, o)
    if (d > SEG_DIST || t < FILL_T) continue
    const target = t >= OUTLINE_T ? o : fill
    if (t >= OUTLINE_T) outlineSnaps++
    else fillSnaps++
    out[s] = target[0]!; out[s + 1] = target[1]!; out[s + 2] = target[2]!
  }
  return { out: { width: w, height: h, data: out }, repainted: outlineSnaps + fillSnaps, outlineSnaps, fillSnaps }
}

// Pipeline v7 stage chain on a chroma-keyed input: erode(round(pitch/2)) →
// refineLattice → resampleClusterLattice → despeckle → fillPinholes →
// sweepMagentaCensus (`before`, the v6 output) → repairOutlineBlends (`out`).
// exclBefore/exclAfter are reconErr with the repainted pixels alpha'd out of BOTH
// outputs (the exclusion gate); exclDelta = exclAfter - exclBefore.
export function v7Chain(keyed: RawImage, pitch: number): {
  out: RawImage; before: RawImage; dominance: Float32Array; eroded: RawImage; lat: Lattice
  origin: { i0: number; j0: number }; despeckleRemoved: number; sweepHits: number
  repainted: number; outlineSnaps: number; fillSnaps: number
  exclBefore: number; exclAfter: number; exclDelta: number
} {
  const eroded = erodeAlpha(keyed, Math.max(1, Math.round(pitch / 2)))
  const b = opaqueBbox(eroded)
  if (!b) throw new Error('v7Chain: no opaque pixels')
  const lat = refineLattice(eroded, pitch, { ox: b.x0, oy: b.y0 })
  const r = resampleClusterLattice(eroded, lat)
  const opaqueCount = (im: RawImage) => {
    let n = 0
    for (let i = 3; i < im.data.length; i += 4) if (im.data[i]! > 0) n++
    return n
  }
  const desp = despeckle(r.out, 3)
  const despeckleRemoved = opaqueCount(r.out) - opaqueCount(desp)
  const filled = fillPinholes(desp, 2)
  const before = sweepMagentaCensus(filled)
  let sweepHits = 0
  for (let i = 0; i < filled.data.length; i += 4)
    if (filled.data[i] !== before.data[i] || filled.data[i + 1] !== before.data[i + 1] || filled.data[i + 2] !== before.data[i + 2]) sweepHits++
  const repaired = repairOutlineBlends(before)
  const mask = (im: RawImage) => {
    const data = new Uint8ClampedArray(im.data)
    for (let i = 0; i < data.length; i += 4)
      if (before.data[i] !== repaired.out.data[i] || before.data[i + 1] !== repaired.out.data[i + 1] || before.data[i + 2] !== repaired.out.data[i + 2]) data[i + 3] = 0
    return { width: im.width, height: im.height, data }
  }
  const E = (o: RawImage) => sheetMetrics([{ out: o, dominance: r.dominance, eroded, lat, origin: r.origin }]).reconErr
  const exclBefore = E(mask(before)), exclAfter = E(mask(repaired.out))
  return {
    out: repaired.out, before, dominance: r.dominance, eroded, lat, origin: r.origin,
    despeckleRemoved, sweepHits, repainted: repaired.repainted,
    outlineSnaps: repaired.outlineSnaps, fillSnaps: repaired.fillSnaps,
    exclBefore, exclAfter, exclDelta: exclAfter - exclBefore,
  }
}

// DEPRECATED: predicate false-positives on legitimate palette colors; use sweepMagentaCensus.
// Final art-resolution sweep: any opaque pixel in the magenta family (r>g+40 AND
// b>g+25) takes the mode color of its opaque 8-neighbors — magenta is not a Style
// Bible color, so this is always safe at art resolution. Ties break first-seen;
// a pixel with no opaque neighbors is left unchanged.
export function sweepMagenta(img: RawImage): RawImage {
  const out = new Uint8ClampedArray(img.data)
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 4
    if (img.data[i + 3] === 0) continue
    const r = img.data[i]!, g = img.data[i + 1]!, b = img.data[i + 2]!
    if (!(r > g + 40 && b > g + 25)) continue
    const counts = new Map<number, number>()
    let best = -1, bestN = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue
      const n = (ny * img.width + nx) * 4
      if (img.data[n + 3] === 0) continue
      const key = (img.data[n]! << 16) | (img.data[n + 1]! << 8) | img.data[n + 2]!
      const c = (counts.get(key) ?? 0) + 1
      counts.set(key, c)
      if (c > bestN) { bestN = c; best = key }
    }
    if (best < 0) continue
    out[i] = best >> 16; out[i + 1] = (best >> 8) & 255; out[i + 2] = best & 255
  }
  return { width: img.width, height: img.height, data: out }
}

// DEPRECATED for sprite post-processing (pipeline v3): aggregates detectArtScale's
// degenerate round-trip metric — see its note. Kept for grid-true inputs.
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

// DEPRECATED: unused by live pipelines since v5 (ε-cluster sampling replaced shared
// palettes); kept for palette audits.
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

// Fixed-width pairwise cellDistance table (optionally against mirrored columns).
export function distanceMatrix(cells: { label: string; img: RawImage }[], mirror: boolean): string {
  const header = ['            ', ...cells.map(c => c.label.padStart(11))].join(' ')
  const lines = cells.map(a => [a.label.padEnd(12), ...cells.map(b =>
    cellDistance(a.img, mirror ? mirrorX(b.img) : b.img).toFixed(3).padStart(11))].join(' '))
  return [header, ...lines].join('\n')
}

// Median of all pairwise cellDistances (upper-median for even pair counts).
export function pairwiseMedian(imgs: RawImage[]): number {
  const ds: number[] = []
  for (let i = 0; i < imgs.length; i++) for (let j = i + 1; j < imgs.length; j++)
    ds.push(cellDistance(imgs[i]!, imgs[j]!))
  ds.sort((a, b) => a - b)
  return ds[Math.floor(ds.length / 2)]!
}

// v2 locked recipe for a generated character raw: chromaKey → majority downscale at the
// detected art scale (coarsening until the sprite fits) → defringe → anchor. Real gemini
// big-pixel art has no exact lattice (round-trip error rises monotonically from k=4),
// so start at the detected scale and coarsen until the sprite fits the canvas.
export async function postProcessCell(rawPng: Buffer, canvas: number, feetY: number): Promise<RawImage> {
  const keyed = chromaKey(await decodePng(rawPng))
  for (let k = detectArtScale(keyed); ; k++) {
    const snapped = downscaleMajority(keyed,
      Math.max(1, Math.round(keyed.width / k)), Math.max(1, Math.round(keyed.height / k)))
    try { return anchorToCanvas(defringe(snapped), canvas, canvas, feetY) }
    catch (e) { if (k >= 16) throw e }
  }
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
