import { describe, it, expect } from 'vitest'
import {
  TERRAIN_TILE_KINDS,
  TerrainTileManifestSchema,
  parseTerrainTileManifest,
} from './terrain.js'

const good = { version: 'v1-terrain-tile', kind: 'grass', variant: 0, wPx: 32, hPx: 16 }

describe('TerrainTileManifestSchema', () => {
  it('parses a well-formed manifest', () => {
    expect(TerrainTileManifestSchema.parse(good).kind).toBe('grass')
  })

  it('rejects a wrong version, an out-of-range variant, and an unknown kind', () => {
    expect(() => TerrainTileManifestSchema.parse({ ...good, version: 'v2-terrain-tile' })).toThrow()
    expect(() => TerrainTileManifestSchema.parse({ ...good, variant: 4 })).toThrow()
    expect(() => TerrainTileManifestSchema.parse({ ...good, variant: -1 })).toThrow()
    expect(() => TerrainTileManifestSchema.parse({ ...good, kind: 'lava' })).toThrow()
    expect(() => TerrainTileManifestSchema.parse({ ...good, extra: 1 })).toThrow()
  })

  it('covers the eight terrain kinds including road', () => {
    expect(TERRAIN_TILE_KINDS).toEqual([
      'grass',
      'earth',
      'water',
      'forest',
      'rock',
      'sand',
      'farmland',
      'road',
    ])
  })
})

describe('parseTerrainTileManifest', () => {
  it('round-trips a manifest string', () => {
    expect(parseTerrainTileManifest(JSON.stringify(good))).toEqual(good)
  })

  it('returns null for null, for non-JSON, and for a foreign manifest', () => {
    expect(parseTerrainTileManifest(null)).toBeNull()
    expect(parseTerrainTileManifest('not json')).toBeNull()
    expect(parseTerrainTileManifest(JSON.stringify({ version: 'v4-building' }))).toBeNull()
  })
})
