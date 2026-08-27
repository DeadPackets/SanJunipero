import { describe, expect, it } from 'vitest'
import {
  CITY_H,
  CITY_W,
  ROAD_AUTOTILE_KEYS,
  T_PATH,
  T_ROAD,
  TERRAIN_TILE_KINDS,
  makeCityTemplate,
  roadAutotile,
  roadAutotileKind,
  type AssetRecord,
  type TerrainTileKind,
} from '@sj/shared'
import { type TileId } from '@sj/engine/state'
import { tilesetPlan } from './ground.js'
import { ROAD_TILE_ID, TERRAIN_VARIANTS, roadNeighborsAt, tileVariant } from './tileset.js'

// The renderer side. A gateway test cannot import `tilesetPlan` without
// breaking `tsc -b`: the web package is DOM-typed and bundler-resolved.

// ── the showcase terrain, rasterised here from the same C13 template the gateway uses ──
function showcaseTerrain(): TileId[][] {
  const t = makeCityTemplate({ x: 0, y: 0 })
  const grid: TileId[][] = Array.from({ length: CITY_H }, () =>
    Array.from({ length: CITY_W }, () => 0),
  )
  for (const tile of t.tiles) {
    if (tile.dx < 0 || tile.dy < 0 || tile.dx >= CITY_W || tile.dy >= CITY_H) continue
    // T_PATH (8) does not exist in the engine yet — a path rasterises as road
    grid[tile.dy]![tile.dx] = (tile.to === T_PATH ? T_ROAD : tile.to) as TileId
  }
  // The town's three-tile streets meet on a lattice and resolve to nine of the fifteen autotile
  // shapes, so a straight run and a dead end are drawn here to exercise the whole strip.
  for (let y = 2; y <= 6; y++) grid[y]![13] = T_ROAD // straight-ns, cap-n, cap-s
  for (let x = 12; x <= 16; x++) grid[10]![x] = T_ROAD // straight-ew, cap-e, cap-w
  return grid
}

const record = (kind: string, meta: string | null, seq = 1): AssetRecord => ({
  id: `rec-${kind}-${seq}`,
  seq,
  class: 'terrain',
  kind,
  status: 'ready',
  desc: kind,
  meta,
  footprint: { w: 1, h: 1 },
  widthPx: 32,
  heightPx: 16,
  score: 10,
  attempts: 1,
  costUsd: 0,
  createdAt: '2026-08-17T00:00:00Z',
})

const terrainManifest = (kind: TerrainTileKind, variant: number): string =>
  JSON.stringify({ version: 'v1-terrain-tile', kind, variant, wPx: 32, hPx: 16 })

// what `registerTerrainTiles` puts in the codex, as the renderer sees it over the wire
function fullCodex(): AssetRecord[] {
  let seq = 0
  const out: AssetRecord[] = []
  for (const kind of TERRAIN_TILE_KINDS) {
    for (let v = 0; v < TERRAIN_VARIANTS; v++)
      out.push(record(kind, terrainManifest(kind, v), ++seq))
  }
  for (const key of ROAD_AUTOTILE_KEYS) {
    out.push(record(roadAutotileKind(key), terrainManifest('road', 0), ++seq))
  }
  return out
}

describe('GATE G10 — 1. tileset over the showcase terrain', () => {
  const terrain = showcaseTerrain()
  const codex = fullCodex()

  it('has roads and grass to draw in the first place', () => {
    const flat = terrain.flat()
    expect(flat.filter((t) => t === ROAD_TILE_ID).length).toBeGreaterThan(50)
    expect(flat.filter((t) => t === 0).length).toBeGreaterThan(50)
  })

  it('gives every tile a texture once the codex is ingested', () => {
    const plan = tilesetPlan(terrain, codex)
    expect(plan).toHaveLength(CITY_W * CITY_H)
    expect(plan.every((c) => c.url !== null && c.tex !== null)).toBe(true)
  })

  it('falls back to a flat palette-true diamond with an empty codex — art independence', () => {
    const plan = tilesetPlan(terrain, [])
    expect(plan.every((c) => c.url === null && c.tex === null)).toBe(true)
    expect(plan.every((c) => typeof c.fallback === 'number')).toBe(true)
  })

  it('draws each road junction with its OWN autotile record, not a flat variant', () => {
    const plan = tilesetPlan(terrain, codex)
    const byKey = new Map(codex.map((r) => [r.kind, `/assets/${r.id}.png`]))
    const seen = new Set<string>()
    let checked = 0
    for (let y = 0; y < terrain.length; y++) {
      for (let x = 0; x < terrain[y]!.length; x++) {
        if (terrain[y]![x] !== ROAD_TILE_ID) continue
        const key = roadAutotile(roadNeighborsAt(terrain, x, y))
        const cell = plan[y * CITY_W + x]!
        expect(cell.url, `${x},${y}`).toBe(byKey.get(roadAutotileKind(key)))
        seen.add(key)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(50)
    // the city lattice asks for ALL FIFTEEN shapes, so the whole strip is exercised here —
    // if the seam were dead every road would resolve to the same flat variant instead
    expect(seen.size).toBe(ROAD_AUTOTILE_KEYS.length)
  })

  it('carries ground under every ribbon on the real showcase lattice (fix round 2)', () => {
    const plan = tilesetPlan(terrain, codex)
    let ribbons = 0
    for (const cell of plan) {
      if (!cell.overlay) continue
      ribbons++
      expect(cell.base, 'a ribbon with no ground under it is a hole onto the stage').not.toBeNull()
      expect(cell.base!.url).not.toBeNull()
    }
    expect(ribbons).toBeGreaterThan(50)
    // and nothing that is NOT a ribbon carries a redundant second layer
    expect(plan.filter((c) => !c.overlay).every((c) => c.base === null)).toBe(true)
  })

  it('still uses flat road variants when the strip is absent — the seam is additive', () => {
    const flatOnly = fullCodex().filter((r) => !r.kind!.startsWith('road:'))
    const plan = tilesetPlan(terrain, flatOnly)
    let checked = 0
    for (let y = 0; y < terrain.length; y++) {
      for (let x = 0; x < terrain[y]!.length; x++) {
        if (terrain[y]![x] !== ROAD_TILE_ID) continue
        expect(plan[y * CITY_W + x]!.tex).toEqual({
          version: 'v1-terrain-tile',
          kind: 'road',
          variant: tileVariant(x, y),
          wPx: 32,
          hPx: 16,
        })
        checked++
      }
    }
    expect(checked).toBeGreaterThan(50)
  })

  it('bakes the same plan twice — the ground is a hash, never a roll', () => {
    expect(tilesetPlan(terrain, codex)).toEqual(tilesetPlan(terrain, codex))
  })
})
