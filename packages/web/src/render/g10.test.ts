import { describe, expect, it } from 'vitest'
import {
  CITY_H,
  CITY_W,
  ROAD_AUTOTILE_KEYS,
  T_PATH,
  T_ROAD,
  TERRAIN_TILE_KINDS,
  makeCityTemplate,
  materialKind,
  roadAutotile,
  type AssetRecord,
} from '@sj/shared'
import { type TileId } from '@sj/engine/state'
import { tileToScreen } from './iso.js'
import { CALM_ROAD_KIND, ROAD_UNDER, groundField } from './groundField.js'
import { ROAD_TILE_ID, roadNeighborsAt } from './tileset.js'

// The renderer side. A gateway test cannot import `groundField` without
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

const material = (kind: string, seq: number): AssetRecord => ({
  id: `mat-${kind}`,
  seq,
  class: 'terrain',
  kind: materialKind(kind),
  status: 'ready',
  desc: kind,
  meta: null,
  footprint: { w: 1, h: 1 },
  widthPx: 256,
  heightPx: 256,
  score: 10,
  attempts: 1,
  costUsd: 0,
  createdAt: '2026-08-17T00:00:00Z',
})

// what the forge puts in the codex for the continuous field, as the renderer sees it
function fullCodex(): AssetRecord[] {
  let seq = 0
  return [...TERRAIN_TILE_KINDS, CALM_ROAD_KIND].map((kind) => material(kind, ++seq))
}

describe('GATE G10 — 1. the ground field over the showcase terrain', () => {
  const terrain = showcaseTerrain()
  const codex = fullCodex()

  it('has roads and grass to draw in the first place', () => {
    const flat = terrain.flat()
    expect(flat.filter((t) => t === ROAD_TILE_ID).length).toBeGreaterThan(50)
    expect(flat.filter((t) => t === 0).length).toBeGreaterThan(50)
  })

  it('gives every layer a material once the codex is ingested', () => {
    const { layers } = groundField(terrain, codex)
    expect(layers.length).toBeGreaterThan(1)
    for (const l of layers) expect(l.url, `${l.id} has no material`).not.toBeNull()
  })

  it('falls back to a flat palette-true colour with an empty codex — art independence', () => {
    const { layers } = groundField(terrain, [])
    expect(layers.every((l) => l.url === null)).toBe(true)
    expect(layers.every((l) => typeof l.fallback === 'number')).toBe(true)
  })

  it('cuts each road tile with its OWN autotile silhouette, not one flat shape', () => {
    const { layers } = groundField(terrain, codex)
    const byPoint = new Map<string, string>()
    for (const l of layers) {
      if (l.kind !== 'road') continue
      for (const s of l.shapes) {
        if (s.roadKey !== null) byPoint.set(`${s.sx},${s.sy}`, s.roadKey)
      }
    }
    const seen = new Set<string>()
    let checked = 0
    for (let y = 0; y < terrain.length; y++) {
      for (let x = 0; x < terrain[y]!.length; x++) {
        if (terrain[y]![x] !== ROAD_TILE_ID) continue
        const key = roadAutotile(roadNeighborsAt(terrain, x, y))
        const { sx, sy } = tileToScreen(x, y)
        expect(byPoint.get(`${sx},${sy}`), `${x},${y}`).toBe(key)
        seen.add(key)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(50)
    // the city lattice asks for ALL FIFTEEN shapes, so the whole strip is exercised here —
    // if the seam were dead every road would resolve to the same silhouette instead
    expect(seen.size).toBe(ROAD_AUTOTILE_KEYS.length)
  })

  it('carries ground under every ribbon on the real showcase lattice', () => {
    const { layers } = groundField(terrain, codex)
    const under = layers.find((l) => l.kind === ROAD_UNDER)!
    const ground = new Set(under.shapes.map((s) => `${s.sx},${s.sy}`))
    let ribbons = 0
    for (let y = 0; y < terrain.length; y++) {
      for (let x = 0; x < terrain[y]!.length; x++) {
        if (terrain[y]![x] !== ROAD_TILE_ID) continue
        const { sx, sy } = tileToScreen(x, y)
        expect(ground.has(`${sx},${sy}`), `a hole onto the stage at ${x},${y}`).toBe(true)
        ribbons++
      }
    }
    expect(ribbons).toBeGreaterThan(50)
  })

  it('still lays the cobble material when no calm one has been generated — additive seam', () => {
    const cobbleOnly = fullCodex().filter((r) => r.kind !== materialKind(CALM_ROAD_KIND))
    const { layers } = groundField(terrain, cobbleOnly)
    for (const l of layers) expect(l.url, `${l.id} has no material`).not.toBeNull()
  })

  it('bakes the same field twice — the ground is a hash, never a roll', () => {
    expect(groundField(terrain, codex)).toEqual(groundField(terrain, codex))
  })
})
