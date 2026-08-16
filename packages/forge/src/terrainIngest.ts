import {
  ROAD_AUTOTILE_KEYS, SEASONS, TERRAIN_TILE_KINDS, roadAutotileKind,
  type AssetRecord, type Season, type TerrainTileKind,
} from '@sj/shared'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AssetCodex } from './codex.js'
import { decodePng, encodePng, type RawImage } from './post/raw.js'
import { quantize } from './post/quantize.js'
import { paletteRgb } from './palette.js'
import { applyTint } from './tints.js'
import {
  SHEET_COLS, SHEET_ROWS, TERRAIN_TILE_H, TERRAIN_TILE_W, TERRAIN_VARIANTS, SHEET_KINDS,
  paintTerrainTile,
} from './terrainTiles.js'
import {
  GROUND_VARIANTS, ROAD_MATERIAL_ID, diamondFromMaterial, seasonTintFrom, stencilRoadTile,
  terrainAssetId,
} from './terrainGen.js'
import { paintRoadAutotile } from './roadTiles.js'

// The generated art, keyed by the program's asset id. A missing material is not an error:
// the code-painted tile stands in, so the town never loses its ground because one call
// failed. Art independence, the same law the ground bake already lives by.
export type MaterialBook = ReadonlyMap<string, RawImage>

export function materialFor(book: MaterialBook, assetId: string): RawImage | null {
  return book.get(assetId) ?? null
}

// The generated materials ship WITH the repo, beside the sheets they grade, because the
// gateway registers them into the codex at boot — the renderer reads the codex, not the
// manifest. Filenames are the asset id with ':' swapped for '_', so the mapping is obvious
// on disk and reversible without a side table.
export const MATERIALS_DIR =
  join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'tilesets', 'materials')

export async function loadMaterialBook(dir: string = MATERIALS_DIR): Promise<Map<string, RawImage>> {
  const book = new Map<string, RawImage>()
  if (!existsSync(dir)) return book        // no generated art yet — the painted tiles stand
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.png')) continue
    book.set(file.replace(/\.png$/, '').replace(/_/g, ':'), await decodePng(readFileSync(join(dir, file))))
  }
  return book
}

// VARIANT COHESION. The renderer picks a variant per tile by hash, so any difference in
// average TONE between a kind's variants renders as a harlequin checkerboard — four clearly
// different colours tiled at random. Seen at lattice scale in the first preview: the four
// grass variants came back pale sage, dark green, mid green and sandy tan, and the field
// looked far worse than the flat colour it replaced. Neither the seam check nor the frame
// check nor the eye can see this, because it does not exist inside one tile.
//
// Variants exist to break up REPETITION, not to add COLOUR. So each variant is shifted onto
// the kind's mean tone and re-quantized: the grain survives, the patchwork does not.
export const VARIANT_TONE_TOLERANCE = 4      // mean per-channel distance considered cohesive

const meanRgb = (m: RawImage): [number, number, number] => {
  let r = 0, g = 0, b = 0, n = 0
  for (let i = 0; i < m.data.length; i += 4) { r += m.data[i]!; g += m.data[i + 1]!; b += m.data[i + 2]!; n++ }
  return n === 0 ? [0, 0, 0] : [r / n, g / n, b / n]
}

export function variantSpread(variants: RawImage[]): number {
  if (variants.length < 2) return 0
  const means = variants.map(meanRgb)
  const kind = [0, 1, 2].map((k) => means.reduce((s2, m) => s2 + m[k]!, 0) / means.length)
  return Math.max(...means.map((m) => [0, 1, 2].reduce((s2, k) => s2 + Math.abs(m[k]! - kind[k]!), 0) / 3))
}

export function cohereVariants(variants: RawImage[]): RawImage[] {
  if (variants.length < 2) return variants
  const means = variants.map(meanRgb)
  const kind = [0, 1, 2].map((k) => means.reduce((s2, m) => s2 + m[k]!, 0) / means.length)
  return variants.map((v, i) => {
    const shift = [0, 1, 2].map((k) => kind[k]! - means[i]![k]!)
    const out: RawImage = { width: v.width, height: v.height, data: new Uint8ClampedArray(v.data) }
    for (let j = 0; j < out.data.length; j += 4) {
      for (let k = 0; k < 3; k++) out.data[j + k] = Math.round(v.data[j + k]! + shift[k]!)
    }
    return quantize(out, paletteRgb())
  })
}

// One ground tile: the generated material cut to the dimetric diamond, or the code-painted
// tile when that material was never generated.
export function groundTile(book: MaterialBook, kind: TerrainTileKind, variant: number): RawImage {
  const m = materialFor(book, terrainAssetId({ sort: 'ground', kind, variant }))
  return m === null ? paintTerrainTile(kind, variant) : diamondFromMaterial(m)
}

export type TerrainIngestReport = {
  registered: number; generated: number; painted: number
  kinds: string[]
}

// Registers into EXACTLY the codex kinds the renderer already reads — `grass`…`road` for the
// flat variants and `road:<key>` for the autotile strip — so generated art hot-swaps and the
// renderer contract does not move.
export async function registerGeneratedTerrain(
  codex: AssetCodex, book: MaterialBook,
): Promise<{ records: AssetRecord[]; report: TerrainIngestReport }> {
  const records: AssetRecord[] = []
  const kinds: string[] = []
  let generated = 0, painted = 0

  const meta = (kind: TerrainTileKind, variant: number): string => JSON.stringify(
    { version: 'v1-terrain-tile', kind, variant, wPx: TERRAIN_TILE_W, hPx: TERRAIN_TILE_H },
  )
  const put = async (kind: string, metaJson: string, img: RawImage, desc: string): Promise<void> => {
    records.push(codex.register({
      class: 'terrain', desc, kind, meta: metaJson, footprint: { w: 1, h: 1 },
      png: await encodePng(img), widthPx: TERRAIN_TILE_W, heightPx: TERRAIN_TILE_H,
      status: 'ready', score: 10, attempts: 1, costUsd: 0,
    }))
    kinds.push(kind)
  }

  for (const kind of TERRAIN_TILE_KINDS) {
    const made = Array.from({ length: GROUND_VARIANTS[kind] }, (_, v) =>
      materialFor(book, terrainAssetId({ sort: 'ground', kind, variant: v })))
    const present = made.filter((m): m is RawImage => m !== null)
    const cohered = cohereVariants(present)
    let seen = -1
    const coheredFor = made.map((m) => (m === null ? null : cohered[++seen]!))

    for (let variant = 0; variant < TERRAIN_VARIANTS; variant++) {
      // a kind generated with fewer variants than the renderer asks for reuses its last one
      const source = Math.min(variant, GROUND_VARIANTS[kind] - 1)
      const m = coheredFor[source] ?? null
      if (m === null) painted++
      else generated++
      const img = m === null ? paintTerrainTile(kind, variant) : diamondFromMaterial(m)
      await put(kind, meta(kind, variant), img, `tile: ${kind}`)
    }
  }

  // All fifteen shapes are cut from ONE road surface, so the lattice is one road. Without a
  // generated surface they are C13's painted cells — every key is always registered, because
  // a missing `road:<key>` record drops the whole lattice back to flat variants.
  const road = materialFor(book, ROAD_MATERIAL_ID)
  for (const key of ROAD_AUTOTILE_KEYS) {
    if (road === null) painted++
    else generated++
    const img = road === null ? paintRoadAutotile(key) : stencilRoadTile(road, key)
    await put(roadAutotileKind(key), meta('road', 0), img, `road tile: ${key}`)
  }

  return { records, report: { registered: records.length, generated, painted, kinds } }
}

// ------------------------------------------------------------------ seasonal sheets

// D-3 shipped four seasonal sheets tinted by hand-guessed ratios. These are graded from the
// GENERATED seasonal materials instead: the tint is measured off real art, then applied to
// the generated ground and re-quantized so the sheet stays palette-true.
export function seasonSheetFrom(book: MaterialBook, season: Season): RawImage {
  const width = SHEET_COLS * TERRAIN_TILE_W, height = SHEET_ROWS * TERRAIN_TILE_H
  const sheet: RawImage = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  const seasonMat = materialFor(book, terrainAssetId({ sort: 'season', season }))
  const summerMat = materialFor(book, terrainAssetId({ sort: 'season', season: 'summer' }))
  const tint = seasonMat === null || summerMat === null ? null : seasonTintFrom(seasonMat, summerMat)

  SHEET_KINDS.forEach((kind, row) => {
    for (let col = 0; col < TERRAIN_VARIANTS; col++) {
      const tile = groundTile(book, kind, col)
      for (let y = 0; y < TERRAIN_TILE_H; y++) {
        const src = (y * TERRAIN_TILE_W) * 4
        sheet.data.set(
          tile.data.subarray(src, src + TERRAIN_TILE_W * 4),
          ((row * TERRAIN_TILE_H + y) * width + col * TERRAIN_TILE_W) * 4,
        )
      }
    }
  })
  return tint === null ? sheet : quantize(applyTint(sheet, tint))
}

export function seasonSheets(book: MaterialBook): Record<Season, RawImage> {
  return Object.fromEntries(SEASONS.map((s) => [s, seasonSheetFrom(book, s)])) as Record<Season, RawImage>
}
