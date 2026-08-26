import { describe, expect, it } from 'vitest'
import { ROAD_AUTOTILE_KEYS, roadAutotileKind, type AssetRecord } from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import { GRASS_TILE_ID, TILE_COLORS, groundPlan, tilesetPlan } from './ground.js'
import { ROAD_TILE_ID } from './tileset.js'

describe('groundPlan', () => {
  it('maps a 2x2 terrain to diamonds at exact screen points with alternating shade', () => {
    // terrain is [y][x]: row 0 = water, grass; row 1 = dirt, forest
    const terrain: TileId[][] = [
      [2, 0],
      [1, 3],
    ]
    expect(groundPlan(terrain)).toEqual([
      { sx: 0, sy: 0, color: TILE_COLORS[2], shade: false },
      { sx: 16, sy: 8, color: TILE_COLORS[0], shade: true },
      { sx: -16, sy: 8, color: TILE_COLORS[1], shade: true },
      { sx: 0, sy: 16, color: TILE_COLORS[3], shade: false },
    ])
  })

  it('water is the exact master-palette hex', () => {
    expect(TILE_COLORS[2]).toBe(0x7fb0c9)
  })
})

// The autotile strip is a road RIBBON on transparency, not a filled diamond — half of a
// `straight-ns` tile is a hole — so it is an OVERLAY and the plan carries the ground under it.

const record = (kind: string, meta: string | null, seq: number): AssetRecord => ({
  id: `rec-${kind}`,
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

const manifest = (kind: string, variant: number): string =>
  JSON.stringify({ version: 'v1-terrain-tile', kind, variant, wPx: 32, hPx: 16 })

function codexWithStrip(): AssetRecord[] {
  let seq = 0
  const out: AssetRecord[] = []
  for (let v = 0; v < 4; v++) out.push(record(`grass-${v}`, manifest('grass', v), ++seq))
  // the four grass records must all answer to codex kind 'grass'
  for (let i = 0; i < 4; i++) out[i] = { ...out[i]!, kind: 'grass', id: `rec-grass-${i}` }
  for (let v = 0; v < 4; v++) {
    out.push({ ...record('road', manifest('road', v), ++seq), id: `rec-road-${v}` })
  }
  for (const key of ROAD_AUTOTILE_KEYS) {
    out.push(record(roadAutotileKind(key), manifest('road', 0), ++seq))
  }
  return out
}

// a 3-tile straight north-south road down the middle of a grass field
function roadStrip(): TileId[][] {
  const g: TileId[][] = Array.from({ length: 5 }, () =>
    Array.from({ length: 3 }, () => 0 as TileId),
  )
  for (let y = 1; y <= 3; y++) g[y]![1] = ROAD_TILE_ID
  return g
}

describe('tilesetPlan over a 3-tile straight road', () => {
  const terrain = roadStrip()
  const records = codexWithStrip()
  const plan = tilesetPlan(terrain, records)
  const at = (x: number, y: number) => plan[y * 3 + x]!
  const roadCells = [at(1, 1), at(1, 2), at(1, 3)]

  it('draws exactly one plan entry per terrain cell — no duplicate draw', () => {
    expect(plan).toHaveLength(15)
    const seen = new Set(plan.map((c) => `${c.sx},${c.sy}`))
    expect(seen.size).toBe(15)
  })

  it('resolves the middle of the run to the straight-ns strip cell, not a flat variant', () => {
    const mid = at(1, 2)
    expect(mid.url).toBe(
      `/assets/${roadAutotileKind('straight-ns')}.png`.replace('/assets/', '/assets/rec-'),
    )
    expect(mid.overlay).toBe(true)
  })

  it('puts GROUND under every ribbon tile — never the dark stage', () => {
    for (const cell of roadCells) {
      expect(cell.overlay, 'a ribbon tile must be an overlay').toBe(true)
      expect(cell.base, 'a ribbon tile with no base is a hole onto the background').not.toBeNull()
      // the ground under a road is the field it runs through, painted grass-side
      expect(cell.base!.fallback).toBe(TILE_COLORS[GRASS_TILE_ID])
      expect(cell.base!.url).not.toBeNull()
      expect(cell.base!.tex?.kind).toBe('grass')
    }
  })

  it('never gives a road cell a dark fill on any layer', () => {
    const dark = (c: number): boolean => {
      const [r, g, b] = [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]
      return r * 0.299 + g * 0.587 + b * 0.114 < 96 // the 0x322B38 stage is ~52
    }
    for (const cell of roadCells) {
      expect(dark(cell.fallback), `road fallback #${cell.fallback.toString(16)}`).toBe(false)
      expect(dark(cell.base!.fallback), `base fallback #${cell.base!.fallback.toString(16)}`).toBe(
        false,
      )
    }
  })

  it('needs no base once the strip is gone — a flat road variant fills its own diamond', () => {
    const flatOnly = records.filter((r) => !r.kind!.startsWith('road:'))
    for (const cell of [1, 2, 3].map((y) => tilesetPlan(terrain, flatOnly)[y * 3 + 1]!)) {
      expect(cell.overlay).toBe(false)
      expect(cell.base).toBeNull()
      expect(cell.tex?.kind).toBe('road')
    }
  })

  it('leaves plain ground alone — no base, no overlay', () => {
    for (const cell of [at(0, 0), at(2, 4), at(0, 2)]) {
      expect(cell.overlay).toBe(false)
      expect(cell.base).toBeNull()
    }
  })
})
