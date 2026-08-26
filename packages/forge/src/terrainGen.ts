import {
  MATERIAL_KIND_PREFIX, ROAD_AUTOTILE_KEYS, SEASONS, TERRAIN_TILE_KINDS, materialKind,
  type RoadAutotileKey, type Season, type TerrainTileKind,
} from '@sj/shared'
import { paletteRgb } from './palette.js'
import { downscaleNearest, type RawImage } from './post/raw.js'
import { quantize } from './post/quantize.js'
import { TERRAIN_TILE_H, TERRAIN_TILE_W, inTileDiamond } from './terrainTiles.js'
import { paintRoadAutotile } from './roadTiles.js'
import { tileSeamGate } from './pixelGates.js'

// Image models draw vignettes and rims reflexively and no amount of "no border" in the prompt
// stops it, so the outer 8% of each side is CUT before the material is measured.
export const CANDIDATE_MARGIN = 0.08

export function cropMargin(img: RawImage, margin: number = CANDIDATE_MARGIN): RawImage {
  const cut = Math.round(Math.min(img.width, img.height) * margin)
  const w = img.width - 2 * cut, h = img.height - 2 * cut
  if (w <= 0 || h <= 0) return img
  const out: RawImage = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }
  for (let y = 0; y < h; y++) {
    const src = ((y + cut) * img.width + cut) * 4
    out.data.set(img.data.subarray(src, src + w * 4), y * w * 4)
  }
  return out
}

// The ground is a CONTINUOUS world-space material field, not per-tile art, so the material carries
// the fidelity: 256 is eight tile-widths, and what a 512 generation supports after the crop.
export const MATERIAL_PX = 256

// Comparing opposing edges PIXEL BY PIXEL is the wrong instrument for organic noise: two edges of
// one stochastic material disagree almost everywhere. This compares the mean tone of a strip.
export const SEAM_STRIP_PX = 3
export const SEAM_TOLERANCE = 14

export const TILING_CRITERION_PROMPT =
  'the last image you are given is the SAME square repeated in a 3x3 grid. Look along the ' +
  'two interior vertical lines and the two interior horizontal lines. Score 10 if you cannot ' +
  'tell where one copy ends and the next begins; score low if you can see a seam line, a ' +
  'brightness step across a repeat boundary, or a distinctive blob that visibly recurs on a ' +
  'grid. Judge the repeat, not the beauty of the material.'

export function terrainBoilerplate(): string {
  return 'A seamless, edge-wrapping, top-down ground material tile for a cozy pixel-art town. ' +
    'Flat overhead view of the ground itself — no objects, no horizon, no shadows cast from ' +
    'outside the tile, no vignette, no border, no frame. Even lighting across the whole square ' +
    'so it can repeat without a visible seam. Hard pixel clusters, no gradients, no blur. ' +
    'Warm cozy pastel palette: sage green, honey wood, cream stone, warm grey, dusty rose. ' +
    'The left edge must continue into the right edge and the top edge into the bottom edge. ' +
    // A numerically perfect wrap still fails if three bright flowers in one square become a
    // lattice of flowers once it repeats: the material must have NOTHING the eye can lock onto.
    'CRITICAL: the texture must be uniform and featureless at the scale of the whole square. ' +
    'No single distinctive mark anywhere — no flower, no bright blob, no large stone, no ' +
    'branch, no lighter or darker patch that the eye can pick out and follow. Fine, even, ' +
    'all-over grain of the same size and contrast from corner to corner, so that when this ' +
    'square is repeated in a grid nothing recurs visibly. ' +
    // The second lesson: "uniform" is not "flat". A material with no internal contrast reads
    // as mush once it is cut down to a 32x16 tile. Grain must be CHUNKY and evenly spread.
    'The grain itself must still be clearly readable: chunky clusters three or four pixels ' +
    'across in three or four distinct tones of the same colour family, evenly spread. Not a ' +
    'smooth wash, not single-pixel noise — visible texture with no landmarks in it.'
}

// Every line describes a UNIFORM MATERIAL. Variety between tiles is the renderer's job; variety
// inside one tile is what makes a repeat visible.
export const TERRAIN_COMMISSIONS: Record<string, string> = {
  'grass:0': 'Close-cropped sage meadow grass: short blade clusters in three clear tones of green, evenly spread over the whole square, plainly visible texture with no bare patches.',
  'grass:1': 'Meadow grass one shade deeper and slightly coarser than the last: the same even all-over blade grain, a little more contrast between blades, still one uniform tone.',
  'grass:2': 'Dry sun-bleached grass going to straw: uniform pale sage-and-wheat grain, evenly mixed at fine scale, no bare patches and no clumps.',
  'grass:3': 'Damp mossy grass, the darkest of the four: uniform deep sage grain with an even fine mottle, no patches.',
  'earth:0': 'Bare turned earth: uniform warm honey-brown, fine even crumb grain at a small scale, no large clods and no stones.',
  'water:0': 'Calm shallow water seen from directly above: soft blue-grey with clearly drawn short ripple strokes in three tones of blue, evenly spread over the whole square, no shoreline, no reflections.',
  'forest:0': 'Shaded forest floor: uniform dark sage and moss with an even fine litter grain, no ferns, no branches, no bright spots.',
  'rock:0': 'Weathered warm-grey bedrock: uniform stone grain with an even fine crack mottle at a small scale, no large slabs and no single big fissure.',
  'sand:0': 'A wet river bank: uniform pale cream damp sand with an even fine ripple grain, evenly mixed darker and lighter at small scale, no pebbles and no water. The shore surface itself.',
  // The first farmland came back as the style-anchor COTTAGE, and every mechanical gate passed it
  // because a cottage wraps as well as soil. The commission names the furrow as the only structure.
  'farmland:0': 'Ploughed soil seen from directly above: rich damp brown, covered corner to corner with straight parallel furrow ridges at a small even pitch, every ridge the same width and the same length as every other, running in ONE direction across the whole square. The furrows are the only structure in the picture. No building, no roof, no wall, no window, no door, no fence, no crop, no plant, no path, no headland, no field boundary, no bare patch.',
}

export const SEASON_COMMISSIONS: Record<Season, string> = {
  spring: 'under early spring: fresh new sage growth over damp dark earth, evenly mixed',
  summer: 'at high summer: deep warm green, dry honey undertone, evenly mixed',
  autumn: 'in autumn: amber and rust over tired green, evenly mixed at fine scale',
  winter: 'under winter: cool blue-shadowed frost over it, the colour evenly drained',
}

// The plaza cobble reads beautifully at plaza scale and as a noisy stone-string on a 16px ribbon,
// so thin runs get their own CALM material — same warm sand family, same mean, lower contrast.
export const CALM_ROAD_NAME = 'road-calm'
export const CALM_ROAD_ID = `terrain:${CALM_ROAD_NAME}:0`
export const CALM_ROAD_COMMISSION =
  'A packed sandy footpath surface, walked smooth: fine warm sand with only a few small ' +
  'pebbles pressed flush into it, very low contrast, almost even in tone, no cobbles, no ' +
  'paving stones, no joints or grout lines, no ruts.'

export const ROAD_COMMISSION =
  'A packed-stone town road surface: uniform small cream and warm-grey cobbles of even size ' +
  'with fine pale grit between them, the same all over, no kerb, no grass, no ruts, no large ' +
  'stone that stands out from the rest.'

// All fifteen road shapes are stencils of ONE road surface: fifteen generations would cost fifteen
// times as much AND look like a patchwork, because a lattice must be one road.
export type TerrainItem = { assetId: string; commission: string; generateFrom?: string } & (
  | { sort: 'ground'; kind: TerrainTileKind; variant: number }
  | { sort: 'road'; roadKey: RoadAutotileKey }
  | { sort: 'season'; season: Season }
  | { sort: 'material'; name: string }
)

type IdInput =
  | { sort: 'ground'; kind: string; variant: number }
  | { sort: 'road'; roadKey: string }
  | { sort: 'season'; season: string }

export function terrainAssetId(i: IdInput): string {
  if (i.sort === 'ground') return `terrain:${i.kind}:${i.variant}`
  if (i.sort === 'road') return `terrain:road:${i.roadKey}`
  return `terrain:season:${i.season}`
}

// No per-tile variants: they existed to break up a repeating tile stamp, and a continuous
// world-space field has no tile stamp to break up.
export const GROUND_VARIANTS: Record<TerrainTileKind, number> = {
  grass: 1, earth: 1, water: 1, forest: 1, rock: 1, sand: 1, farmland: 1, road: 1,
}

// `materialKind` lives in @sj/shared beside the tile kinds — the forge writes that codex
// kind and the renderer reads it.
export { MATERIAL_KIND_PREFIX, materialKind }

export const ROAD_MATERIAL_ID = 'terrain:road:0'

// One place the whole program is decided, so a dry run and a live run cost the same to read.
export function planTerrainProgram(): TerrainItem[] {
  const out: TerrainItem[] = []
  for (const kind of TERRAIN_TILE_KINDS) {
    for (let variant = 0; variant < GROUND_VARIANTS[kind]; variant++) {
      const commission = kind === 'road'
        ? ROAD_COMMISSION
        : TERRAIN_COMMISSIONS[`${kind}:${variant}`] ?? TERRAIN_COMMISSIONS[`${kind}:0`]!
      out.push({ sort: 'ground', kind, variant, assetId: terrainAssetId({ sort: 'ground', kind, variant }), commission })
    }
  }
  out.push({
    sort: 'material', name: CALM_ROAD_NAME, assetId: CALM_ROAD_ID,
    commission: CALM_ROAD_COMMISSION,
  })
  for (const roadKey of ROAD_AUTOTILE_KEYS) {
    out.push({
      sort: 'road', roadKey, assetId: terrainAssetId({ sort: 'road', roadKey }),
      commission: ROAD_COMMISSION, generateFrom: ROAD_MATERIAL_ID,
    })
  }
  for (const season of SEASONS) {
    out.push({
      sort: 'season', season, assetId: terrainAssetId({ sort: 'season', season }),
      commission: `Uniform meadow ground ${SEASON_COMMISSIONS[season]}. Even fine grain all over, no landmarks.`,
    })
  }
  return out
}

// ------------------------------------------------------------------ post

// Box-average onto the material grid, then snap to MASTER_PALETTE: averaging first keeps a 512
// generation's grain from aliasing, and float block bounds let a smaller source still fill it.
export function toMaterialGrid(img: RawImage, px: number = MATERIAL_PX): RawImage {
  const out: RawImage = { width: px, height: px, data: new Uint8ClampedArray(px * px * 4) }
  for (let y = 0; y < px; y++) {
    const y0 = Math.floor((y * img.height) / px)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / px))
    for (let x = 0; x < px; x++) {
      const x0 = Math.floor((x * img.width) / px)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / px))
      let r = 0, g = 0, b = 0, n = 0
      for (let sy = y0; sy < y1 && sy < img.height; sy++) {
        for (let sx = x0; sx < x1 && sx < img.width; sx++) {
          const i = (sy * img.width + sx) * 4
          r += img.data[i]!; g += img.data[i + 1]!; b += img.data[i + 2]!; n++
        }
      }
      const d = (y * px + x) * 4
      out.data.set(n === 0 ? [0, 0, 0, 255] : [Math.round(r / n), Math.round(g / n), Math.round(b / n), 255], d)
    }
  }
  const q = quantize(out, paletteRgb())
  for (let i = 3; i < q.data.length; i += 4) q.data[i] = 255   // ground is never see-through
  return q
}

export function materialFromCandidate(raw: RawImage, px: number = MATERIAL_PX): RawImage {
  return toMaterialGrid(cropMargin(raw), px)
}

export type SeamReport = {
  horizontalDelta: number; verticalDelta: number
  worstAxis: 'horizontal' | 'vertical'; pass: boolean; note: string
}

// mean colour of an edge strip: `axis` picks the column band or the row band
function stripMean(img: RawImage, axis: 'x' | 'y', from: number, width: number): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0
  const outer = axis === 'x' ? img.height : img.width
  for (let o = 0; o < outer; o++) {
    for (let d = from; d < from + width; d++) {
      const i = (axis === 'x' ? o * img.width + d : d * img.width + o) * 4
      r += img.data[i]!; g += img.data[i + 1]!; b += img.data[i + 2]!; n++
    }
  }
  return n === 0 ? [0, 0, 0] : [r / n, g / n, b / n]
}

const toneDelta = (a: [number, number, number], b: [number, number, number]): number =>
  [0, 1, 2].reduce((s, k) => s + Math.abs(a[k]! - b[k]!), 0) / 3

// Deterministic seam check: a tile that wraps has a left column close to its right column and
// a top row close to its bottom row, because in a repeat those are neighbours.
export function seamReport(m: RawImage): SeamReport {
  const strip = Math.max(1, Math.min(SEAM_STRIP_PX, Math.floor(Math.min(m.width, m.height) / 2)))
  const horizontalDelta = toneDelta(
    stripMean(m, 'x', 0, strip), stripMean(m, 'x', m.width - strip, strip))
  const verticalDelta = toneDelta(
    stripMean(m, 'y', 0, strip), stripMean(m, 'y', m.height - strip, strip))
  const worstAxis = horizontalDelta >= verticalDelta ? 'horizontal' : 'vertical'
  const pass = horizontalDelta <= SEAM_TOLERANCE && verticalDelta <= SEAM_TOLERANCE
  const note = pass
    ? `wraps cleanly (horizontal ${horizontalDelta.toFixed(1)}, vertical ${verticalDelta.toFixed(1)})`
    : worstAxis === 'horizontal'
      ? `the left edge does not continue into the right edge (delta ${horizontalDelta.toFixed(1)}); make the horizontal wrap seamless`
      : `the top edge does not continue into the bottom edge (delta ${verticalDelta.toFixed(1)}); make the vertical wrap seamless`
  return { horizontalDelta, verticalDelta, worstAxis, pass, note }
}

// A tile can wrap PERFECTLY and still be useless: a drawn frame matches itself across the wrap, so
// `seamReport` reads 0.0 and the material renders as a grid of framed cards.
export const BORDER_TOLERANCE = 18      // mean per-channel distance, ~one palette step
export const BORDER_RING_PX = 2

export type BorderReport = { ringDelta: number; framed: boolean; note: string }

export function borderReport(m: RawImage, ring: number = BORDER_RING_PX): BorderReport {
  let ringSum = [0, 0, 0], ringN = 0, midSum = [0, 0, 0], midN = 0
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      const i = (y * m.width + x) * 4
      const onRing = x < ring || y < ring || x >= m.width - ring || y >= m.height - ring
      const t = onRing ? ringSum : midSum
      t[0] += m.data[i]!; t[1] += m.data[i + 1]!; t[2] += m.data[i + 2]!
      if (onRing) ringN++; else midN++
    }
  }
  if (ringN === 0 || midN === 0) return { ringDelta: 0, framed: false, note: 'no ring to measure' }
  const ringDelta = [0, 1, 2].reduce((s2, k) => s2 + Math.abs(ringSum[k]! / ringN - midSum[k]! / midN), 0) / 3
  const framed = ringDelta > BORDER_TOLERANCE
  return {
    ringDelta, framed,
    note: framed
      ? `the outer edge is drawn as a border or frame (edge differs from the middle by ${ringDelta.toFixed(1)}); remove it — the texture must run right off all four sides with no outline, no rim and no darker margin`
      : `no frame (edge matches the middle within ${ringDelta.toFixed(1)})`,
  }
}

// `seamReport` reads the wrap in ABSOLUTE tone, which is blind on smooth ground: earth wraps at
// 2.9 against a tolerance of 14 with the line plainly there. `tileSeamGate` reads it RELATIVE.
export function materialVeto(m: RawImage): string | null {
  const seam = seamReport(m)
  if (!seam.pass) return seam.note
  const border = borderReport(m)
  if (border.framed) return border.note
  const bar = tileSeamGate(m)
  if (!bar.ok) return `${bar.failures.join('; ')}; make the wrap as quiet as the middle of the tile`
  return null
}

// ---------------------------------------------------------------- making the wrap true
// An image model does not draw a torus, so the wrap is made true by CONSTRUCTION: layer B is the
// material rolled by (ox, oy), taken at the border where A's seam is, with a smoothstep between.

const wrapIndex = (m: RawImage, x: number, y: number): number =>
  ((((y % m.height) + m.height) % m.height) * m.width + (((x % m.width) + m.width) % m.width)) * 4

function bandDelta(m: RawImage, axis: 'col' | 'row', a: number, b: number): number {
  const outer = axis === 'col' ? m.height : m.width
  let s = 0
  for (let o = 0; o < outer; o++) {
    const i = axis === 'col' ? wrapIndex(m, a, o) : wrapIndex(m, o, a)
    const j = axis === 'col' ? wrapIndex(m, b, o) : wrapIndex(m, o, b)
    for (let k = 0; k < 3; k++) s += Math.abs(m.data[i + k]! - m.data[j + k]!)
  }
  return s / (outer * 3)
}

// The border has to fall between two lines that are ALREADY quiet neighbours — rolling by exactly
// half lands farmland's border on a furrow edge — and clear of the tile's own edges.
export function bestRollOffsets(m: RawImage): { ox: number; oy: number } {
  const pick = (axis: 'col' | 'row', span: number): number => {
    const margin = Math.max(8, span >> 3)
    let best = span >> 1, bestDelta = Infinity
    for (let k = margin; k < span - margin; k++) {
      const d = bandDelta(m, axis, k - 1, k)
      if (d < bestDelta) { bestDelta = d; best = k }
    }
    return best
  }
  return { ox: pick('col', m.width), oy: pick('row', m.height) }
}

export function seamlessMaterial(m: RawImage): RawImage {
  const w = m.width, h = m.height
  const { ox, oy } = bestRollOffsets(m)
  const out: RawImage = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }
  const ramp = (d: number, half: number): number => {
    const t = Math.min(1, d / half)
    return t * t * (3 - 2 * t)
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = Math.min(ramp(Math.min(x + 1, w - x), w >> 1), ramp(Math.min(y + 1, h - y), h >> 1))
    const i = wrapIndex(m, x, y), j = wrapIndex(m, x + ox, y + oy), o = (y * w + x) * 4
    for (let k = 0; k < 3; k++) out.data[o + k] = Math.round(m.data[i + k]! * a + m.data[j + k]! * (1 - a))
    out.data[o + 3] = 255
  }
  const q = quantize(out, paletteRgb())
  for (let i = 3; i < q.data.length; i += 4) q.data[i] = 255
  return q
}

// A rim on art that is already paid for gets CUT rather than regenerated. Every pass costs WRAP —
// cropping a seamless square breaks its own edges — so the step is small and stops at the first.
export const DEFRAME_STEP = 0.03
export const DEFRAME_MAX_PASSES = 6

export function deframe(m: RawImage): { material: RawImage; passes: number } {
  let out = m
  for (let passes = 1; passes <= DEFRAME_MAX_PASSES; passes++) {
    if (!borderReport(out).framed) return { material: out, passes: passes - 1 }
    out = toMaterialGrid(cropMargin(out, DEFRAME_STEP), m.width)
  }
  return { material: out, passes: DEFRAME_MAX_PASSES }
}

// Tone grading: $0, deterministic, no regeneration. It corrects a washed-out mean and excess
// noise without paying for new art.
export type Grade = {
  targetMean?: readonly [number, number, number]
  contrast?: number
  /** drop the warm half of MASTER_PALETTE before quantizing (see coolPalette) */
  coolOnly?: boolean
  /** drop only the pink/purple entries, keeping the sandy ramp (see noRosePalette) */
  noRose?: boolean
}

// Quantizing a green-grey midtone against the WHOLE palette lets it snap to dusty rose, which is
// why the graded grass came out flecked with pink. Green ground has no business on the warm ramp.
export function coolPalette(): ReturnType<typeof paletteRgb> {
  return paletteRgb().filter((p) => p[0] <= p[1] + 18)
}

// A stone road is warm and needs its sandy ramp; what it must not borrow is the ROSE ramp. Pinks
// sit where red leads green but green does NOT lead blue; tans keep green well clear of blue.
export function noRosePalette(): ReturnType<typeof paletteRgb> {
  return paletteRgb().filter((p) => !(p[0] > p[1] + 25 && p[1] - p[2] < 20))
}

export function materialMean(m: RawImage): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0
  for (let i = 0; i < m.data.length; i += 4) { r += m.data[i]!; g += m.data[i + 1]!; b += m.data[i + 2]!; n++ }
  return n === 0 ? [0, 0, 0] : [r / n, g / n, b / n]
}

export function materialContrast(m: RawImage): number {
  const mean = materialMean(m)
  const mid = (mean[0] + mean[1] + mean[2]) / 3
  let sd = 0, n = 0
  for (let i = 0; i < m.data.length; i += 4) {
    sd += (((m.data[i]! + m.data[i + 1]! + m.data[i + 2]!) / 3) - mid) ** 2
    n++
  }
  return n === 0 ? 0 : Math.sqrt(sd / n)
}

// Contrast first (pull each pixel toward the material's own mean), then the mean shift, then
// back onto MASTER_PALETTE so the result is still palette-true.
export function gradeMaterial(m: RawImage, grade: Grade): RawImage {
  const k = grade.contrast ?? 1
  const from = materialMean(m)
  const out: RawImage = { width: m.width, height: m.height, data: new Uint8ClampedArray(m.data) }
  for (let i = 0; i < out.data.length; i += 4) {
    for (let c = 0; c < 3; c++) out.data[i + c] = from[c]! + (m.data[i + c]! - from[c]!) * k
  }
  if (grade.targetMean !== undefined) {
    const now = materialMean(out)
    for (let i = 0; i < out.data.length; i += 4) {
      for (let c = 0; c < 3; c++) out.data[i + c] = out.data[i + c]! + (grade.targetMean[c]! - now[c]!)
    }
  }
  const palette = grade.coolOnly === true ? coolPalette()
    : grade.noRose === true ? noRosePalette() : paletteRgb()
  return quantize(out, palette)
}

// Targets measured off the v1 materials, which the user accepted structurally.
export const MATERIAL_GRADES: Record<string, Grade> = {
  grass: { targetMean: [151, 184, 119], contrast: 0.6, coolOnly: true },
  road: { targetMean: [205, 183, 148], contrast: 0.85, noRose: true },
  // The calm variant came back almost FLAT, and a large flat warm tan against a sage field reads
  // chromatic, so it is nudged UP — still far under the plaza cobble's grit.
  [CALM_ROAD_NAME]: { targetMean: [205, 183, 148], contrast: 1.2, noRose: true },
}

// The picture the vision judge scores TILING on: the same square nine times, so a seam or a
// recurring blob is the only thing that can stand out.
export function selfTile3x3(m: RawImage): RawImage {
  const w = m.width * 3, h = m.height * 3
  const out: RawImage = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }
  for (let ty = 0; ty < 3; ty++) {
    for (let tx = 0; tx < 3; tx++) {
      for (let y = 0; y < m.height; y++) {
        const src = (y * m.width) * 4
        out.data.set(
          m.data.subarray(src, src + m.width * 4),
          ((ty * m.height + y) * w + tx * m.width) * 4,
        )
      }
    }
  }
  return out
}

// Cut the dimetric top face out of the material. The diamond is the SAME mask the code-painted
// tiles used, so alignment is unchanged and every downstream consumer keeps working.
export function diamondFromMaterial(m: RawImage): RawImage {
  const src = m.width === TERRAIN_TILE_W && m.height === TERRAIN_TILE_H
    ? m
    : downscaleNearest(m, TERRAIN_TILE_W, TERRAIN_TILE_H)
  const out: RawImage = {
    width: TERRAIN_TILE_W, height: TERRAIN_TILE_H,
    data: new Uint8ClampedArray(TERRAIN_TILE_W * TERRAIN_TILE_H * 4),
  }
  for (let y = 0; y < TERRAIN_TILE_H; y++) {
    for (let x = 0; x < TERRAIN_TILE_W; x++) {
      if (!inTileDiamond(x, y)) continue
      const i = (y * TERRAIN_TILE_W + x) * 4
      out.data.set([src.data[i]!, src.data[i + 1]!, src.data[i + 2]!, 255], i)
    }
  }
  return out
}

// The items that actually cost a model call. Everything else is cut from one of these.
export function generationItems(plan: TerrainItem[] = planTerrainProgram()): TerrainItem[] {
  return plan.filter((p) => p.generateFrom === undefined)
}

// The painted road tile is used as an ALPHA STENCIL and the generated road surface fills it, so
// every junction is cut from the same surface and the lattice reads as one road.
export function stencilRoadTile(material: RawImage, key: RoadAutotileKey): RawImage {
  const stencil = paintRoadAutotile(key)
  const surface = diamondFromMaterial(material)
  const out: RawImage = {
    width: TERRAIN_TILE_W, height: TERRAIN_TILE_H,
    data: new Uint8ClampedArray(TERRAIN_TILE_W * TERRAIN_TILE_H * 4),
  }
  for (let i = 0; i < out.data.length; i += 4) {
    if (stencil.data[i + 3] === 0) continue
    out.data.set([surface.data[i]!, surface.data[i + 1]!, surface.data[i + 2]!, 255], i)
  }
  return out
}

// Seasonal grading taken from GENERATED art: the per-channel ratio between a season's own
// material and the summer one.
export function seasonTintFrom(seasonMat: RawImage, summerMat: RawImage): { r: number; g: number; b: number } {
  const mean = (m: RawImage, k: number): number => {
    let s = 0, n = 0
    for (let i = 0; i < m.data.length; i += 4) { s += m.data[i + k]!; n++ }
    return n === 0 ? 1 : Math.max(1, s / n)
  }
  const ratio = (k: number): number =>
    Math.min(1.6, Math.max(0.6, mean(seasonMat, k) / mean(summerMat, k)))
  return { r: ratio(0), g: ratio(1), b: ratio(2) }
}
