import { describe, expect, it } from 'vitest'
import { ROAD_AUTOTILE_KEYS, materialKind, type AssetRecord } from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import { TILE_H, TILE_W, tileToScreen } from './iso.js'
import { ROAD_TILE_ID } from './tileset.js'
import {
  CALM_ROAD_KIND, MATERIAL_REPEAT_PX, ROAD_UNDER, groundArtSignature, groundField, isRoadMass,
  materialUv, resolveMaterial, roadArms, roadRibbonPolys, roadShoulderPolys, roadStripFrame,
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


// ── CONNECTIVITY ACCEPTANCE (controller, final round) ───────────────────────────────────
// Roads rendered as chains of disconnected cobble islands. Adjacent quadrants SHARE an edge
// mathematically, so the gaps are a rasterisation seam: two polygons abutting on a boundary
// can each drop the boundary pixel. The acceptance test is the controller's own — flood-fill
// a rasterised run from one end and require the other end to be reachable.

/** rasterise a road run into a boolean grid the way the baker fills it */
function rasterRun(terrain: TileId[][]): { grid: boolean[][]; w: number; h: number; off: number } {
  const n = terrain.length
  const w = 2 * n * (TILE_W / 2), h = 2 * n * (TILE_H / 2) + TILE_H, off = n * (TILE_W / 2)
  const grid: boolean[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => false))
  const field = groundField(terrain, [])
  for (const l of field.layers) {
    if (l.kind !== 'road') continue
    for (const shape of l.shapes) {
      if (shape.roadKey === null) continue
      for (const poly of roadRibbonPolys(shape.roadKey)) {
        const pts: number[] = []
        for (let i = 0; i < poly.length; i += 2) pts.push(shape.sx + off + poly[i]!, shape.sy + poly[i + 1]!)
        const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1)
        for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(h - 1, Math.ceil(Math.max(...ys))); y++) {
          for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(w - 1, Math.ceil(Math.max(...xs))); x++) {
            let inside = false
            for (let i = 0, j = pts.length / 2 - 1; i < pts.length / 2; j = i++) {
              const xi = pts[i * 2]!, yi = pts[i * 2 + 1]!, xj = pts[j * 2]!, yj = pts[j * 2 + 1]!
              if ((yi > y + 0.5) !== (yj > y + 0.5)
                && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) inside = !inside
            }
            if (inside) grid[y]![x] = true
          }
        }
      }
    }
  }
  return { grid, w, h, off }
}

/** 4-way flood fill from the first filled pixel of `from`, does it reach `to`? */
function reaches(r: ReturnType<typeof rasterRun>, from: [number, number], to: [number, number]): boolean {
  const seen = Array.from({ length: r.h }, () => Array.from({ length: r.w }, () => false))
  const start = [Math.round(from[0]), Math.round(from[1])] as [number, number]
  if (!r.grid[start[1]]?.[start[0]]) return false
  const q: Array<[number, number]> = [start]
  seen[start[1]]![start[0]] = true
  while (q.length > 0) {
    const [x, y] = q.pop()!
    if (Math.abs(x - to[0]) <= 1 && Math.abs(y - to[1]) <= 1) return true
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= r.w || ny >= r.h) continue
      if (seen[ny]![nx] || !r.grid[ny]![nx]) continue
      seen[ny]![nx] = true
      q.push([nx, ny])
    }
  }
  return false
}

const road = (n: number, cells: Array<[number, number]>): TileId[][] => {
  const t: TileId[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0 as TileId))
  for (const [x, y] of cells) t[y]![x] = ROAD_TILE_ID as TileId
  return t
}
const centreOf = (r: { off: number }, x: number, y: number): [number, number] =>
  [tileToScreen(x, y).sx + r.off, tileToScreen(x, y).sy + TILE_H / 2]

describe('the rim only faces grass', () => {
  it('a straight run gets a rim on its two long sides and NOTHING at the joins', () => {
    // 4 present-arm side-edges on a straight run; the two facing the other (absent) arms get
    // a rim, the two shared with the road's own continuation do not
    expect(roadShoulderPolys('straight-ns')).toHaveLength(4)
    expect(roadShoulderPolys('straight-ew')).toHaveLength(4)
  })

  it('a crossroads has no rim at all — every side is road', () => {
    expect(roadShoulderPolys('cross')).toHaveLength(0)
  })

  it('a T keeps a rim only on the side its missing arm faces', () => {
    expect(roadShoulderPolys('t-no-n')).toHaveLength(2)
    expect(roadShoulderPolys('t-no-w')).toHaveLength(2)
  })

  it('a dead end is rimmed on three sides of its one arm', () => {
    expect(roadShoulderPolys('cap-n')).toHaveLength(2)
  })

  it('every rim stays inside its own tile, so it cannot band a neighbour', () => {
    const inDiamond = (x: number, y: number): boolean =>
      Math.abs(x) / (TILE_W / 2) + Math.abs(y - TILE_H / 2) / (TILE_H / 2) <= 1.001
    for (const key of ROAD_AUTOTILE_KEYS) {
      for (const poly of roadShoulderPolys(key)) {
        for (let i = 0; i < poly.length; i += 2) {
          expect(inDiamond(poly[i]!, poly[i + 1]!), `${key}`).toBe(true)
        }
      }
    }
  })
})

describe('a road run is CONNECTED', () => {
  it('a straight 5-tile run: one end reaches the other', () => {
    const t = road(9, [[4, 2], [4, 3], [4, 4], [4, 5], [4, 6]])
    const r = rasterRun(t)
    expect(reaches(r, centreOf(r, 4, 2), centreOf(r, 4, 6))).toBe(true)
  })

  it('a straight 5-tile run the other way, too', () => {
    const t = road(9, [[2, 4], [3, 4], [4, 4], [5, 4], [6, 4]])
    const r = rasterRun(t)
    expect(reaches(r, centreOf(r, 2, 4), centreOf(r, 6, 4))).toBe(true)
  })

  it('an L-bend stays connected across the corner', () => {
    const t = road(9, [[2, 4], [3, 4], [4, 4], [4, 5], [4, 6]])
    const r = rasterRun(t)
    expect(reaches(r, centreOf(r, 2, 4), centreOf(r, 4, 6))).toBe(true)
  })

  it('and two runs that never touch are still SEPARATE — the test discriminates', () => {
    const t = road(12, [[2, 2], [3, 2], [4, 2], [8, 8], [9, 8], [10, 8]])
    const r = rasterRun(t)
    expect(reaches(r, centreOf(r, 2, 2), centreOf(r, 10, 8))).toBe(false)
  })
})


// TERRAIN V2.1. The plaza cobble reads right at plaza scale and as a noisy stone-string on a
// 16px ribbon, so thin runs draw from a calmer material. The rule has to separate a wide area
// from a one-tile-wide run, and "belongs to a fully-road 2x2 block" is the simplest one that
// actually does — including at a crossroads, where each 2x2 still holds a diagonal of grass.
describe('mass vs ribbon', () => {
  const grid = (n: number, cells: Array<[number, number]>): TileId[][] => {
    const t: TileId[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0 as TileId))
    for (const [x, y] of cells) t[y]![x] = ROAD_TILE_ID as TileId
    return t
  }
  const block = (x0: number, y0: number, w: number, h: number): Array<[number, number]> => {
    const out: Array<[number, number]> = []
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push([x, y])
    return out
  }

  it('EVERY tile of a plaza is mass — edges and corners too', () => {
    const t = grid(12, block(3, 3, 5, 5))
    for (let y = 3; y < 8; y++) for (let x = 3; x < 8; x++) {
      expect(isRoadMass(t, x, y), `${x},${y}`).toBe(true)
    }
  })

  it('NO tile of a one-wide run is mass, in either direction', () => {
    const ns = grid(12, [[5, 2], [5, 3], [5, 4], [5, 5], [5, 6]])
    for (let y = 2; y <= 6; y++) expect(isRoadMass(ns, 5, y), `ns ${y}`).toBe(false)
    const ew = grid(12, [[2, 5], [3, 5], [4, 5], [5, 5], [6, 5]])
    for (let x = 2; x <= 6; x++) expect(isRoadMass(ew, x, 5), `ew ${x}`).toBe(false)
  })

  it('a crossroads of two thin runs is STILL a ribbon — each 2x2 holds a diagonal of grass', () => {
    const t = grid(12, [[5, 3], [5, 4], [5, 5], [5, 6], [5, 7], [3, 5], [4, 5], [6, 5], [7, 5]])
    expect(roadArms('cross')).toEqual({ n: true, e: true, s: true, w: true })
    expect(isRoadMass(t, 5, 5)).toBe(false)
  })

  it('a 2x2 patch is the smallest thing that counts as mass', () => {
    const t = grid(8, block(3, 3, 2, 2))
    for (const [x, y] of block(3, 3, 2, 2)) expect(isRoadMass(t, x, y), `${x},${y}`).toBe(true)
  })

  it('splits the field into a calm ribbon layer and a cobbled mass layer', () => {
    const t = grid(14, [...block(4, 4, 4, 4), [9, 5], [10, 5], [11, 5]])
    const records = [
      { id: 'cob', seq: 1, class: 'terrain', kind: 'material:road', status: 'ready', desc: 'r',
        meta: null, footprint: { w: 1, h: 1 }, widthPx: 256, heightPx: 256,
        score: 10, attempts: 1, costUsd: 0, createdAt: 'x' },
      { id: 'calm', seq: 2, class: 'terrain', kind: 'material:road-calm', status: 'ready', desc: 'c',
        meta: null, footprint: { w: 1, h: 1 }, widthPx: 256, heightPx: 256,
        score: 10, attempts: 1, costUsd: 0, createdAt: 'x' },
    ] as unknown as AssetRecord[]
    const f = groundField(t, records)
    const calm = f.layers.find((l) => l.id === CALM_ROAD_KIND)!
    const cobble = f.layers.find((l) => l.id === 'road')!
    expect(calm.url).toBe('/assets/calm.png')
    expect(cobble.url).toBe('/assets/cob.png')
    expect(cobble.shapes).toHaveLength(16)          // the 4x4 mass
    expect(calm.shapes).toHaveLength(3)             // the thin spur
    // both are road, so both keep the rim rule and both draw over the ground
    expect(calm.kind).toBe('road')
    expect(f.layers.at(-1)!.kind).toBe('road')
  })

  it('falls back to the cobble material when no calm one has been generated', () => {
    const t = grid(10, [[4, 4], [5, 4], [6, 4]])
    const records = [
      { id: 'cob', seq: 1, class: 'terrain', kind: 'material:road', status: 'ready', desc: 'r',
        meta: null, footprint: { w: 1, h: 1 }, widthPx: 256, heightPx: 256,
        score: 10, attempts: 1, costUsd: 0, createdAt: 'x' },
    ] as unknown as AssetRecord[]
    expect(groundField(t, records).layers.find((l) => l.id === CALM_ROAD_KIND)!.url)
      .toBe('/assets/cob.png')
  })
})
