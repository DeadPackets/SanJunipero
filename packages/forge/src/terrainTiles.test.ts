import { describe, it, expect } from 'vitest'
import {
  ROAD_AUTOTILE_KEYS,
  SEASONS,
  TERRAIN_TILE_KINDS,
  parseTerrainTileManifest,
  roadAutotileKind,
} from '@sj/shared'
import { MASTER_PALETTE } from './palette.js'
import { openForgeDb } from './db.js'
import { AssetCodex } from './codex.js'
import {
  SCAFFOLD_H,
  SCAFFOLD_W,
  SHEET_COLS,
  SHEET_KINDS,
  SHEET_ROWS,
  TERRAIN_COLORS,
  TERRAIN_TILE_H,
  TERRAIN_TILE_W,
  TERRAIN_VARIANTS,
  paintScaffolding,
  paintSeasonSheet,
  paintTerrainTile,
  registerRoadAutotiles,
  registerTerrainTiles,
  seasonTileNames,
} from './terrainTiles.js'

const PALETTE_HEXES = new Set(MASTER_PALETTE.map((h) => parseInt(h.slice(1), 16)))
const at = (img: { width: number; data: Uint8ClampedArray }, x: number, y: number): number[] => [
  ...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4),
]

describe('paintTerrainTile', () => {
  it('paints one 32x16 dimetric diamond', () => {
    const t = paintTerrainTile('grass', 0)
    expect([t.width, t.height]).toEqual([TERRAIN_TILE_W, TERRAIN_TILE_H])
    expect(t.data.length).toBe(TERRAIN_TILE_W * TERRAIN_TILE_H * 4)
  })

  it('fills the four diamond edge midpoints and the centre, and leaves the square corners clear', () => {
    const t = paintTerrainTile('grass', 0)
    for (const [x, y] of [
      [16, 0],
      [16, 15],
      [0, 7],
      [31, 7],
      [16, 8],
    ] as const)
      expect(at(t, x, y)[3]).toBe(255)
    for (const [x, y] of [
      [0, 0],
      [31, 0],
      [0, 15],
      [31, 15],
    ] as const)
      expect(at(t, x, y)[3]).toBe(0)
  })

  it('paints every kind and variant out of MASTER_PALETTE only (palette law)', () => {
    for (const kind of TERRAIN_TILE_KINDS) {
      for (let v = 0; v < TERRAIN_VARIANTS; v++) {
        const t = paintTerrainTile(kind, v)
        for (let i = 0; i < t.data.length; i += 4) {
          if (t.data[i + 3] === 0) continue
          expect(t.data[i + 3]).toBe(255) // no partial alpha — pixel art has hard edges
          expect(PALETTE_HEXES).toContain(
            (t.data[i]! << 16) | (t.data[i + 1]! << 8) | t.data[i + 2]!,
          )
        }
      }
    }
  })

  it('is deterministic and gives each variant its own speckle', () => {
    expect(paintTerrainTile('grass', 2).data).toEqual(paintTerrainTile('grass', 2).data)
    const crop = (v: number): string => {
      const t = paintTerrainTile('grass', v)
      const out: number[] = []
      for (let y = 6; y < 10; y++) for (let x = 12; x < 20; x++) out.push(...at(t, x, y))
      return out.join(',')
    }
    expect(new Set([0, 1, 2, 3].map(crop)).size).toBe(TERRAIN_VARIANTS)
  })

  it('keeps road visually distinct from grass and dirt (visual-distinctness law)', () => {
    expect(TERRAIN_COLORS.road.base).toBe(0xd4bc9e)
    expect(TERRAIN_COLORS.grass.base).toBe(0x93b573)
    expect(TERRAIN_COLORS.road.base).not.toBe(TERRAIN_COLORS.earth.base)
    expect(at(paintTerrainTile('road', 0), 16, 8)).toEqual([0xd4, 0xbc, 0x9e, 255])
  })
})

describe('registerTerrainTiles', () => {
  it('registers every kind × variant as a ready terrain record with a parseable manifest', async () => {
    const db = openForgeDb(':memory:')
    try {
      const recs = await registerTerrainTiles(new AssetCodex(db))
      const flat = recs.filter((r) => !r.kind!.startsWith('road:'))
      expect(flat).toHaveLength(TERRAIN_TILE_KINDS.length * TERRAIN_VARIANTS)
      expect(
        recs.every((r) => r.class === 'terrain' && r.status === 'ready' && r.costUsd === 0),
      ).toBe(true)
      const manifests = flat.map((r) => parseTerrainTileManifest(r.meta))
      expect(manifests.every((m) => m !== null)).toBe(true)
      expect(new Set(manifests.map((m) => `${m!.kind}/${m!.variant}`)).size).toBe(flat.length)
      const road = recs.filter((r) => r.kind === 'road')
      expect(road).toHaveLength(TERRAIN_VARIANTS) // TileId 7 is painted like every other tile
      expect(road[0]!.widthPx).toBe(TERRAIN_TILE_W)
    } finally {
      db.close()
    }
  })

  it('is byte-identical across two fresh codexes (pure painter, $0)', async () => {
    const a = openForgeDb(':memory:'),
      b = openForgeDb(':memory:')
    try {
      const ca = new AssetCodex(a),
        cb = new AssetCodex(b)
      const ra = await registerTerrainTiles(ca),
        rb = await registerTerrainTiles(cb)
      for (let i = 0; i < ra.length; i++) {
        expect(ca.get(ra[i]!.id)!.png.equals(cb.get(rb[i]!.id)!.png)).toBe(true)
      }
    } finally {
      a.close()
      b.close()
    }
  })
})

describe('registerRoadAutotiles', () => {
  it("ingests C13's 15-tile strip as 15 distinct codex records under roadAutotileKind", async () => {
    const db = openForgeDb(':memory:')
    try {
      const codex = new AssetCodex(db)
      const recs = await registerRoadAutotiles(codex)
      expect(recs).toHaveLength(ROAD_AUTOTILE_KEYS.length)
      expect(
        recs.every((r) => r.class === 'terrain' && r.status === 'ready' && r.costUsd === 0),
      ).toBe(true)
      expect(recs.map((r) => r.kind)).toEqual(ROAD_AUTOTILE_KEYS.map(roadAutotileKind))
      expect(new Set(recs.map((r) => r.id)).size).toBe(ROAD_AUTOTILE_KEYS.length)
      // 15 shapes, 15 different pictures — a strip that ingested one cell fifteen times
      // would render every junction as the same stub and nothing would catch it.
      expect(new Set(recs.map((r) => codex.get(r.id)!.png.toString('base64'))).size).toBe(
        ROAD_AUTOTILE_KEYS.length,
      )
      expect(recs.every((r) => r.widthPx === TERRAIN_TILE_W && r.heightPx === TERRAIN_TILE_H)).toBe(
        true,
      )
    } finally {
      db.close()
    }
  })

  it('carries a parseable terrain manifest so the renderer can size the cell', async () => {
    const db = openForgeDb(':memory:')
    try {
      const recs = await registerRoadAutotiles(new AssetCodex(db))
      for (const r of recs) {
        const m = parseTerrainTileManifest(r.meta)
        expect(m).not.toBeNull()
        expect(m!.kind).toBe('road')
        expect([m!.wPx, m!.hPx]).toEqual([TERRAIN_TILE_W, TERRAIN_TILE_H])
      }
    } finally {
      db.close()
    }
  })

  it('rides along with registerTerrainTiles, so one ingest call textures every road', async () => {
    const db = openForgeDb(':memory:')
    try {
      const recs = await registerTerrainTiles(new AssetCodex(db))
      const kinds = new Set(recs.map((r) => r.kind))
      for (const key of ROAD_AUTOTILE_KEYS) expect(kinds).toContain(roadAutotileKind(key))
      expect(recs).toHaveLength(
        TERRAIN_TILE_KINDS.length * TERRAIN_VARIANTS + ROAD_AUTOTILE_KEYS.length,
      )
    } finally {
      db.close()
    }
  })
})

describe('seasonal sheets', () => {
  it('names exactly 16 tiles for the 4x4 sheet grid', () => {
    const names = seasonTileNames()
    expect(names).toHaveLength(SHEET_COLS * SHEET_ROWS)
    expect(new Set(names).size).toBe(names.length)
    expect(names[0]).toBe('grass-0')
    expect(SHEET_KINDS).toContain('road')
  })

  const offPalette = (sheet: { data: Uint8ClampedArray }): number => {
    let n = 0
    for (let i = 0; i < sheet.data.length; i += 4) {
      if (sheet.data[i + 3] === 0) continue
      if (
        !PALETTE_HEXES.has((sheet.data[i]! << 16) | (sheet.data[i + 1]! << 8) | sheet.data[i + 2]!)
      )
        n++
    }
    return n
  }

  it('paints a 128x64 sheet per season, and the seasons differ', () => {
    const sheets = SEASONS.map((s) => paintSeasonSheet(s))
    for (const sheet of sheets) {
      expect([sheet.width, sheet.height]).toEqual([
        SHEET_COLS * TERRAIN_TILE_W,
        SHEET_ROWS * TERRAIN_TILE_H,
      ])
    }
    expect(new Set(sheets.map((s) => s.data.join(','))).size).toBe(SEASONS.length)
  })

  // Ruling 13: no palette quantize anywhere. Summer's tint is the identity, so its sheet is
  // still palette-true — the painter paints FROM the palette; the other three keep their tint.
  it('★ keeps the colour the tint gave it — nothing snaps back to MASTER_PALETTE', () => {
    expect(offPalette(paintSeasonSheet('summer'))).toBe(0)
    for (const season of ['spring', 'autumn', 'winter'] as const) {
      expect(offPalette(paintSeasonSheet(season)), season).toBeGreaterThan(0)
    }
  })
})

describe('paintScaffolding', () => {
  it('paints a transparent-backed timber frame', () => {
    const s = paintScaffolding()
    expect([s.width, s.height]).toEqual([SCAFFOLD_W, SCAFFOLD_H])
    expect(at(s, 0, 0)[3]).toBe(0)
    expect(at(s, 6, 16)[3]).toBe(255) // west post
    expect(at(s, 25, 16)[3]).toBe(255) // east post
    expect(at(s, 16, 8)[3]).toBe(255) // upper rail
    expect(paintScaffolding().data).toEqual(s.data)
  })
})
