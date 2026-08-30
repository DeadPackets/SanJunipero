import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { genesisTerrainAt } from '@sj/engine'
import type { TileId } from '@sj/engine/state'
import { TILE_H, TILE_W, tileToScreen } from './iso.js'
import { groundOverhangTiles, rectOnGround, screenToTileF, type ScreenRect } from './ground.js'
import {
  CANOPY_PX,
  SHIMMER_MAX,
  SHIMMER_PX,
  TREES_MAX,
  decorationQuad,
  sampleDecorations,
  type Decoration,
} from './ambient.js'

// Nothing the renderer draws may leave the terrain extent. A canopy is 20 px tall and stands on
// its tile's CENTRE, so it reaches 12 px above that tile's top vertex — over the neighbour
// up-left, and on row 0 and column 0 there is no neighbour up-left, only the void.

const GRASS: TileId = 0,
  WATER: TileId = 2,
  FOREST: TileId = 3

const grid = (w: number, h: number, fill: TileId): TileId[][] =>
  Array.from({ length: h }, () => Array.from({ length: w }, () => fill))

/** The superseded sampler, frozen: scan in row order, cap, place, with no question asked about the ground — kept as data so the defect can be re-measured without breaking the shipped code. */
function sampleDecorationsPreFix(terrain: TileId[][]): Decoration[] {
  const out: Decoration[] = []
  for (let y = 0, n = 0; y < terrain.length && n < SHIMMER_MAX; y++)
    for (let x = 0; x < terrain[y]!.length && n < SHIMMER_MAX; x++)
      if (terrain[y]![x] === WATER) {
        const { sx, sy } = tileToScreen(x, y)
        out.push({ kind: 'shimmer', x, y, sx: sx - 1, sy: sy + TILE_H / 2 })
        n++
      }
  for (let y = 0, n = 0; y < terrain.length && n < TREES_MAX; y++)
    for (let x = 0; x < terrain[y]!.length && n < TREES_MAX; x++)
      if (terrain[y]![x] === FOREST) {
        const { sx, sy } = tileToScreen(x, y)
        out.push({ kind: 'tree', x, y, sx, sy: sy + TILE_H / 2 })
        n++
      }
  return out
}

const GENESIS: TileId[][] = (() => {
  const { w, h } = DEFAULT_CONFIG.world.size
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => genesisTerrainAt(x, y)),
  )
})()

const offenders = (terrain: TileId[][], ds: readonly Decoration[]): Decoration[] =>
  ds.filter((d) => !rectOnGround(terrain, decorationQuad(d)))

/** The AABB of the painted field — what a cull-shaped test would ask about instead. */
function fieldAabb(terrain: TileId[][]): ScreenRect {
  const h = terrain.length,
    w = terrain[0]!.length
  return { x0: -h * (TILE_W / 2), y0: 0, x1: w * (TILE_W / 2), y1: (w + h) * (TILE_H / 2) }
}
const insideAabb = (b: ScreenRect, r: ScreenRect): boolean =>
  r.x0 >= b.x0 && r.x1 <= b.x1 && r.y0 >= b.y0 && r.y1 <= b.y1

describe('the painted ground, as a predicate', () => {
  it('is the field geometry read back: a tile covers [x,x+1]x[y,y+1] from its TOP vertex', () => {
    const { sx, sy } = tileToScreen(3, 5)
    expect(screenToTileF(sx, sy)).toEqual({ fx: 3, fy: 5 }) // top vertex
    expect(screenToTileF(sx + TILE_W / 2, sy + TILE_H / 2)).toEqual({ fx: 4, fy: 5 }) // right
    expect(screenToTileF(sx, sy + TILE_H)).toEqual({ fx: 4, fy: 6 }) // bottom
    expect(screenToTileF(sx - TILE_W / 2, sy + TILE_H / 2)).toEqual({ fx: 3, fy: 6 }) // left
  })

  it('measures the overhang in tiles, signed, so a touch is 0 and not a pass by luck', () => {
    const t = grid(4, 4, GRASS)
    const top = tileToScreen(0, 0)
    expect(groundOverhangTiles(t, { x0: top.sx, y0: top.sy, x1: top.sx, y1: top.sy })).toBeCloseTo(
      0,
      12,
    )
    expect(
      groundOverhangTiles(t, { x0: top.sx, y0: top.sy - TILE_H, x1: top.sx, y1: top.sy }),
    ).toBe(1)
    expect(rectOnGround(t, { x0: top.sx, y0: top.sy - 1, x1: top.sx, y1: top.sy })).toBe(false)
  })
})

describe('★ nothing the decoration layer draws leaves the terrain extent', () => {
  it('holds on the genesis world — the one the product wakes into', () => {
    const bad = offenders(GENESIS, sampleDecorations(GENESIS))
    expect(bad.map((d) => `${d.kind} (${d.x},${d.y})`)).toEqual([])
  })

  it('holds on a world that is nothing but forest, where every edge tile is a candidate', () => {
    const all = grid(6, 6, FOREST)
    expect(offenders(all, sampleDecorations(all))).toEqual([])
    // not vacuous: the interior is still decorated. A canopy stands on its tile's feet — the
    // south vertex — so only the 4x4 interior holds one.
    expect(sampleDecorations(all).length).toBe(16)
  })

  it('holds on water too — the shimmer is a quad like any other', () => {
    const lake = grid(5, 5, WATER)
    expect(offenders(lake, sampleDecorations(lake))).toEqual([])
    expect(sampleDecorations(lake).length).toBeGreaterThan(0)
  })

  // ★ THE RED PROOF, FROZEN, AND THE MUTATION IN ONE. The pre-fix sampler is the mutation: it
  // is the shipped code with the ground law taken out, and the law catches it every time.
  it('★ MUTATION: with the ground law removed, it names every quad that leaves the ground', () => {
    const bad = offenders(GENESIS, sampleDecorationsPreFix(GENESIS))
    expect(bad.length).toBe(38)
    expect(bad.every((d) => d.kind === 'tree')).toBe(true)
    expect(bad.every((d) => d.y === 0 || d.x === 0)).toBe(true)
    const worst = Math.max(...bad.map((d) => groundOverhangTiles(GENESIS, decorationQuad(d))))
    expect(worst).toBeCloseTo(0.9375, 6) // 15 world px past the edge
    expect(worst * (TILE_W / 2)).toBeCloseTo(15, 6)
  })

  it('★ MUTATION: and on a forest world it names the whole first row and column', () => {
    const all = grid(6, 6, FOREST)
    const bad = offenders(all, sampleDecorationsPreFix(all))
    expect(bad.map((d) => `${d.x},${d.y}`).sort()).toEqual(
      [...Array(6).keys()]
        .flatMap((i) => [`${i},0`, `0,${i}`])
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort(),
    )
  })

  // ★ WHY THIS IS NOT ASKED OF THE CULL'S AABB, MEASURED RATHER THAN ARGUED.
  it('an AABB test would be satisfiable with the property broken', () => {
    const bad = offenders(GENESIS, sampleDecorationsPreFix(GENESIS))
    const box = fieldAabb(GENESIS)
    expect(bad.length).toBeGreaterThan(0)
    expect(
      bad.filter((d) => !insideAabb(box, decorationQuad(d))),
      "every quad that leaves the painted ground is still inside its bounding box — a diamond's " +
        'AABB has void in all four corners',
    ).toEqual([])
  })
})

describe('the decoration quads are the ones the renderer paints', () => {
  it('a canopy stands bottom-centre on the tile centre and reaches 12 px above its top vertex', () => {
    const { sx, sy } = tileToScreen(4, 4)
    const q = decorationQuad({ kind: 'tree', x: 4, y: 4, sx, sy: sy + TILE_H / 2 })
    expect(q).toEqual({
      x0: sx - CANOPY_PX.w / 2,
      x1: sx + CANOPY_PX.w / 2,
      y0: sy + TILE_H / 2 - CANOPY_PX.h,
      y1: sy + TILE_H / 2,
    })
    expect(sy - q.y0).toBe(CANOPY_PX.h - TILE_H / 2)
  })

  it('a shimmer is a 2 px square anchored top-left', () => {
    const { sx, sy } = tileToScreen(4, 4)
    const q = decorationQuad({ kind: 'shimmer', x: 4, y: 4, sx: sx - 1, sy: sy + TILE_H / 2 })
    expect(q.x1 - q.x0).toBe(SHIMMER_PX.w)
    expect(q.y1 - q.y0).toBe(SHIMMER_PX.h)
  })

  it('the caps still hold, and dropping an edge tile does not let a 81st tree in', () => {
    const big = grid(40, 40, FOREST)
    expect(sampleDecorations(big).filter((d) => d.kind === 'tree').length).toBe(TREES_MAX)
    const lake = grid(40, 40, WATER)
    expect(sampleDecorations(lake).filter((d) => d.kind === 'shimmer').length).toBe(SHIMMER_MAX)
  })
})
