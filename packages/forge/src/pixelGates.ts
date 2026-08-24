// Mechanical criteria are COUNTED, never asked of the vision judge. These are the pixel-bar
// gates: pure functions over a shipped PNG that stop obviously broken art before an eye ever
// sees it. They are NECESSARY, NOT SUFFICIENT — the user's eye remains the only art gate.
//
// The governing rule they enforce is INTEGER DOWNSCALE ONLY: a target that does not divide
// the generation evenly cannot preserve a pixel grid, and that is the "weird pixel effect".
import type { Footprint } from '@sj/shared'
import { paletteRgb } from './palette.js'
import type { RawImage } from './post/raw.js'

export type Size = { w: number; h: number }
export type GateResult = { ok: boolean; failures: string[] }

const PALETTE_SET = new Set(paletteRgb().map(([r, g, b]) => (r << 16) | (g << 8) | b))
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0').toUpperCase()}`
const ok = (failures: string[]): boolean => failures.length === 0

// ---------------------------------------------------------------- 1. integer scale

export function integerScaleGate(raw: Size, shipped: Size): GateResult & { factor: number | null } {
  const failures: string[] = []
  const fx = raw.w / shipped.w, fy = raw.h / shipped.h
  if (fx < 1 || fy < 1) failures.push(
    `upscale ${raw.w}x${raw.h} -> ${shipped.w}x${shipped.h}: the shipped size must never exceed the generation`)
  else {
    if (!Number.isInteger(fx) || !Number.isInteger(fy)) failures.push(
      `non-integer downscale ${raw.w}x${raw.h} -> ${shipped.w}x${shipped.h}: ` +
      `x=${fx.toFixed(3)} y=${fy.toFixed(3)}, both must be whole numbers`)
    if (fx !== fy) failures.push(
      `anisotropic downscale ${raw.w}x${raw.h} -> ${shipped.w}x${shipped.h}: ` +
      `x=${fx.toFixed(3)} but y=${fy.toFixed(3)}`)
  }
  return { ok: ok(failures), failures, factor: ok(failures) ? fx : null }
}

// ---------------------------------------------------------------- 2. pixel-grid quantization

// Downscale by the claimed pixel size and re-upscale: the result must be identical to the
// shipped image. Equivalently, every artPx x artPx block is one RGBA value.
export function pixelGridGate(img: RawImage, artPx: number): GateResult & { badBlocks: number } {
  if (!Number.isInteger(artPx) || artPx < 1) return {
    ok: false, badBlocks: -1,
    failures: [`claimed pixel size ${artPx} is not a positive integer`],
  }
  if (img.width % artPx !== 0 || img.height % artPx !== 0) return {
    ok: false, badBlocks: -1,
    failures: [`claimed pixel size ${artPx} does not divide the ${img.width}x${img.height} canvas`],
  }
  let badBlocks = 0
  let first = ''
  for (let by = 0; by < img.height; by += artPx)
    for (let bx = 0; bx < img.width; bx += artPx) {
      const i0 = (by * img.width + bx) * 4
      let uniform = true
      for (let y = 0; y < artPx && uniform; y++)
        for (let x = 0; x < artPx; x++) {
          const i = ((by + y) * img.width + bx + x) * 4
          if (img.data[i] !== img.data[i0] || img.data[i + 1] !== img.data[i0 + 1]
            || img.data[i + 2] !== img.data[i0 + 2] || img.data[i + 3] !== img.data[i0 + 3]) {
            uniform = false
            break
          }
        }
      if (!uniform) { badBlocks++; first ||= `${bx},${by}` }
    }
  const failures = badBlocks === 0 ? []
    : [`pixel grid ${artPx}: ${badBlocks} blocks are not a single colour (first at ${first})`]
  return { ok: ok(failures), failures, badBlocks }
}

// ---------------------------------------------------------------- 3. alpha binarization

// Soft alpha is allowed for exactly one thing: preview/contact images that are never
// sampled by the renderer. Every shipped sprite, tile and portrait is opaque or clear.
export function alphaBinaryGate(
  img: RawImage, opts: { allowSoftAlpha?: boolean } = {},
): GateResult & { softPixels: number } {
  let softPixels = 0
  for (let i = 3; i < img.data.length; i += 4) {
    const a = img.data[i]!
    if (a !== 0 && a !== 255) softPixels++
  }
  const failures = softPixels === 0 || opts.allowSoftAlpha === true ? []
    : [`alpha: ${softPixels} pixels are neither fully opaque nor fully transparent`]
  return { ok: ok(failures), failures, softPixels }
}

// ---------------------------------------------------------------- 4. palette conformance

// USER RULING 2026-08-18: the blanket portrait exemption this gate once carried is REVOKED.
// A class may answer to a WIDER palette, never to none. `palette` is how it says which —
// portraits pass `derivedPalette()`, which is MASTER_PALETTE plus the tones interpolated
// between adjacent members of the same ramp. Faces keep their range, the world keeps its
// harmony, and the gate stays mechanical.
export function paletteGate(
  img: RawImage, opts: { palette?: readonly (readonly number[])[] } = {},
): GateResult & { offPalette: number; offenders: { hex: string; count: number }[] } {
  const allowed = opts.palette === undefined ? PALETTE_SET
    : new Set(opts.palette.map((p) => (p[0]! << 16) | (p[1]! << 8) | p[2]!))
  const counts = new Map<number, number>()
  let offPalette = 0
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue
    const rgb = (img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!
    if (allowed.has(rgb)) continue
    offPalette++
    counts.set(rgb, (counts.get(rgb) ?? 0) + 1)
  }
  const offenders = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([rgb, count]) => ({ hex: hex(rgb), count }))
  const failures = offPalette === 0 ? []
    : [`palette: ${offPalette} opaque pixels off the ${allowed.size}-colour palette in ` +
      `${counts.size} colours (worst ${offenders.map(o => `${o.hex} x${o.count}`).join(', ')})`]
  return { ok: ok(failures), failures, offPalette, offenders }
}

// ---------------------------------------------------------------- 5. density within a sprite

// A sprite's density is how many art pixels it spends per world pixel of the ground it
// covers. A fractional density cannot land on the pixel grid at any zoom, which is what
// 192 px of bed over a 1x2 footprint on a 128x64 tile asks for.
export function spriteDensity(a: { canvas: Size; footprint: Footprint; tile: Size }): number {
  const spanW = (a.footprint.w + a.footprint.h) * (a.tile.w / 2)
  return a.canvas.w / spanW
}

export function nativeDensityGate(a: {
  name: string; canvas: Size; footprint: Footprint; tile: Size
}): GateResult & { density: number } {
  const density = spriteDensity(a)
  const failures = Number.isInteger(density) ? []
    : [`${a.name}: ${a.canvas.w}px of art over a ${a.footprint.w}x${a.footprint.h} footprint on a ` +
      `${a.tile.w}x${a.tile.h} tile is ${density} art px per world px, which is not a whole number`]
  return { ok: ok(failures), failures, density }
}

// ---------------------------------------------------------------- 6. density across a class

export function classDensityGate(
  members: readonly { name: string; density: number }[],
): GateResult & { densities: number[] } {
  const densities = [...new Set(members.map(m => m.density))].sort((a, b) => a - b)
  const failures = densities.length <= 1 ? []
    : [`mixed densities in one class: ${members.map(m => `${m.name}=${m.density}`).join(', ')}`]
  return { ok: ok(failures), failures, densities }
}

// ---------------------------------------------------------------- 7. tileset seams

// A seam is only a seam relative to the material's own noise: a busy stone wall wraps with
// a bigger absolute delta than still water and is no worse for it. Calibrated on the nine
// shipped terrain materials plus the mock wall: sound wraps land at 1.1-1.8x their interior
// baseline, the repeating wall piece at 4.5x. The absolute floor keeps a near-uniform
// material from failing on dither noise.
export const SEAM_RATIO_MAX = 2.5
export const SEAM_ABSOLUTE_FLOOR = 8

export function tileSeamGate(img: RawImage): GateResult & {
  wrapH: number; baselineH: number; wrapV: number; baselineV: number
} {
  const colDelta = (a: number, b: number): number => {
    let s = 0
    for (let y = 0; y < img.height; y++) {
      const i = (y * img.width + a) * 4, j = (y * img.width + b) * 4
      for (let k = 0; k < 3; k++) s += Math.abs(img.data[i + k]! - img.data[j + k]!)
    }
    return s / (img.height * 3)
  }
  const rowDelta = (a: number, b: number): number => {
    let s = 0
    for (let x = 0; x < img.width; x++) {
      const i = (a * img.width + x) * 4, j = (b * img.width + x) * 4
      for (let k = 0; k < 3; k++) s += Math.abs(img.data[i + k]! - img.data[j + k]!)
    }
    return s / (img.width * 3)
  }
  let hb = 0
  for (let x = 0; x < img.width - 1; x++) hb += colDelta(x, x + 1)
  let vb = 0
  for (let y = 0; y < img.height - 1; y++) vb += rowDelta(y, y + 1)
  const baselineH = hb / Math.max(1, img.width - 1), baselineV = vb / Math.max(1, img.height - 1)
  const wrapH = colDelta(img.width - 1, 0), wrapV = rowDelta(img.height - 1, 0)

  const failures: string[] = []
  const check = (axis: string, wrap: number, base: number): void => {
    if (wrap > SEAM_ABSOLUTE_FLOOR && wrap > base * SEAM_RATIO_MAX) failures.push(
      `${axis} seam: the wrap edge differs by ${wrap.toFixed(1)}, ` +
      `${(wrap / Math.max(base, 0.1)).toFixed(1)}x this material's own ${base.toFixed(1)} interior noise`)
  }
  check('horizontal', wrapH, baselineH)
  check('vertical', wrapV, baselineV)
  return { ok: ok(failures), failures, wrapH, baselineH, wrapV, baselineV }
}

// The other half of a seam: a join can be perfect and the repeat still read as a pattern.
// The mock round's wall came back every 4 tiles with a timber post at its edge, and the
// repeat looked like deliberate half-timbering.
export function tilesetVarietyGate(
  sequence: readonly string[], opts: { minPeriod: number },
): GateResult & { shortestPeriod: number | null } {
  let shortestPeriod: number | null = null
  let worst = ''
  const lastSeen = new Map<string, number>()
  sequence.forEach((piece, i) => {
    const prev = lastSeen.get(piece)
    if (prev !== undefined && (shortestPeriod === null || i - prev < shortestPeriod)) {
      shortestPeriod = i - prev
      worst = piece
    }
    lastSeen.set(piece, i)
  })
  const failures = shortestPeriod !== null && shortestPeriod < opts.minPeriod
    ? [`tileset repeat: "${worst}" comes back after ${shortestPeriod} tiles, ` +
      `below the ${opts.minPeriod}-tile minimum period`]
    : []
  return { ok: ok(failures), failures, shortestPeriod }
}

// ------------------------------------------------- 9. one body, one silhouette

// ★ THE GATE THAT WOULD HAVE STOPPED "TACTICAL GEAR".
//
// `amara/contact-b-ne` shipped a standing figure in a tactical harness with the words
// TACTICAL GEAR set beside her in silver pixel type — the image model captioning the costume
// it had just invented — and its mirror `contact-b-nw` shipped the caption backwards. It
// reached the running product: one frame in four of Amara's walk loop, in two of her four
// facings. EVERY LANDED GATE PASSED IT. `alphaBinaryGate` passed because the letters are hard
// alpha; `paletteGate` passed because they are drawn in MASTER_PALETTE silver; the coherence
// gate measured 1.1855 against a 1.18 silhouette tolerance and the generator shipped the
// least-bad of three failing candidates anyway; and `despeckle` removes islands under 1 % of
// the mass, while "TACTICAL" alone is 8.93 %.
//
// What none of them asked is the thing a person can see instantly: A PERSON IS ONE SHAPE.
// Text, a caption, a stray prop, a second figure, a baked drop shadow — every one of them is
// opaque mass that does not touch the body. Measured over the 120 committed cast cells: 118
// are exactly ONE island and the largest detached mass anywhere among them is 0.0000 %.
//
// The tolerance is `despeckle`'s own contract, so this gate asks for nothing the pipeline does
// not already promise: anything the pipeline should have swept, and nothing it should not.
export const DETACHED_MASS_MAX = 0.01

export function soleSilhouetteGate(img: RawImage): GateResult & {
  islands: number; detachedFraction: number
} {
  const { width: w, height: h, data } = img
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  const sizes: number[] = []
  for (let start = 0; start < w * h; start++) {
    if (seen[start] === 1 || data[start * 4 + 3] === 0) continue
    let n = 0
    stack.push(start)
    seen[start] = 1
    while (stack.length > 0) {
      const p = stack.pop()!
      n++
      const px = p % w, py = (p - px) / w
      if (px + 1 < w) { const q = p + 1; if (seen[q] === 0 && data[q * 4 + 3] !== 0) { seen[q] = 1; stack.push(q) } }
      if (px > 0) { const q = p - 1; if (seen[q] === 0 && data[q * 4 + 3] !== 0) { seen[q] = 1; stack.push(q) } }
      if (py + 1 < h) { const q = p + w; if (seen[q] === 0 && data[q * 4 + 3] !== 0) { seen[q] = 1; stack.push(q) } }
      if (py > 0) { const q = p - w; if (seen[q] === 0 && data[q * 4 + 3] !== 0) { seen[q] = 1; stack.push(q) } }
    }
    sizes.push(n)
  }
  const total = sizes.reduce((s, n) => s + n, 0)
  const body = sizes.length === 0 ? 0 : Math.max(...sizes)
  const detachedFraction = total === 0 ? 0 : (total - body) / total
  const failures = total === 0
    ? ['silhouette: the cell has no opaque pixels at all']
    : detachedFraction > DETACHED_MASS_MAX
      ? [`silhouette: ${sizes.length} opaque islands — ${(detachedFraction * 100).toFixed(2)}% of the `
        + `mass does not touch the body (limit ${(DETACHED_MASS_MAX * 100).toFixed(0)}%). `
        + 'A person is ONE shape; a second island is a caption, a prop or a second figure.']
      : []
  return { ok: ok(failures), failures, islands: sizes.length, detachedFraction }
}

// ---------------------------------------------------------------- the bar, assembled

export type PixelBarArgs = {
  name: string
  img: RawImage
  raw?: Size
  artPx?: number
  footprint?: Footprint
  tile?: Size
  allowSoftAlpha?: boolean
  palette?: readonly (readonly number[])[]
  seam?: boolean
}

export async function pixelBarReport(a: PixelBarArgs): Promise<GateResult & { name: string }> {
  const failures: string[] = []
  if (a.raw) failures.push(...integerScaleGate(a.raw, { w: a.img.width, h: a.img.height }).failures)
  if (a.artPx !== undefined) failures.push(...pixelGridGate(a.img, a.artPx).failures)
  failures.push(...alphaBinaryGate(a.img, { allowSoftAlpha: a.allowSoftAlpha }).failures)
  failures.push(...paletteGate(a.img, a.palette === undefined ? {} : { palette: a.palette }).failures)
  if (a.footprint && a.tile) failures.push(...nativeDensityGate({
    name: a.name, canvas: { w: a.img.width, h: a.img.height }, footprint: a.footprint, tile: a.tile,
  }).failures)
  if (a.seam === true) failures.push(...tileSeamGate(a.img).failures)
  return { name: a.name, ok: ok(failures), failures }
}
