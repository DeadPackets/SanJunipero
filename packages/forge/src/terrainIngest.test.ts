import { describe, expect, it } from 'vitest'
import {
  ROAD_AUTOTILE_KEYS, SEASONS, TERRAIN_TILE_KINDS, materialKind, parseTerrainTileManifest,
  roadAutotileKind,
} from '@sj/shared'
import { MASTER_PALETTE } from './palette.js'
import { openForgeDb } from './db.js'
import { AssetCodex } from './codex.js'
import { decodePng, type RawImage } from './post/raw.js'
import {
  SHEET_COLS, SHEET_ROWS, TERRAIN_TILE_H, TERRAIN_TILE_W, TERRAIN_VARIANTS, paintTerrainTile,
} from './terrainTiles.js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BORDER_TOLERANCE, MATERIAL_PX, ROAD_MATERIAL_ID, SEAM_TOLERANCE, borderReport, seamReport,
  terrainAssetId,
} from './terrainGen.js'
import { tileSeamGate } from './pixelGates.js'
import {
  MATERIALS_DIR, VARIANT_TONE_TOLERANCE, cohereVariants, groundTile, loadMaterialBook,
  registerGeneratedTerrain, seasonSheetFrom, seasonSheets, variantSpread,
} from './terrainIngest.js'

const PALETTE_HEXES = new Set(MASTER_PALETTE.map((h) => parseInt(h.slice(1), 16)))

// A GRAINY palette-true material — a flat fill would collapse to one picture under variant
// cohesion, and a real generated material never is flat. Grain is seeded per material.
function material(hex: number, px = MATERIAL_PX, seed = hex): RawImage {
  const img: RawImage = { width: px, height: px, data: new Uint8ClampedArray(px * px * 4) }
  const base = [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff]
  for (let i = 0; i < px * px; i++) {
    const h = (Math.imul(i + 1, 0x27d4eb2d) ^ Math.imul(seed + 1, 0x165667b1)) >>> 0
    const d = (h % 3) * 12 - 12                     // three tones of the same colour family
    img.data.set([base[0]! + d, base[1]! + d, base[2]! + d, 255], i * 4)
  }
  return img
}

function fullBook(): Map<string, RawImage> {
  const b = new Map<string, RawImage>()
  b.set(terrainAssetId({ sort: 'ground', kind: 'grass', variant: 0 }), material(0x93b573))
  b.set(terrainAssetId({ sort: 'ground', kind: 'grass', variant: 1 }), material(0x6f9455))
  b.set(terrainAssetId({ sort: 'ground', kind: 'grass', variant: 2 }), material(0xb9d19a))
  b.set(terrainAssetId({ sort: 'ground', kind: 'grass', variant: 3 }), material(0x4f7040))
  for (const kind of ['earth', 'water', 'forest', 'rock', 'sand', 'farmland', 'road'] as const) {
    b.set(terrainAssetId({ sort: 'ground', kind, variant: 0 }), material(0xc68a48))
  }
  for (const season of SEASONS) {
    b.set(terrainAssetId({ sort: 'season', season }), material(season === 'winter' ? 0x7fb0c9 : 0x93b573))
  }
  return b
}

describe('groundTile', () => {
  it('cuts the generated material to the dimetric diamond', () => {
    const t = groundTile(fullBook(), 'grass', 0)
    expect([t.width, t.height]).toEqual([TERRAIN_TILE_W, TERRAIN_TILE_H])
    expect(t.data[(8 * TERRAIN_TILE_W + 16) * 4 + 3]).toBe(255)     // centre opaque
    expect(t.data[3]).toBe(0)                                        // corner clear
  })

  it('falls back to the code-painted tile when that material was never generated — art independence', () => {
    const t = groundTile(new Map(), 'grass', 2)
    expect(Buffer.from(t.data)).toEqual(Buffer.from(paintTerrainTile('grass', 2).data))
  })
})

describe('registerGeneratedTerrain', () => {
  it('lands on exactly the codex kinds the renderer already reads', async () => {
    const db = openForgeDb(':memory:')
    try {
      const { records, report } = await registerGeneratedTerrain(new AssetCodex(db), fullBook())
      const kinds = new Set(records.map((r) => r.kind))
      for (const k of TERRAIN_TILE_KINDS) expect(kinds, k).toContain(k)
      for (const key of ROAD_AUTOTILE_KEYS) expect(kinds, key).toContain(roadAutotileKind(key))
      // v2: one continuous material per ground, PLUS the per-tile fallback set and the strip
      expect(records).toHaveLength(
        TERRAIN_TILE_KINDS.length                                   // material:<kind>
        + TERRAIN_TILE_KINDS.length * TERRAIN_VARIANTS              // flat fallback variants
        + ROAD_AUTOTILE_KEYS.length)
      expect(report.painted).toBe(0)
      expect(report.generated).toBe(records.length)
      expect(records.every((r) => r.class === 'terrain' && r.status === 'ready' && r.costUsd === 0)).toBe(true)
    } finally { db.close() }
  })

  it('keeps a parseable terrain manifest on every flat variant', async () => {
    const db = openForgeDb(':memory:')
    try {
      const { records } = await registerGeneratedTerrain(new AssetCodex(db), fullBook())
      for (const r of records) {
        if (r.kind!.startsWith('road:') || r.kind!.startsWith('material:')) continue
        const m = parseTerrainTileManifest(r.meta)
        expect(m, r.kind ?? '?').not.toBeNull()
        expect([m!.wPx, m!.hPx]).toEqual([TERRAIN_TILE_W, TERRAIN_TILE_H])
      }
    } finally { db.close() }
  })

  it('reuses a kind\'s last generated variant when the renderer wants four and one was made', async () => {
    const db = openForgeDb(':memory:')
    try {
      const codex = new AssetCodex(db)
      const { records } = await registerGeneratedTerrain(codex, fullBook())
      const rock = records.filter((r) => r.kind === 'rock')   // the flat fallback set
      expect(rock).toHaveLength(TERRAIN_VARIANTS)
      // one generated rock material → four identical pictures under four variant manifests
      const pngs = rock.map((r) => codex.get(r.id)!.png.toString('base64'))
      expect(new Set(pngs).size).toBe(1)
      expect(rock.map((r) => parseTerrainTileManifest(r.meta)!.variant)).toEqual([0, 1, 2, 3])
    } finally { db.close() }
  })

  it('registers ONE continuous material per ground, which is what the bake samples', async () => {
    const db = openForgeDb(':memory:')
    try {
      const codex = new AssetCodex(db)
      const { records } = await registerGeneratedTerrain(codex, fullBook())
      for (const kind of TERRAIN_TILE_KINDS) {
        const mats = records.filter((r) => r.kind === materialKind(kind))
        expect(mats, kind).toHaveLength(1)
        expect(codex.get(mats[0]!.id)!.png.length).toBeGreaterThan(0)
      }
    } finally { db.close() }
  })

  it('cuts all fifteen road shapes from ONE surface, and paints them without it', async () => {
    const withRoad = openForgeDb(':memory:'), without = openForgeDb(':memory:')
    try {
      const a = await registerGeneratedTerrain(new AssetCodex(withRoad), fullBook())
      expect(a.records.filter((r) => r.kind!.startsWith('road:'))).toHaveLength(15)

      const bookNoRoad = fullBook()
      bookNoRoad.delete(ROAD_MATERIAL_ID)
      const b = await registerGeneratedTerrain(new AssetCodex(without), bookNoRoad)
      // every key is ALWAYS registered — a missing road:<key> record drops the whole
      // lattice back to flat variants, which is the bug fix round 2 just closed
      expect(b.records.filter((r) => r.kind!.startsWith('road:'))).toHaveLength(15)
      expect(b.report.painted).toBeGreaterThanOrEqual(15)
    } finally { withRoad.close(); without.close() }
  })

  it('registers the code-painted set unchanged when nothing was generated at all', async () => {
    const db = openForgeDb(':memory:')
    try {
      const { records, report } = await registerGeneratedTerrain(new AssetCodex(db), new Map())
      // no materials at all → no material records, just the code-painted fallback set
      expect(records).toHaveLength(TERRAIN_TILE_KINDS.length * TERRAIN_VARIANTS + ROAD_AUTOTILE_KEYS.length)
      expect(report.generated).toBe(0)
    } finally { db.close() }
  })
})

describe('seasonSheetFrom', () => {
  it('is the 4x4 sheet at the manifest grid, palette-true', () => {
    const s = seasonSheetFrom(fullBook(), 'autumn')
    expect([s.width, s.height]).toEqual([SHEET_COLS * TERRAIN_TILE_W, SHEET_ROWS * TERRAIN_TILE_H])
    for (let i = 0; i < s.data.length; i += 4) {
      if (s.data[i + 3] === 0) continue
      expect(PALETTE_HEXES).toContain((s.data[i]! << 16) | (s.data[i + 1]! << 8) | s.data[i + 2]!)
    }
  })

  it('grades each season off the GENERATED seasonal material, so the four differ', () => {
    const sheets = seasonSheets(fullBook())
    const keys = SEASONS.map((s) => Buffer.from(sheets[s].data).toString('base64'))
    expect(new Set(keys).size).toBeGreaterThan(1)
    // winter's material is blue; summer's is green — the two sheets cannot be the same bytes
    expect(keys[SEASONS.indexOf('winter')]).not.toBe(keys[SEASONS.indexOf('summer')])
  })

  it('still builds a sheet when no season was generated — the ungraded ground stands', () => {
    const s = seasonSheetFrom(new Map(), 'winter')
    expect([s.width, s.height]).toEqual([SHEET_COLS * TERRAIN_TILE_W, SHEET_ROWS * TERRAIN_TILE_H])
  })

  it('is deterministic', () => {
    const book = fullBook()
    expect(Buffer.from(seasonSheetFrom(book, 'spring').data))
      .toEqual(Buffer.from(seasonSheetFrom(book, 'spring').data))
  })
})


// Whatever ships in content/tilesets/materials is what the town's ground looks like, so it meets
// the same two measurements the generator gates on. An empty directory is a valid state.
describe('the shipped materials', () => {
  // A material that had to be deframed is allowed a looser wrap, because cropping a square breaks
  // its own edges. `provenance.json` is read from the shipped state, not a hand-kept list.
  const DEFRAMED_SEAM_TOLERANCE = 20

  it('none of them is a drawn frame, and every one wraps as well as its crop allows', async () => {
    const book = await loadMaterialBook()
    const provPath = join(MATERIALS_DIR, 'provenance.json')
    const prov = existsSync(provPath)
      ? JSON.parse(readFileSync(provPath, 'utf8')) as Record<string, { deframed: number }>
      : {}
    for (const [assetId, img] of book) {
      const seam = seamReport(img), border = borderReport(img)
      expect(border.framed, `${assetId}: ${border.note}`).toBe(false)
      expect(border.ringDelta, assetId).toBeLessThanOrEqual(BORDER_TOLERANCE)
      const deframed = (prov[assetId]?.deframed ?? 0) > 0
      const limit = deframed ? DEFRAMED_SEAM_TOLERANCE : SEAM_TOLERANCE
      expect(Math.max(seam.horizontalDelta, seam.verticalDelta),
        `${assetId}${deframed ? ' (deframed)' : ''}: ${seam.note}`).toBeLessThanOrEqual(limit)
    }
  })

  // The absolute check above is blind on smooth ground: earth wrapped at 2.9 against a tolerance
  // of 14 with the line plainly there. The wrap has to be as quiet as the grain.
  it('wraps as quietly as its own grain, which is the only bar a smooth material can fail', async () => {
    const book = await loadMaterialBook()
    for (const [assetId, img] of book) {
      const bar = tileSeamGate(img)
      expect(bar.failures.join('; '), assetId).toBe('')
    }
  })

  it('says in the shipped state which materials had to be cropped', async () => {
    const provPath = join(MATERIALS_DIR, 'provenance.json')
    if (!existsSync(provPath)) return                  // no generated art on this machine
    const prov = JSON.parse(readFileSync(provPath, 'utf8')) as Record<string, { deframed: number }>
    const book = await loadMaterialBook()
    for (const assetId of book.keys()) expect(prov[assetId], assetId).toBeDefined()
  })

  it('is square, named for the asset it is, and full size for anything the ground samples', async () => {
    const book = await loadMaterialBook()
    for (const [assetId, img] of book) {
      expect(img.width, assetId).toBe(img.height)
      expect(assetId, `${assetId} is not a program asset id`).toMatch(/^terrain:[a-z0-9:\-]+$/)
      // a GROUND material is what the continuous bake samples, so it carries the fidelity;
      // a season material is only a grading reference (a mean colour) and needs no size
      if (assetId.startsWith('terrain:season:')) continue
      expect(img.width, `${assetId} is not at the material grid`).toBe(MATERIAL_PX)
    }
  })

  it('loads an empty book from a directory that is not there — art independence', async () => {
    expect((await loadMaterialBook(`${MATERIALS_DIR}-does-not-exist`)).size).toBe(0)
  })
})


// The renderer picks a variant per tile by hash, so any difference in average TONE between a
// kind's variants renders as a harlequin checkerboard, invisible inside any one tile.
describe('variant cohesion', () => {
  const four = [0x93b573, 0x4f7040, 0xb9d19a, 0xe8d5bc].map((h) => material(h))

  it('measures the spread that made the field look like a harlequin', () => {
    expect(variantSpread(four)).toBeGreaterThan(VARIANT_TONE_TOLERANCE)
  })

  it('pulls every variant onto the kind\'s tone', () => {
    expect(variantSpread(cohereVariants(four))).toBeLessThanOrEqual(VARIANT_TONE_TOLERANCE)
  })

  it('keeps the grain — cohesion moves tone, it does not flatten texture', () => {
    const grainy = (seed: number): RawImage => {
      const px = MATERIAL_PX
      const img: RawImage = { width: px, height: px, data: new Uint8ClampedArray(px * px * 4) }
      for (let i = 0; i < px * px; i++) {
        const h = (Math.imul(i + seed, 0x27d4eb2d) >>> 0) % 3
        const c = [0x93b573, 0x6f9455, 0xb9d19a][h]!
        img.data.set([(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff, 255], i * 4)
      }
      return img
    }
    const before = grainy(1)
    const [after] = cohereVariants([before, material(0x4f7040)])
    expect(new Set(Array.from({ length: 200 }, (_, i) => after!.data[i * 4])).size).toBeGreaterThan(1)
  })

  it('leaves a single variant alone and never crashes on none', () => {
    const one = [material(0x93b573)]
    expect(cohereVariants(one)).toEqual(one)
    expect(cohereVariants([])).toEqual([])
    expect(variantSpread([])).toBe(0)
  })

  it('is deterministic', () => {
    expect(cohereVariants(four).map((m) => Buffer.from(m.data).toString('base64')))
      .toEqual(cohereVariants(four).map((m) => Buffer.from(m.data).toString('base64')))
  })

  // There are no per-tile variants left to disagree in tone. Cohesion stays as the guard on the
  // FALLBACK set, which reuses one material, so the spread is zero by construction.
  it('leaves the fallback set in one tone, because v2 has one material per ground', async () => {
    const db = openForgeDb(':memory:')
    try {
      const codex = new AssetCodex(db)
      const { records } = await registerGeneratedTerrain(codex, fullBook())
      const grass = records.filter((r) => r.kind === 'grass')
      expect(grass).toHaveLength(4)
      const imgs = await Promise.all(grass.map(async (r) => decodePng(codex.get(r.id)!.png)))
      expect(variantSpread(imgs)).toBe(0)
      expect(variantSpread(imgs)).toBeLessThanOrEqual(VARIANT_TONE_TOLERANCE)
    } finally { db.close() }
  })
})
