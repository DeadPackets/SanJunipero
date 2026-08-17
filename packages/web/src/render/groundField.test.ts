import { describe, expect, it } from 'vitest'
import { ROAD_AUTOTILE_KEYS, materialKind, type AssetRecord } from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import { TILE_H, TILE_W, tileToScreen } from './iso.js'
import { ROAD_TILE_ID } from './tileset.js'
import {
  MATERIAL_REPEAT_PX, ROAD_UNDER, groundArtSignature, groundField, materialUv, resolveMaterial,
  roadArms, roadRibbonPolys, roadStripFrame,
} from './groundField.js'

const material = (kind: string, seq: number): AssetRecord => ({
  id: `mat-${kind}`, seq, class: 'terrain', kind: materialKind(kind as 'grass'), status: 'ready',
  desc: kind, meta: null, footprint: { w: 1, h: 1 },
  widthPx: MATERIAL_REPEAT_PX, heightPx: MATERIAL_REPEAT_PX,
  score: 10, attempts: 1, costUsd: 0, createdAt: '2026-08-17T00:00:00Z',
})

const field = (n: number, fill: TileId): TileId[][] =>
  Array.from({ length: n }, () => Array.from({ length: n }, () => fill))

describe('materialUv', () => {
  it('is a WORLD-space wrap, so the material flows across tile boundaries', () => {
    // two neighbouring tiles sample CONSECUTIVE material pixels, not the same pixel twice
    const a = tileToScreen(4, 4), b = tileToScreen(5, 4)
    expect(materialUv(a.sx, a.sy)).not.toEqual(materialUv(b.sx, b.sy))
    expect(materialUv(b.sx, b.sy).u - materialUv(a.sx, a.sy).u).toBe(TILE_W / 2)
  })

  it('wraps cleanly, including for the negative screen x the west half of a map has', () => {
    expect(materialUv(0, 0)).toEqual({ u: 0, v: 0 })
    expect(materialUv(MATERIAL_REPEAT_PX, MATERIAL_REPEAT_PX)).toEqual({ u: 0, v: 0 })
    expect(materialUv(-1, -1)).toEqual({ u: MATERIAL_REPEAT_PX - 1, v: MATERIAL_REPEAT_PX - 1 })
  })

  it('repeats far above tile frequency — that is the whole point', () => {
    expect(MATERIAL_REPEAT_PX / TILE_W).toBeGreaterThanOrEqual(8)
  })
})

describe('groundField', () => {
  const records = [material('grass', 1), material('road', 2), material('water', 3)]

  it('is ONE layer per terrain, not one stamp per tile', () => {
    const f = groundField(field(16, 0), records)
    expect(f.layers).toHaveLength(1)
    expect(f.layers[0]!.kind).toBe('grass')
    expect(f.layers[0]!.shapes).toHaveLength(256)     // shapes, not textures
    expect(f.layers[0]!.url).toBe('/assets/mat-grass.png')
  })

  it('carries no per-tile variant anywhere — the checkerboard had no other source', () => {
    const f = groundField(field(8, 0), records)
    const shapeKeys = Object.keys(f.layers[0]!.shapes[0]!)
    expect(shapeKeys.sort()).toEqual(['roadKey', 'sx', 'sy'])   // no `variant`, no `tex`
  })

  it('gives a road tile BOTH the ground under it and its own ribbon silhouette', () => {
    const t = field(5, 0)
    t[2]![2] = ROAD_TILE_ID
    const f = groundField(t, records)
    const grass = f.layers.find((l) => l.kind === ROAD_UNDER)!
    const road = f.layers.find((l) => l.kind === 'road')!
    expect(grass.shapes).toHaveLength(25)              // the road tile's diamond too
    expect(road.shapes).toHaveLength(1)
    expect(road.shapes[0]!.roadKey).toBe('cap-s')      // isolated road tile
    expect(road.shapes[0]!.sx).toBe(tileToScreen(2, 2).sx)
  })

  it('draws road last, over the ground it runs through', () => {
    const t = field(5, 0)
    t[2]![2] = ROAD_TILE_ID
    const kinds = groundField(t, records).layers.map((l) => l.kind)
    expect(kinds.at(-1)).toBe('road')
  })

  it('falls back to a palette-true colour when a material is missing — art independence', () => {
    const f = groundField(field(4, 2), [])             // water, empty codex
    expect(f.layers[0]!.url).toBeNull()
    expect(f.layers[0]!.fallback).toBe(0x7fb0c9)
  })

  it('sizes the bake to the whole map', () => {
    const f = groundField(field(10, 0), records)
    expect(f.widthPx).toBe(20 * (TILE_W / 2))
    expect(f.heightPx).toBe(20 * (TILE_H / 2))
    expect(f.offsetX).toBe(10 * (TILE_W / 2))
  })

  it('is deterministic', () => {
    expect(groundField(field(6, 0), records)).toEqual(groundField(field(6, 0), records))
  })
})

describe('resolveMaterial', () => {
  it('takes the newest ready material and never a flat tile record', () => {
    const flat: AssetRecord = { ...material('grass', 9), id: 'flat', kind: 'grass' }
    expect(resolveMaterial([flat], 'grass')).toBeNull()
    expect(resolveMaterial([material('grass', 1), { ...material('grass', 5), id: 'newer' }], 'grass'))
      .toBe('/assets/newer.png')
  })
})

describe('roadStripFrame', () => {
  it('cuts each key out of the shipped 15-cell strip', () => {
    expect(roadStripFrame('straight-ns', ROAD_AUTOTILE_KEYS))
      .toEqual({ x: ROAD_AUTOTILE_KEYS.indexOf('straight-ns') * TILE_W, y: 0, w: TILE_W, h: TILE_H })
  })
})

describe('road silhouettes', () => {
  const inDiamond = (x: number, y: number): boolean =>
    Math.abs(x) / (TILE_W / 2) + Math.abs(y - TILE_H / 2) / (TILE_H / 2) <= 1.001

  it('reads its arms from the key NAME, the same rule the strip was painted from', () => {
    expect(roadArms('cross')).toEqual({ n: true, e: true, s: true, w: true })
    expect(roadArms('straight-ns')).toEqual({ n: true, e: false, s: true, w: false })
    expect(roadArms('corner-ne')).toEqual({ n: true, e: true, s: false, w: false })
    expect(roadArms('t-no-w')).toEqual({ n: true, e: true, s: true, w: false })
    // the isolated tile and the south stub share this key; only the name distinguishes them
    expect(roadArms('cap-s')).toEqual({ n: false, e: false, s: true, w: false })
  })

  it('gives every key a stub plus one quad per arm', () => {
    for (const key of ROAD_AUTOTILE_KEYS) {
      const arms = Object.values(roadArms(key)).filter(Boolean).length
      expect(roadRibbonPolys(key), key).toHaveLength(1 + arms)
    }
    expect(roadRibbonPolys('cross')).toHaveLength(5)
    expect(roadRibbonPolys('cap-n')).toHaveLength(2)
  })

  it('never spills outside the tile it belongs to', () => {
    for (const key of ROAD_AUTOTILE_KEYS) {
      for (const poly of roadRibbonPolys(key)) {
        for (let i = 0; i < poly.length; i += 2) {
          expect(inDiamond(poly[i]!, poly[i + 1]!), `${key} @${i}`).toBe(true)
        }
      }
    }
  })

  it('reaches the shared edge so a run joins up with no gap', () => {
    // the n arm's far edge IS the diamond's upper-right edge, whose midpoint is where the
    // neighbouring tile's s arm arrives. roadTiles.ts paints that same point at (23,4) of a
    // 32x16 cell — (+7,-4) from the centre, so (8,4) from the top vertex.
    const n = roadRibbonPolys('straight-ns')[1]!
    expect([(n[2]! + n[4]!) / 2, (n[3]! + n[5]!) / 2]).toEqual([8, 4])
  })

  it('an arm owns its whole QUADRANT — a narrow band is what made roads vanish at 1x', () => {
    // the painter fills the diamond and removes the wedge of every ABSENT arm, so a straight
    // run covers half its tile. Area of the two arm triangles of `straight-ns` must be half
    // the diamond, not a thin ribbon.
    const area = (p: number[]): number => {
      let a = 0
      for (let i = 0, j = p.length / 2 - 1; i < p.length / 2; j = i++) {
        a += (p[j * 2]! + p[i * 2]!) * (p[j * 2 + 1]! - p[i * 2 + 1]!)
      }
      return Math.abs(a / 2)
    }
    const diamond = (TILE_W * TILE_H) / 2
    const arms = roadRibbonPolys('straight-ns').slice(1).reduce((s2, p) => s2 + area(p), 0)
    expect(arms).toBeCloseTo(diamond / 2, 5)
    // and a crossroads covers the whole tile
    expect(roadRibbonPolys('cross').slice(1).reduce((s2, p) => s2 + area(p), 0)).toBeCloseTo(diamond, 5)
  })

  it('is deterministic and carries no per-tile term', () => {
    expect(roadRibbonPolys('cross')).toEqual(roadRibbonPolys('cross'))
  })
})

// ── THE PERIODICITY GUARD ───────────────────────────────────────────────────────────────
// The user's complaint made measurable. Sample the baked ground along a world-space SCANLINE
// and look for the PLATEAU a per-tile choice leaves: inside one tile the value never changes,
// so a half-tile lag is almost perfectly self-correlated, while a full-tile lag lands on an
// independently chosen neighbour and is not. That gap — high at half a tile, collapsed at a
// whole one — is the checkerboard's fingerprint. A continuous field has no plateau and no
// gap: the material varies at its own scale, which knows nothing about tile boundaries.

/** normalised autocorrelation of a series at a lag */
function autocorr(series: number[], lag: number): number {
  const n = series.length - lag
  const mean = series.reduce((s2, v) => s2 + v, 0) / series.length
  let num = 0, den = 0
  for (let i = 0; i < n; i++) num += (series[i]! - mean) * (series[i + lag]! - mean)
  for (const v of series) den += (v - mean) ** 2
  return den === 0 ? 1 : (num / den) * (series.length / n)
}

describe('the ground carries no tile-frequency pattern', () => {
  const SPAN = TILE_W * 24

  // THE FIX: the material is sampled by WORLD POSITION, so the signal knows nothing of tiles
  const continuous: number[] = []
  for (let u = 0; u < SPAN; u++) {
    const { u: mu } = materialUv(u, 0)
    continuous.push(128 + 40 * Math.sin((2 * Math.PI * mu) / MATERIAL_REPEAT_PX)
      + 12 * Math.sin((2 * Math.PI * mu) / 37))
  }

  // THE DEFECT: one value per tile from a per-tile hash — exactly what the old ground did
  const perTile: number[] = []
  for (let u = 0; u < SPAN; u++) {
    const tx = Math.floor(u / TILE_W)
    const h = (Math.imul(tx + 0x9e3779b9, 0x27d4eb2d) ^ Math.imul(3 + 0x9e3779b9, 0x165667b1)) >>> 0
    perTile.push([90, 130, 170, 210][h % 4]!)
  }

  /** how flat the signal is INSIDE a tile compared with across one — the plateau gap */
  const tilePlateau = (s: number[]): number => autocorr(s, TILE_W / 2) - autocorr(s, TILE_W)

  it('the per-tile ground DOES plateau inside a tile — so the guard discriminates', () => {
    expect(tilePlateau(perTile)).toBeGreaterThan(0.3)
  })

  it('the continuous field does NOT', () => {
    expect(tilePlateau(continuous)).toBeLessThan(0.05)
  })

  it('and the plan it bakes from carries no tile-indexed appearance at all', () => {
    for (const shape of groundField(field(16, 0), []).layers[0]!.shapes) {
      expect(Object.keys(shape).sort()).toEqual(['roadKey', 'sx', 'sy'])
    }
  })
})


// FPS REGRESSION GUARD. The ground bake tessellates every tile outline on the map, and it was
// firing once per ASSET MESSAGE. With the C13 library ingested that is ~166 messages back to
// back — enough main-thread blocking that requestAnimationFrame itself (which is what the FPS
// overlay counts, not the Pixi ticker) fell to 0.2 frames per second. Only terrain records can
// change the ground; nothing else may trigger a bake.
describe('groundArtSignature', () => {
  const rec = (klass: string, kind: string, seq: number): AssetRecord => ({
    id: `r${seq}`, seq, class: klass as 'terrain', kind, status: 'ready', desc: kind, meta: null,
    footprint: { w: 1, h: 1 }, widthPx: 8, heightPx: 8,
    score: 10, attempts: 1, costUsd: 0, createdAt: '2026-08-17T00:00:00Z',
  })

  it('moves when terrain art arrives', () => {
    const before = [rec('terrain', 'grass', 1)]
    expect(groundArtSignature(before)).toBe(1)
    expect(groundArtSignature([...before, rec('terrain', 'water', 2)])).toBe(2)
  })

  it('does NOT move for the hundred library records that caused the stall', () => {
    const terrain = [rec('terrain', 'grass', 1), rec('terrain', 'road', 2)]
    const sig = groundArtSignature(terrain)
    const withLibrary = [...terrain]
    for (let i = 0; i < 100; i++) withLibrary.push(rec('item', `thing-${i}`, 10 + i))
    for (let i = 0; i < 11; i++) withLibrary.push(rec('building', `b-${i}`, 200 + i))
    withLibrary.push(rec('rig-part', 'character:omar', 400))
    expect(groundArtSignature(withLibrary)).toBe(sig)
  })

  it('ignores art that is not ready yet', () => {
    const pending = { ...rec('terrain', 'grass', 3), status: 'placeholder' as const }
    expect(groundArtSignature([pending])).toBe(0)
  })

  it('is cheap and pure — it runs on every store notify', () => {
    const many = Array.from({ length: 500 }, (_, i) => rec(i % 3 === 0 ? 'terrain' : 'item', `k${i}`, i + 1))
    expect(groundArtSignature(many)).toBe(groundArtSignature(many))
  })
})
