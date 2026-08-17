import {
  MATERIAL_KIND_PREFIX, ROAD_AUTOTILE_KEYS, SEASONS, TERRAIN_TILE_KINDS, materialKind,
  type RoadAutotileKey, type Season, type TerrainTileKind,
} from '@sj/shared'
import { paletteRgb } from './palette.js'
import { downscaleNearest, type RawImage } from './post/raw.js'
import { quantize } from './post/quantize.js'
import { TERRAIN_TILE_H, TERRAIN_TILE_W, inTileDiamond } from './terrainTiles.js'
import { paintRoadAutotile } from './roadTiles.js'

// USER RULING 2026-08-17: "I want properly generated repeating tiling textures from an image
// model." This supersedes C10 T1's code-painted tiles and C13's code-painted road strip. The
// renderer contract does not move — the art lands under the same codex kinds and manifest
// keys, so it hot-swaps.

// Image models draw vignettes and rims almost reflexively, and no amount of "no border" in
// the prompt reliably stops it — grass:2 came back framed three attempts running. So the
// margin is CUT rather than argued with: the outer 8% of each side is discarded before the
// material is measured, which removes any rim deterministically and leaves the seam check to
// judge what actually remains.
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

// TERRAIN V2 (user directive 2026-08-17): the ground is a CONTINUOUS world-space material
// field, not per-tile art. A tile is a window onto the material, so the material must carry
// the fidelity — 64px was four tile-widths and read as low-resolution mush once it stopped
// being squashed into a 32x16 diamond. 256 is eight tile-widths at full ground resolution,
// and it is what the 512 generation can actually support after the margin crop.
export const MATERIAL_PX = 256

// MEASURED, not guessed (2026-08-17, live batch). The first version of this check compared
// opposing edges PIXEL BY PIXEL, which is the wrong instrument for organic noise: two edges
// of the same stochastic material disagree per-pixel almost everywhere. Across the thirteen
// generated materials it scored 2.6 to 32.5, while a genuine discontinuity (half grass, half
// water) scored only 41.6 — barely any separation, and farmland at its WORST score of 32.2
// tiles with no visible seam at all in a 10x10 dimetric lattice.
//
// What actually matters is whether the two edges are the same MATERIAL. So the check compares
// the mean tone of an edge STRIP against its opposite: homogeneous material lands near zero,
// a real discontinuity lands far away, and the two are cleanly separated.
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
    // The lesson the first live run taught: the wrap was numerically perfect and the tile
    // still failed, because three bright flowers in one square become a lattice of flowers
    // once it repeats. A ground material must have NOTHING the eye can lock onto.
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

// Ground vocabulary, one line per material. Written about earth and water, never about the
// thing drawing it.
// Every line describes a UNIFORM MATERIAL. Variety between tiles is the renderer's job (four
// grass variants picked by a per-tile hash); variety inside one tile is what makes a repeat
// visible. Differences between variants are in colour and grain density, never in landmarks.
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
  'farmland:0': 'Ploughed soil: uniform rich damp brown with fine even parallel furrow grain running corner to corner at a small, regular pitch, no headland and no gaps.',
}

export const SEASON_COMMISSIONS: Record<Season, string> = {
  spring: 'under early spring: fresh new sage growth over damp dark earth, evenly mixed',
  summer: 'at high summer: deep warm green, dry honey undertone, evenly mixed',
  autumn: 'in autumn: amber and rust over tired green, evenly mixed at fine scale',
  winter: 'under winter: cool blue-shadowed frost over it, the colour evenly drained',
}

// TERRAIN V2.1 (controller, final art round): the plaza cobble reads beautifully at plaza
// scale and as a noisy stone-string on a 16px ribbon. Thin runs get their own CALM material —
// same warm sand family, same mean, much lower contrast — and the plaza keeps its cobbles.
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

// `generateFrom` names the material a piece is CUT from rather than generated for. All
// fifteen road shapes are stencils of one road surface: fifteen separate generations would
// cost fifteen times as much AND look like a patchwork, because a lattice must be one road.
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

// TERRAIN V2: per-tile variants are GONE. They existed to break up a repeating tile stamp,
// and a continuous world-space field has no tile stamp to break up — the material's own
// variation does that job, at its own scale rather than at tile frequency. One material per
// ground, which is also seven fewer calls.
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

// Box-average down to the material grid, then snap to MASTER_PALETTE. Averaging first is what
// keeps a 512 generation's grain from aliasing into noise; quantizing after is what makes the
// result palette-true rather than merely close.
// Box-average any source onto the material grid, then snap to MASTER_PALETTE. Averaging
// first keeps a 512 generation's grain from aliasing into noise; quantizing after makes the
// result palette-true rather than merely close. Block bounds are computed in floating point
// so a source SMALLER than the grid still fills every cell — an integer step silently left
// the right and bottom edges black.
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

// A tile can wrap PERFECTLY and still be useless: a drawn frame matches itself across the
// wrap (left edge == right edge), so seamReport reads 0.0 and the material still renders as
// a grid of framed cards. Live finding, water:0. The ring must look like the middle.
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

// A material that is ALREADY PAID FOR and still carries a rim gets the rim cut off rather
// than regenerated: sand:0 came back framed at ring 24.7 even through the 8% crop, because
// the model drew a thick one. Cutting is free; another attempt is not.
// Every pass costs WRAP: cropping a seamless square breaks its own edges, and farmland went
// from h=2.0 to h=23.4 under a single 10% bite. So the step is small and the loop stops at
// the FIRST crop that clears the frame — the least damage that does the job.
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

// TONE GRADING ($0, deterministic, no regeneration). Measured against the v1 materials the
// user accepted structurally: v1 grass mean [151,184,119] with contrast SD 11; the v2
// generation came back [146,160,116] at SD 21 — a third of the green gone (G-R fell from +33
// to +14) and twice the noise, which is exactly "washed-out grey-green" that "reads as static
// rather than texture" at 1x. Grading fixes both without paying for new art.
export type Grade = {
  targetMean?: readonly [number, number, number]
  contrast?: number
  /** drop the warm half of MASTER_PALETTE before quantizing (see coolPalette) */
  coolOnly?: boolean
  /** drop only the pink/purple entries, keeping the sandy ramp (see noRosePalette) */
  noRose?: boolean
}

// Quantizing a green-grey midtone against the WHOLE palette lets it snap to dusty rose or
// ember, which is why the graded grass came out flecked with pink at 1x. A ground that is
// green has no business borrowing the warm ramp, so grass quantizes against the palette
// minus its warm entries. Everything else keeps the full palette.
export function coolPalette(): ReturnType<typeof paletteRgb> {
  return paletteRgb().filter((p) => p[0] <= p[1] + 18)
}

// A stone road is warm, so it cannot use the grass filter — it needs its sandy ramp. What it
// must not borrow is the ROSE ramp, which is what speckled road segments and the plaza's north
// edge pink. Pinks and the purple sit where red leads green but green does NOT lead blue;
// tans and golds have green well clear of blue, so this keeps every road tone.
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
  // The calm variant came back almost FLAT — 90.6% a single palette entry at SD 8 — and a
  // large flat warm tan against a sage field reads chromatic (the "salmon" stretch), even
  // though the material contains no rose whatever: it is v1's own ROAD_BASE and ROAD_EDGE
  // plus two neutral greys. So it is nudged UP, to keep some grit while staying far under
  // the plaza cobble's SD 28.
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
// tiles used, so alignment (four edge midpoints opaque, four square corners clear) is
// unchanged and every downstream consumer keeps working.
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

// C13's road geometry is correct and tested; this re-skins it. The painted tile is used as
// an ALPHA STENCIL and the generated road surface fills it, so every junction is cut from
// the same surface and the lattice reads as one road.
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

// Seasonal grading taken from GENERATED art rather than from D-3's hand-guessed tints: the
// per-channel ratio between a season's own material and the summer one.
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
