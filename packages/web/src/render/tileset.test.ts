import { describe, it, expect } from 'vitest'
import type { AssetRecord } from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import { tilesetPlan } from './ground.js'
import { tileToScreen } from './iso.js'
import {
  ROAD_TILE_ID, TERRAIN_VARIANTS, resolveTerrainTile, roadAutotileKind, roadNeighborsAt,
  tileKind, tileVariant,
} from './tileset.js'

let seq = 0
function terrainRecord(kind: string, variant: number | null): AssetRecord {
  seq += 1
  return {
    id: `asset_${kind}_${variant}`, seq, class: 'terrain', desc: `tile: ${kind}`, kind,
    meta: variant === null ? null : JSON.stringify({ version: 'v1-terrain-tile', kind: kind.split(':')[0], variant, wPx: 32, hPx: 16 }),
    footprint: { w: 1, h: 1 }, widthPx: 32, heightPx: 16, status: 'ready',
    score: 10, attempts: 1, costUsd: 0, createdAt: '2026-08-16T00:00:00Z',
  }
}

const grassAll = [0, 1, 2, 3].map((v) => terrainRecord('grass', v))

describe('tileKind', () => {
  it('maps every engine TileId, road included', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(tileKind))
      .toEqual(['grass', 'earth', 'water', 'forest', 'rock', 'sand', 'farmland', 'road'])
  })

  it('falls back to grass for an id the engine does not emit yet', () => {
    expect(tileKind(99)).toBe('grass')
  })
})

describe('tileVariant', () => {
  it('is stable for the same tile', () => {
    expect(tileVariant(3, 7)).toBe(tileVariant(3, 7))
  })

  it('stays in range and uses all four variants over a 4x4 sweep', () => {
    const seen = new Set<number>()
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const v = tileVariant(x, y)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(TERRAIN_VARIANTS)
      seen.add(v)
    }
    expect(seen.size).toBe(TERRAIN_VARIANTS)
  })
})

describe('resolveTerrainTile', () => {
  it('picks the record whose manifest variant matches the tile, with its url', () => {
    const want = tileVariant(5, 9)
    const tex = resolveTerrainTile(grassAll, 0, 5, 9)
    expect(tex.variant).toBe(want)
    expect(tex.manifest!.variant).toBe(want)
    expect(tex.url).toBe(`/assets/asset_grass_${want}.png`)
  })

  it('falls back to the first record of the kind when the exact variant is missing', () => {
    const only0 = [terrainRecord('grass', 0)]
    const tex = resolveTerrainTile(only0, 0, 5, 9)
    expect(tex.manifest!.variant).toBe(0)
    expect(tex.url).not.toBeNull()          // textured beats flat
  })

  it('returns no texture when the codex has no terrain art', () => {
    expect(resolveTerrainTile([], 0, 1, 1)).toMatchObject({ manifest: null, url: null, kind: 'grass' })
  })

  it('ignores placeholder records and records of another kind', () => {
    const placeholder = { ...terrainRecord('grass', 0), status: 'placeholder' as const }
    expect(resolveTerrainTile([placeholder, ...grassAll.slice(0, 0)], 0, 1, 1).url).toBeNull()
    expect(resolveTerrainTile(grassAll, 4 /* rock */, 1, 1).url).toBeNull()
  })

  it('prefers an autotiled road strip record over the flat road variants (C13 seam)', () => {
    const flat = [0, 1, 2, 3].map((v) => terrainRecord('road', v))
    const strip = terrainRecord(roadAutotileKind('cross'), null)
    expect(resolveTerrainTile([...flat, strip], ROAD_TILE_ID, 2, 2, 'cross').url).toBe(`/assets/${strip.id}.png`)
    // no strip in the codex → the flat variants still render (additive, no rework)
    expect(resolveTerrainTile(flat, ROAD_TILE_ID, 2, 2, 'cross').url).toBe(`/assets/asset_road_${tileVariant(2, 2)}.png`)
  })
})

describe('roadNeighborsAt', () => {
  it('reads the four orthogonal road neighbours and treats off-map as empty', () => {
    const t: TileId[][] = [
      [0, 7, 0],
      [7, 7, 7],
      [0, 0, 0],
    ]
    expect(roadNeighborsAt(t, 1, 1)).toEqual({ n: true, e: true, s: false, w: true })
    expect(roadNeighborsAt(t, 0, 0)).toEqual({ n: false, e: true, s: true, w: false })
  })
})

describe('tilesetPlan', () => {
  const map2x2: TileId[][] = [[0, 0], [0, 0]]

  it('places one entry per tile at the exact dimetric screen position', () => {
    const plan = tilesetPlan(map2x2, [])
    expect(plan).toHaveLength(4)
    expect(plan.map((c) => [c.sx, c.sy]))
      .toEqual([[0, 0], [16, 8], [-16, 8], [0, 16]].map(([sx, sy]) => [sx, sy]))
    expect(tileToScreen(1, 1)).toEqual({ sx: 0, sy: 16 })
  })

  it('falls back to the C6 flat palette diamonds with no terrain art', () => {
    const plan = tilesetPlan(map2x2, [])
    expect(plan.every((c) => c.tex === null && c.url === null)).toBe(true)
    expect(plan[0]!.fallback).toBe(0x93b573)
  })

  it('textures every tile once the codex carries the kind', () => {
    const plan = tilesetPlan(map2x2, grassAll)
    expect(plan.every((c) => c.tex !== null && c.url !== null)).toBe(true)
  })

  it('autotiles a road cross from its neighbours', () => {
    const cross: TileId[][] = [
      [0, 7, 0],
      [7, 7, 7],
      [0, 7, 0],
    ]
    const strip = terrainRecord(roadAutotileKind('cross'), null)
    const plan = tilesetPlan(cross, [strip])
    expect(plan[4]!.url).toBe(`/assets/${strip.id}.png`)     // centre tile, all four arms
    expect(plan[1]!.url).toBeNull()                          // cap-s stub: no record for that key
  })
})
