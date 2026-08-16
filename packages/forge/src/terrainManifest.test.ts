import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROAD_AUTOTILE_KEYS } from '@sj/shared'
import { decodePng } from './post/raw.js'
import { seasonTileNames } from './terrainTiles.js'
import { TilesetManifest, loadTilesetManifest } from './terrainManifest.js'

const names16 = Array.from({ length: 16 }, (_, i) => `tile-${i}`)
const manifest = {
  tileW: 32, tileH: 16, cols: 4, rows: 4,
  seasons: Object.fromEntries((['spring', 'summer', 'autumn', 'winter'] as const)
    .map(s => [s, { file: `${s}.png`, tiles: names16 }])),
  scaffolding: { file: 'scaffolding.png' },
}

describe('TilesetManifest', () => {
  it('accepts the 4-season 32x16 shape and rejects a missing season', () => {
    expect(TilesetManifest.parse(manifest).tileW).toBe(32)
    const { winter: _drop, ...three } = manifest.seasons as Record<string, unknown>
    expect(() => TilesetManifest.parse({ ...manifest, seasons: three })).toThrow()
  })
})

describe('loadTilesetManifest', () => {
  it('loads and verifies every referenced file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sj-tiles-'))
    try {
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
      for (const f of ['spring.png', 'summer.png', 'autumn.png', 'winter.png', 'scaffolding.png'])
        writeFileSync(join(dir, f), Buffer.from('png'))
      expect(loadTilesetManifest(dir).scaffolding.file).toBe('scaffolding.png')
      rmSync(join(dir, 'winter.png'))
      expect(() => loadTilesetManifest(dir)).toThrow(/winter\.png/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

const allTiles = Object.fromEntries(ROAD_AUTOTILE_KEYS.map((k, i) => [k, i]))
const withAutotile = { ...manifest, autotile: { road: { file: 'road-autotile.png', tiles: allTiles } } }

describe('TilesetManifest.autotile (additive, optional)', () => {
  it('C10 COMPAT: a manifest with no autotile block still parses', () => {
    const m = TilesetManifest.parse(manifest)
    expect(m.autotile).toBeUndefined()
  })

  it('accepts a complete 15-key road strip and keeps the exact column index', () => {
    const m = TilesetManifest.parse(withAutotile)
    expect(m.autotile!.road.tiles.cross).toBe(ROAD_AUTOTILE_KEYS.indexOf('cross'))
    expect(Object.keys(m.autotile!.road.tiles)).toHaveLength(15)
  })

  it('rejects 14 keys with the all-15 message', () => {
    const { cross: _drop, ...fourteen } = allTiles
    expect(() => TilesetManifest.parse({ ...manifest, autotile: { road: { file: 'r.png', tiles: fourteen } } }))
      .toThrow(/all 15 road tiles required/)
  })

  it('rejects an unknown tile key and a bad index', () => {
    expect(() => TilesetManifest.parse({ ...manifest, autotile: { road: { file: 'r.png', tiles: { ...allTiles, 'cap-x': 15 } } } })).toThrow()
    expect(() => TilesetManifest.parse({ ...manifest, autotile: { road: { file: 'r.png', tiles: { ...allTiles, cross: -1 } } } })).toThrow()
    expect(() => TilesetManifest.parse({ ...manifest, autotile: { road: { file: 'r.png', tiles: { ...allTiles, cross: 1.5 } } } })).toThrow()
    expect(() => TilesetManifest.parse({ ...withAutotile, autotile: { road: { file: 'r.png', tiles: allTiles }, extra: 1 } })).toThrow()
  })

  it('file-existence checking extends to the autotile strip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sj-tiles-'))
    try {
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(withAutotile))
      for (const f of ['spring.png', 'summer.png', 'autumn.png', 'winter.png', 'scaffolding.png'])
        writeFileSync(join(dir, f), Buffer.from('png'))
      expect(() => loadTilesetManifest(dir)).toThrow(/road-autotile\.png/)
      writeFileSync(join(dir, 'road-autotile.png'), Buffer.from('png'))
      expect(loadTilesetManifest(dir).autotile!.road.file).toBe('road-autotile.png')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

// C13 wrote the autotile block into the shipped manifest and left the rest for C10 T1.
// The merge is read-merge-write, so this is the guard that neither half ever overwrites
// the other: the real content directory must carry BOTH and still load.
describe('the shipped content/tilesets manifest', () => {
  it('carries the C10 seasons/scaffolding block AND the C13 autotile block', () => {
    const m = loadTilesetManifest()
    expect(Object.keys(m.seasons).sort()).toEqual(['autumn', 'spring', 'summer', 'winter'])
    for (const s of Object.values(m.seasons)) expect(s!.tiles).toHaveLength(16)
    expect(m.scaffolding.file).toBe('scaffolding.png')
    expect(m.tileW).toBe(32)
    expect(Object.keys(m.autotile!.road.tiles).sort()).toEqual([...ROAD_AUTOTILE_KEYS].sort())
  })

  // TASK C3: generated art replaces the pictures, never the keys. Whatever painted the
  // tiles, the renderer reads the same manifest — so this is the contract, not the art.
  it('keeps every key the renderer consumes, whoever painted the pixels', () => {
    const m = loadTilesetManifest()
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      expect(m.seasons[season]!.file).toBe(`${season}.png`)
      expect(m.seasons[season]!.tiles).toEqual(seasonTileNames())
    }
    expect([m.tileW, m.tileH, m.cols, m.rows]).toEqual([32, 16, 4, 4])
    expect(m.autotile!.road.file).toBe('road-autotile.png')
    // the strip's column index per key is the renderer's cut, and it must not shuffle
    expect(m.autotile!.road.tiles).toEqual(
      Object.fromEntries(ROAD_AUTOTILE_KEYS.map((k, i) => [k, i])),
    )
  })

  it('ships a real file behind every key, at the size the manifest promises', async () => {
    const m = loadTilesetManifest()
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'tilesets')
    for (const season of Object.values(m.seasons)) {
      const img = await decodePng(readFileSync(join(dir, season!.file)))
      expect([img.width, img.height], season!.file).toEqual([m.cols * m.tileW, m.rows * m.tileH])
    }
    const strip = await decodePng(readFileSync(join(dir, m.autotile!.road.file)))
    expect([strip.width, strip.height]).toEqual([ROAD_AUTOTILE_KEYS.length * m.tileW, m.tileH])
  })
})
