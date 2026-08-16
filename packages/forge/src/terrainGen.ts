import {
  ROAD_AUTOTILE_KEYS, SEASONS, TERRAIN_TILE_KINDS,
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

// A generated 512 square lands on this grid before anything else touches it. 64 is four
// tile-widths of detail — enough for grain, small enough that MASTER_PALETTE reads as
// deliberate colour rather than as banding.
export const MATERIAL_PX = 64

// Mean per-channel distance between opposing edges, 0-255. A stochastic ground material
// wraps well under 12; a hard cut runs to the tens. Judged on the QUANTIZED material, so one
// palette step (~16) is the unit this is measured in.
export const SEAM_TOLERANCE = 12

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

// grass earns four readings because it is most of the map and repetition shows there first;
// every other ground gets one, because a second reading of bedrock is not worth a call.
export const GROUND_VARIANTS: Record<TerrainTileKind, number> = {
  grass: 4, earth: 1, water: 1, forest: 1, rock: 1, sand: 1, farmland: 1, road: 1,
}

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
export function materialFromCandidate(candidate: RawImage, px: number = MATERIAL_PX): RawImage {
  const kx = Math.max(1, Math.floor(candidate.width / px))
  const ky = Math.max(1, Math.floor(candidate.height / px))
  const out: RawImage = { width: px, height: px, data: new Uint8ClampedArray(px * px * 4) }
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      let r = 0, g = 0, b = 0, n = 0
      for (let sy = y * ky; sy < (y + 1) * ky && sy < candidate.height; sy++) {
        for (let sx = x * kx; sx < (x + 1) * kx && sx < candidate.width; sx++) {
          const i = (sy * candidate.width + sx) * 4
          r += candidate.data[i]!; g += candidate.data[i + 1]!; b += candidate.data[i + 2]!; n++
        }
      }
      const d = (y * px + x) * 4
      if (n === 0) { out.data.set([0, 0, 0, 255], d); continue }
      out.data.set([Math.round(r / n), Math.round(g / n), Math.round(b / n), 255], d)
    }
  }
  const q = quantize(out, paletteRgb())
  for (let i = 3; i < q.data.length; i += 4) q.data[i] = 255   // ground is never see-through
  return q
}

export type SeamReport = {
  horizontalDelta: number; verticalDelta: number
  worstAxis: 'horizontal' | 'vertical'; pass: boolean; note: string
}

const meanChannelDelta = (
  img: RawImage, a: (k: number) => number, b: (k: number) => number, n: number,
): number => {
  let sum = 0
  for (let k = 0; k < n; k++) {
    const i = a(k) * 4, j = b(k) * 4
    sum += (Math.abs(img.data[i]! - img.data[j]!) + Math.abs(img.data[i + 1]! - img.data[j + 1]!)
      + Math.abs(img.data[i + 2]! - img.data[j + 2]!)) / 3
  }
  return sum / n
}

// Deterministic seam check: a tile that wraps has a left column close to its right column and
// a top row close to its bottom row, because in a repeat those are neighbours.
export function seamReport(m: RawImage): SeamReport {
  const w = m.width, h = m.height
  const horizontalDelta = meanChannelDelta(m, (y) => y * w, (y) => y * w + (w - 1), h)
  const verticalDelta = meanChannelDelta(m, (x) => x, (x) => (h - 1) * w + x, w)
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
