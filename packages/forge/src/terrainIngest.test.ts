import { describe, expect, it } from 'vitest'
import {
  ROAD_AUTOTILE_KEYS, SEASONS, TERRAIN_TILE_KINDS, parseTerrainTileManifest, roadAutotileKind,
} from '@sj/shared'
import { MASTER_PALETTE } from './palette.js'
import { openForgeDb } from './db.js'
import { AssetCodex } from './codex.js'
import type { RawImage } from './post/raw.js'
import {
  SHEET_COLS, SHEET_ROWS, TERRAIN_TILE_H, TERRAIN_TILE_W, TERRAIN_VARIANTS, paintTerrainTile,
} from './terrainTiles.js'
import {
  BORDER_TOLERANCE, MATERIAL_PX, ROAD_MATERIAL_ID, borderReport, seamReport, terrainAssetId,
} from './terrainGen.js'
import {
  MATERIALS_DIR, groundTile, loadMaterialBook, registerGeneratedTerrain, seasonSheetFrom,
  seasonSheets,
} from './terrainIngest.js'

const PALETTE_HEXES = new Set(MASTER_PALETTE.map((h) => parseInt(h.slice(1), 16)))

// a flat, palette-true material — stands in for a generated one
function material(hex: number, px = MATERIAL_PX): RawImage {
  const img: RawImage = { width: px, height: px, data: new Uint8ClampedArray(px * px * 4) }
  for (let i = 0; i < img.data.length; i += 4) {
    img.data.set([(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff, 255], i)
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
      expect(records).toHaveLength(TERRAIN_TILE_KINDS.length * TERRAIN_VARIANTS + ROAD_AUTOTILE_KEYS.length)
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
        if (r.kind!.startsWith('road:')) continue
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
      const rock = records.filter((r) => r.kind === 'rock')
      expect(rock).toHaveLength(TERRAIN_VARIANTS)
      // one generated rock material → four identical pictures under four variant manifests
      const pngs = rock.map((r) => codex.get(r.id)!.png.toString('base64'))
      expect(new Set(pngs).size).toBe(1)
      expect(rock.map((r) => parseTerrainTileManifest(r.meta)!.variant)).toEqual([0, 1, 2, 3])
    } finally { db.close() }
  })

  it('gives the four grass variants four DIFFERENT pictures', async () => {
    const db = openForgeDb(':memory:')
    try {
      const codex = new AssetCodex(db)
      const { records } = await registerGeneratedTerrain(codex, fullBook())
      const grass = records.filter((r) => r.kind === 'grass')
      expect(new Set(grass.map((r) => codex.get(r.id)!.png.toString('base64'))).size).toBe(4)
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


// Whatever ships in content/tilesets/materials is what the town's ground actually looks
// like, so it meets the same two measurements the generator gates on. An empty directory is
// a valid state (the code-painted tiles stand in) — but a material that IS there must wrap
// and must not be a framed card.
describe('the shipped materials', () => {
  it('every one wraps, and none of them is a drawn frame', async () => {
    const book = await loadMaterialBook()
    for (const [assetId, img] of book) {
      const seam = seamReport(img), border = borderReport(img)
      expect(seam.pass, `${assetId}: ${seam.note}`).toBe(true)
      expect(border.framed, `${assetId}: ${border.note}`).toBe(false)
      expect(border.ringDelta, assetId).toBeLessThanOrEqual(BORDER_TOLERANCE)
    }
  })

  it('is on the material grid, and named for the asset it is', async () => {
    const book = await loadMaterialBook()
    for (const [assetId, img] of book) {
      expect([img.width, img.height], assetId).toEqual([MATERIAL_PX, MATERIAL_PX])
      expect(assetId, `${assetId} is not a program asset id`).toMatch(/^terrain:[a-z0-9:\-]+$/)
    }
  })

  it('loads an empty book from a directory that is not there — art independence', async () => {
    expect((await loadMaterialBook(`${MATERIALS_DIR}-does-not-exist`)).size).toBe(0)
  })
})
