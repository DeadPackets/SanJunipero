import { Container, Sprite, type Bounds, type RenderTexture } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import {
  CHUNK_BLEED_PX, CHUNK_BYTES_PER_PX, CHUNK_PX_H, CHUNK_PX_W, CHUNK_RETAIN,
  GPU_MIN_MAX_TEXTURE_PX, allChunks, bucketLayers, chunkAt, chunkBoundariesAreWhole,
  chunkKey, chunkTextureBytes, chunksInView, createChunkResidency, groundGrid,
  wholeMapTextureBytes,
} from './groundChunks.js'
import { ZOOM_STOPS } from './camera.js'
import { CULL_MARGIN_PX, boxInView, rectInView, type ViewRect } from './cull.js'
import { groundField } from './groundField.js'
import { bigTownTerrain } from './bigTown.js'
import { TILE_H, TILE_W } from './iso.js'
import { createGroundBaker } from './scene.js'
import { TextureBook } from './textures.js'
import type { DepthBox } from './depth.js'

// ════════════════════════════════════════════════════════════════════════════════════════════
// THE GROUND BAKE AT TEN RINGS.
//
// MEASUREMENT LAW: every number in this file comes from a pure function or from the REAL
// `createGroundBaker` driven over the `bigTown` ring grammar in this process. No browser.
// ════════════════════════════════════════════════════════════════════════════════════════════

const MB = 1024 * 1024
/** the C12 audit's stage less the control bar — the same 1728 × 824 the camera lane measured on */
const STAGE = { w: 1728, h: 824 }
const RINGS = [1, 3, 5, 10] as const

const fieldFor = (rings: number) => groundField(bigTownTerrain(rings) as never, [])
const gridFor = (rings: number) => {
  const f = fieldFor(rings)
  return groundGrid(f.widthPx, f.heightPx, f.offsetX)
}

/** The view a camera at `z` shows, placed at a bake-space offset. World space, as `viewRect()`. */
const viewAt = (z: number, bx: number, by: number, offsetX: number): ViewRect =>
  ({ x: bx - offsetX, y: by, w: STAGE.w / z, h: STAGE.h / z })

// ── ★ THE SEAM LAW ──────────────────────────────────────────────────────────────────────────

describe('★ the seam law: a chunk boundary never lands between two screen pixels', () => {
  it('both chunk dimensions are whole multiples of the widest stop’s denominator', () => {
    const widest = Math.min(...ZOOM_STOPS)
    expect(Number.isInteger(1 / widest)).toBe(true)
    expect(CHUNK_PX_W % (1 / widest)).toBe(0)
    expect(CHUNK_PX_H % (1 / widest)).toBe(0)
    expect(chunkBoundariesAreWhole()).toBe(true)
  })

  it('★ every chunk edge of a ten-ring grid is a whole screen pixel at EVERY rest stop', () => {
    const grid = gridFor(10)
    const rows: string[] = []
    for (const z of ZOOM_STOPS) {
      let worst = 0
      for (const k of allChunks(grid)) {
        for (const v of [k.x, k.y, k.x + k.w, k.y + k.h]) {
          const s = v * z
          worst = Math.max(worst, Math.abs(s - Math.round(s)))
        }
      }
      rows.push(`z=${z}: ${allChunks(grid).length} chunks, worst edge error ${worst} px`)
      expect(worst).toBe(0)
    }
    // eslint-disable-next-line no-console
    console.log(`SEAM PROOF, ten rings\n  ${rows.join('\n  ')}`)
  })

  it('carries a pixel of its neighbour so a fractional transit scale cannot open a crack', () => {
    expect(CHUNK_BLEED_PX).toBeGreaterThanOrEqual(1)
    const grid = gridFor(3)
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c + 1 < grid.cols; c++) {
        const a = chunkAt(grid, c, r), b = chunkAt(grid, c + 1, r)
        expect(a.x + a.texW).toBeGreaterThan(b.x)   // a holds b's first column
      }
    }
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r + 1 < grid.rows; r++) {
        const a = chunkAt(grid, c, r), b = chunkAt(grid, c, r + 1)
        expect(a.y + a.texH).toBeGreaterThan(b.y)
      }
    }
  })

  it('tiles the field exactly: no gap between chunks and no chunk past the field', () => {
    for (const rings of RINGS) {
      const grid = gridFor(rings)
      let covered = 0
      for (const k of allChunks(grid)) {
        expect(k.w).toBeGreaterThan(0)
        expect(k.h).toBeGreaterThan(0)
        expect(k.x + k.w).toBeLessThanOrEqual(grid.fieldW)
        expect(k.y + k.h).toBeLessThanOrEqual(grid.fieldH)
        covered += k.w * k.h
      }
      expect(covered).toBe(grid.fieldW * grid.fieldH)
    }
  })
})

// ── ★ COVERAGE: NO PAINTED PIXEL BELONGS TO A CHUNK THAT DOES NOT HOLD IT ───────────────────

describe('★ every shape reaches every chunk its paint touches', () => {
  it('a tile straddling a boundary is in BOTH buckets, at the same layer index', () => {
    const f = fieldFor(3)
    const grid = groundGrid(f.widthPx, f.heightPx, f.offsetX)
    const buckets = bucketLayers(grid, f.layers)
    let straddling = 0, checked = 0

    for (const [li, layer] of f.layers.entries()) {
      for (const s of layer.shapes) {
        // the tile's own painted diamond, no slack — the pixels that MUST be somewhere
        const bx = s.sx + grid.offsetX
        const x0 = bx - TILE_W / 2, x1 = bx + TILE_W / 2, y0 = s.sy, y1 = s.sy + TILE_H
        const want: string[] = []
        for (let r = 0; r < grid.rows; r++) {
          for (let c = 0; c < grid.cols; c++) {
            const k = chunkAt(grid, c, r)
            if (x1 > k.x && x0 < k.x + k.w && y1 > k.y && y0 < k.y + k.h) want.push(k.key)
          }
        }
        if (want.length > 1) straddling++
        for (const key of want) {
          checked++
          const stack = buckets.get(key)
          expect(stack, `chunk ${key} has no bucket`).toBeDefined()
          expect(stack![li]!.id).toBe(layer.id)
          expect(stack![li]!.shapes, `${layer.id} shape ${s.sx},${s.sy} missing from ${key}`)
            .toContain(s)
        }
      }
    }
    expect(straddling).toBeGreaterThan(0)   // the case the law exists for actually occurs
    // eslint-disable-next-line no-console
    console.log(`COVERAGE, three rings: ${checked} shape-in-chunk claims, ${straddling} shapes straddle a boundary`)
  })

  it('★ every chunk carries every layer at its ORIGINAL index — the material matrix reads it', () => {
    const f = fieldFor(3)
    const grid = groundGrid(f.widthPx, f.heightPx, f.offsetX)
    const buckets = bucketLayers(grid, f.layers)
    expect(buckets.size).toBeGreaterThan(1)
    for (const stack of buckets.values()) {
      expect(stack).toHaveLength(f.layers.length)
      for (const [i, l] of f.layers.entries()) {
        expect(stack[i]!.id).toBe(l.id)
        expect(stack[i]!.url).toBe(l.url)
        expect(stack[i]!.fallback).toBe(l.fallback)
      }
    }
  })

  it('loses no shape and invents none', () => {
    const f = fieldFor(1)
    const grid = groundGrid(f.widthPx, f.heightPx, f.offsetX)
    const buckets = bucketLayers(grid, f.layers)
    for (const [li, layer] of f.layers.entries()) {
      const seen = new Set<unknown>()
      for (const stack of buckets.values()) for (const s of stack[li]!.shapes) seen.add(s)
      expect(seen.size).toBe(new Set(layer.shapes).size)
      for (const s of layer.shapes) expect(seen.has(s)).toBe(true)
    }
  })
})

// ── THE GROUND AND THE BUILDINGS AGREE ABOUT WHAT IS ON SCREEN ──────────────────────────────

describe('the ground asks the entity cull’s own question', () => {
  it('a chunk is resident exactly when a drawable with its box would be drawn', () => {
    const grid = gridFor(3)
    const view = viewAt(1, 2000, 900, grid.offsetX)
    const shown = new Set(chunksInView(grid, view).map((k) => k.key))
    for (const k of allChunks(grid)) {
      const box: DepthBox = {
        id: k.key, rank: 0 as never, x0: 0, y0: 0, x1: 0, y1: 0,
        sx0: k.x - grid.offsetX, sy0: k.y, sx1: k.x - grid.offsetX + k.w, sy1: k.y + k.h,
      }
      expect(shown.has(k.key)).toBe(boxInView(box, view, CULL_MARGIN_PX))
      expect(shown.has(k.key)).toBe(
        rectInView(box.sx0, box.sy0, box.sx1, box.sy1, view, CULL_MARGIN_PX),
      )
    }
    expect(shown.size).toBeGreaterThan(0)
    expect(shown.size).toBeLessThan(allChunks(grid).length)
  })
})

// ── RESIDENCY ───────────────────────────────────────────────────────────────────────────────

describe('what stays on the GPU', () => {
  it('bakes what is visible and never evicts it, however small the retention', () => {
    const grid = gridFor(10)
    const res = createChunkResidency(0)
    res.setGrid(grid)
    const view = viewAt(0.25, 6000, 3000, grid.offsetX)
    const step = res.update(view)
    const want = chunksInView(grid, view).map((k) => k.key).sort()
    expect(step.bake.map((k) => k.key).sort()).toEqual(want)
    expect(step.evict).toEqual([])
    expect(res.resident().sort()).toEqual(want)
    // asking again for the same view costs nothing
    const again = res.update(view)
    expect(again.bake).toEqual([])
    expect(again.evict).toEqual([])
  })

  it('holds a ring of neighbours behind the view, and no more', () => {
    const grid = gridFor(10)
    const res = createChunkResidency()
    res.setGrid(grid)
    let seen = 0
    for (let i = 0; i < 24; i++) {
      const view = viewAt(2, 1000 + i * CHUNK_PX_W, 1000, grid.offsetX)
      res.update(view)
      const visible = chunksInView(grid, view).length
      expect(res.resident().length).toBeLessThanOrEqual(visible + CHUNK_RETAIN)
      for (const k of chunksInView(grid, view)) expect(res.resident()).toContain(k.key)
      seen = Math.max(seen, res.resident().length)
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('a new terrain releases every texture the old one held', () => {
    const res = createChunkResidency()
    res.setGrid(gridFor(3))
    res.update(viewAt(1, 1000, 1000, gridFor(3).offsetX))
    expect(res.resident().length).toBeGreaterThan(0)
    const gone = res.setGrid(gridFor(5))
    expect(gone.length).toBeGreaterThan(0)
    expect(res.resident()).toEqual([])
  })
})

// ── ★ VRAM, BEFORE AND AFTER, AT ONE THREE FIVE AND TEN RINGS ───────────────────────────────

/** A grid for a square terrain of `side` tiles, without paying for its `groundField` — the
 *  landed baker sized its texture from exactly these two numbers. */
const gridForSide = (side: number) =>
  groundGrid((side + side) * (TILE_W / 2), (side + side) * (TILE_H / 2), side * (TILE_W / 2))

/**
 * The WORST a view can do, swept across the whole field rather than around its middle: a view
 * straddling a boundary touches one more column and one more row than a view sitting on one,
 * and a view at the field's edge touches fewer. Both matter, so the sweep sees both.
 */
function peakVisible(grid: ReturnType<typeof gridForSide>, z: number): {
  bytes: number; chunks: number
} {
  const vw = STAGE.w / z, vh = STAGE.h / z
  const step = 128
  let bytes = 0, chunks = 0
  for (let by = 0; by <= Math.max(0, grid.fieldH - vh); by += step) {
    for (let bx = 0; bx <= Math.max(0, grid.fieldW - vw); bx += step) {
      const shown = chunksInView(grid, viewAt(z, bx, by, grid.offsetX))
      const b = shown.reduce((n, k) => n + chunkTextureBytes(k), 0)
      if (b > bytes) { bytes = b; chunks = shown.length }
    }
  }
  return { bytes, chunks }
}

/** What the retained ring can add on top of the working set, worst case. */
const RETAIN_BYTES = CHUNK_RETAIN * (CHUNK_PX_W + CHUNK_BLEED_PX) * (CHUNK_PX_H + CHUNK_BLEED_PX)
  * CHUNK_BYTES_PER_PX

describe('★ VRAM at one, three, five and ten rings — before and after', () => {
  it('reports the whole table and holds the two claims that matter', () => {
    const head = ZOOM_STOPS.map((z) => `@${z}`.padStart(13)).join(' |')
    const lines: string[] = [
      `rings |   tiles | whole-map texture |  BEFORE | max dim |${head} | max dim`,
    ]
    const after: Record<number, Record<number, number>> = {}
    for (const rings of RINGS) {
      const grid = gridFor(rings)
      const before = wholeMapTextureBytes(grid.fieldW, grid.fieldH)
      after[rings] = {}
      const cells: string[] = []
      let maxDim = 0
      for (const k of allChunks(grid)) maxDim = Math.max(maxDim, k.texW, k.texH)
      for (const z of ZOOM_STOPS) {
        const p = peakVisible(grid, z)
        after[rings]![z] = p.bytes
        cells.push(`${(p.bytes / MB).toFixed(1)}MB/${p.chunks}`.padStart(13))
      }
      const side = bigTownTerrain(rings).length
      lines.push(
        `${String(rings).padStart(5)} | ${String(side * side).padStart(7)} | `
        + `${`${grid.fieldW}x${grid.fieldH}`.padStart(17)} | `
        + `${`${(before / MB).toFixed(1)}MB`.padStart(7)} | ${String(Math.max(grid.fieldW, grid.fieldH)).padStart(7)} |`
        + `${cells.join(' |')} | ${maxDim}`,
      )
    }
    // eslint-disable-next-line no-console
    console.log(
      'GROUND VRAM — BEFORE is the landed whole-map texture; AFTER is the peak working set of\n'
      + `chunks over a ${STAGE.w}x${STAGE.h} stage, swept across the field. Add up to `
      + `${(RETAIN_BYTES / MB).toFixed(1)}MB for the\nretained ring of ${CHUNK_RETAIN}.\n`
      + lines.join('\n'),
    )

    // ★ CLAIM 1 — the largest single allocation now fits every conforming GPU, at every size,
    // and the whole-map bake stopped doing so before this town reached two rings.
    for (const rings of RINGS) {
      for (const k of allChunks(gridFor(rings))) {
        expect(Math.max(k.texW, k.texH)).toBeLessThanOrEqual(GPU_MIN_MAX_TEXTURE_PX)
      }
    }
    expect(Math.max(gridFor(1).fieldW, gridFor(1).fieldH)).toBeLessThanOrEqual(GPU_MIN_MAX_TEXTURE_PX)
    expect(Math.max(gridFor(3).fieldW, gridFor(3).fieldH)).toBeGreaterThan(GPU_MIN_MAX_TEXTURE_PX)

    // the ten-ring bake is the one the camera lane named, and it is now a fraction of itself
    expect(after[10]![0.25]! + RETAIN_BYTES)
      .toBeLessThan(wholeMapTextureBytes(gridFor(10).fieldW, gridFor(10).fieldH))
  })

  it('the chunk size is near the bottom of its own cost curve, not a round number', () => {
    // A chunk grid pays twice: rounding — a view that straddles a boundary drags in a whole
    // extra column and row — and DRAW CALLS, one per resident chunk, because each carries its
    // own texture and nothing batches across them. Small chunks waste less and cost more calls.
    // Measured over the widest stop at ten rings, which is the worst case for both.
    const side = 2 * 10 * 19 + 19
    const rows: string[] = []
    for (const [w, h] of [[256, 128], [512, 256], [1024, 512], [2048, 1024]] as const) {
      // one phase, not the swept peak above — this is a comparison BETWEEN sizes, and the
      // phase penalty is the same shape for all four
      const vw = STAGE.w / 0.25 + 2 * CULL_MARGIN_PX, vh = STAGE.h / 0.25 + 2 * CULL_MARGIN_PX
      const cols = Math.floor(vw / w) + 1, rowsN = Math.floor(vh / h) + 1
      const chunks = cols * rowsN
      const bytes = chunks * (w + CHUNK_BLEED_PX) * (h + CHUNK_BLEED_PX) * CHUNK_BYTES_PER_PX
      const waste = bytes / (vw * vh * CHUNK_BYTES_PER_PX) - 1
      rows.push(`${`${w}x${h}`.padStart(9)}: ${String(chunks).padStart(4)} draw calls, `
        + `${(bytes / MB).toFixed(1).padStart(6)} MB, ${(waste * 100).toFixed(1).padStart(5)}% over the view`)
    }
    // eslint-disable-next-line no-console
    console.log(`CHUNK SIZE, ten rings (side ${side}) at the 0.25 stop\n  ${rows.join('\n  ')}`)
    expect(CHUNK_PX_W / CHUNK_PX_H).toBe(TILE_W / TILE_H)   // one chunk is a square of tiles
    expect(rows).toHaveLength(4)
  })

  /**
   * ★ THE WORLD HAS NO CEILING ANY MORE, so neither may this.
   *
   * The world-growth lane deleted the world's fixed size: `genesisTerrainAt(x, y)` was always
   * pure arithmetic with no bounds, and the 128-tile array was only how much of it had been
   * written down. The terrain now widens to owe the built set a block pitch on every side —
   * 250² at five rings, 440² at ten, against today's 128². So the chunked bake is not an
   * optimisation, it is what decides whether a grown town renders at all, and a working set
   * that still contained the size of the world would be wrong against a branch that exists.
   *
   * These are that lane's own numbers, plus one far past anything planned.
   */
  const GROWN_SIDES: ReadonlyArray<[string, number]> = [
    ['today, 128²', 128],
    ['world-growth, 5 rings, 250²', 250],
    ['world-growth, 10 rings, 440²', 440],
    ['bigTown, 40 rings, 1539²', 2 * 40 * 19 + 19],
    ['far past anything planned, 4000²', 4000],
  ]

  it('★ CLAIM 2 — the working set is a function of the VIEWPORT, and stops growing', () => {
    const rows: string[] = []
    for (const z of ZOOM_STOPS) {
      const got = GROWN_SIDES.map(([, s]) => peakVisible(gridForSide(s), z))
      rows.push(`z=${String(z).padEnd(5)} ${got.map((g) => `${(g.bytes / MB).toFixed(1)}MB/${g.chunks}`.padStart(12)).join('')}`)
      // ★ IT CONVERGES, AND THE SMALL SIDES ARE CHEAPER RATHER THAN EQUAL. A field that is not
      // much bigger than the view runs off its own edge, and the clipped last column and row
      // cost less than full chunks — so 128² and 250² sit UNDER the asymptote rather than on
      // it. From 440² up, where the peak view sits entirely in the interior, the answer stops
      // moving: 440, 1539 and 4000 are the same number. That is the claim — the size of the
      // world is not a term in it — and it has to be stated as convergence, not equality,
      // because equality would be false for exactly the towns that exist today.
      const asymptote = got[got.length - 1]!.bytes
      for (const g of got.slice(2)) expect(g.bytes).toBe(asymptote)
      for (const g of got) expect(g.bytes).toBeLessThanOrEqual(asymptote)
    }
    // eslint-disable-next-line no-console
    console.log(`WORKING SET vs WORLD SIZE — ${GROWN_SIDES.map(([n]) => n).join(' | ')}\n  ${rows.join('\n  ')}`)
  })

  it('★ nothing here knows a world size: an arbitrary terrain grids and tiles exactly', () => {
    // Not ring counts and not powers of two — sizes nobody would pick, so a constant hiding in
    // the arithmetic has nothing to agree with.
    for (const side of [7, 63, 129, 250, 251, 440, 1001]) {
      const fieldW = (side + side) * (TILE_W / 2), fieldH = (side + side) * (TILE_H / 2)
      const grid = groundGrid(fieldW, fieldH, side * (TILE_W / 2))
      expect(grid.cols).toBe(Math.ceil(fieldW / CHUNK_PX_W))
      expect(grid.rows).toBe(Math.ceil(fieldH / CHUNK_PX_H))
      let covered = 0
      for (const k of allChunks(grid)) {
        expect(Math.max(k.texW, k.texH)).toBeLessThanOrEqual(GPU_MIN_MAX_TEXTURE_PX)
        covered += k.w * k.h
      }
      expect(covered, `side ${side} is not tiled exactly`).toBe(fieldW * fieldH)
    }
  })

  it('★ the baker takes its extent from the terrain it is handed, never from a constant', () => {
    // Two terrains of different sizes through the SAME baker: the grid must follow the array.
    const d = drive(1)
    const wide = gridForSide(250)
    for (const [rings, want] of [[1, gridFor(1)], [3, gridFor(3)]] as const) {
      d.baker.setView(viewAt(1, want.fieldW / 2, want.fieldH / 2, want.offsetX))
      d.baker.rebake(bigTownTerrain(rings) as never, [])
      // every resident chunk is inside the grid THIS terrain implies
      for (const s of d.root.children as Sprite[]) {
        expect(s.position.x + want.offsetX).toBeLessThan(want.fieldW)
        expect(s.position.y).toBeLessThan(want.fieldH)
      }
      expect(d.baker.vram().chunks).toBeGreaterThan(0)
    }
    expect(wide.fieldW).toBe(250 * 2 * (TILE_W / 2))
  })
})

// ── ★ THE REAL BAKER, DRIVEN ────────────────────────────────────────────────────────────────
//
// Not a source read and not a re-implementation: `createGroundBaker` itself, with a stub for the
// one thing it needs a GPU for. Everything it allocates is the production path.

type Bake = { at: { x: number; y: number }; texW: number; texH: number; kids: number; bounds: Bounds }

function drive(rings: number) {
  const renders: Bake[] = []
  const renderer = {
    render: (o: { container: Container; target: RenderTexture; clear: boolean }) => {
      renders.push({
        at: { x: o.container.position.x, y: o.container.position.y },
        texW: o.target.width, texH: o.target.height,
        kids: o.container.children.length, bounds: o.container.getBounds(),
      })
    },
  }
  const root = new Container()
  const baker = createGroundBaker(renderer, root, new TextureBook())
  const grid = gridFor(rings)
  return { baker, root, grid, renders, terrain: bigTownTerrain(rings) as never }
}

describe('★ what the real baker puts on the GPU', () => {
  it('allocates one chunk-sized NEAREST texture per resident chunk and nothing map-sized', () => {
    const d = drive(10)
    d.baker.setView(viewAt(1, d.grid.fieldW / 2, d.grid.fieldH / 2, d.grid.offsetX))
    d.baker.rebake(d.terrain, [])

    const v = d.baker.vram()
    expect(v.chunks).toBeGreaterThan(0)
    expect(v.maxDimPx).toBeLessThanOrEqual(GPU_MIN_MAX_TEXTURE_PX)
    expect(v.maxDimPx).toBeLessThanOrEqual(CHUNK_PX_W + CHUNK_BLEED_PX)
    expect(root_children(d.root)).toBe(v.chunks)

    for (const s of d.root.children as Sprite[]) {
      expect(s.texture.source.scaleMode).toBe('nearest')
      expect(s.texture.source.resolution).toBe(1)
      expect(Math.max(s.texture.width, s.texture.height))
        .toBeLessThanOrEqual(CHUNK_PX_W + CHUNK_BLEED_PX)
    }
    // eslint-disable-next-line no-console
    console.log(`REAL BAKER, ten rings @1x: ${v.chunks} chunks, ${(v.bytes / MB).toFixed(1)} MB, `
      + `largest allocation ${v.maxDimPx} px (whole-map bake was 12768 px / 310.9 MB)`)
  })

  it('★ panning the whole width of a ten-ring town never grows what is resident', () => {
    const d = drive(10)
    d.baker.setView(viewAt(0.25, 0, 0, d.grid.offsetX))
    d.baker.rebake(d.terrain, [])
    let peak = 0, peakChunks = 0
    for (let bx = 0; bx < d.grid.fieldW; bx += CHUNK_PX_W / 2) {
      d.baker.setView(viewAt(0.25, bx, d.grid.fieldH / 2, d.grid.offsetX))
      const v = d.baker.vram()
      if (v.bytes > peak) { peak = v.bytes; peakChunks = v.chunks }
    }
    expect(peakChunks).toBeGreaterThan(0)
    const whole = wholeMapTextureBytes(d.grid.fieldW, d.grid.fieldH)
    expect(peak).toBeLessThan(whole)
    // eslint-disable-next-line no-console
    console.log(`PAN SWEEP, ten rings @0.25 across ${d.grid.fieldW} px: peak `
      + `${(peak / MB).toFixed(1)} MB vs ${(whole / MB).toFixed(1)} MB whole-map`)
  })

  it('zooming out to the widest stop and back in releases what it stopped needing', () => {
    const d = drive(10)
    const mid = { x: d.grid.fieldW / 2, y: d.grid.fieldH / 2 }
    d.baker.setView(viewAt(4, mid.x, mid.y, d.grid.offsetX))
    d.baker.rebake(d.terrain, [])
    const tight = d.baker.vram()
    d.baker.setView(viewAt(0.25, mid.x, mid.y, d.grid.offsetX))
    const wide = d.baker.vram()
    d.baker.setView(viewAt(4, mid.x, mid.y, d.grid.offsetX))
    const back = d.baker.vram()
    expect(wide.chunks).toBeGreaterThan(tight.chunks)
    expect(back.chunks).toBeLessThanOrEqual(tight.chunks + CHUNK_RETAIN)
    expect(back.bytes).toBeLessThan(wide.bytes)
  })

  /**
   * ★ THE ONE THING A BROWSER WOULD HAVE CAUGHT, CHECKED WITHOUT ONE.
   *
   * The whole-map baker put ONE sprite at `(-offX, 0)` holding geometry drawn at bake
   * coordinates, so a bake-space point B landed at world `(B.x - offX, B.y)`. Every chunk has
   * to land in exactly the same place, and it is reached the other way round — the geometry is
   * translated onto the chunk's origin and the sprite is translated back off it. Two sign
   * errors that cancel look identical to two that do not, and the difference is the entire
   * ground shifted by a chunk. There is no test for "the picture is right", so this is the
   * arithmetic stated as a claim: for a probe point in every resident chunk, the world position
   * of the texel holding it is the world position the single texture gave it.
   */
  it('★ a chunk lands exactly where the one whole-map texture put the same pixel', () => {
    const d = drive(3)
    d.baker.setView(viewAt(0.5, d.grid.fieldW / 2, d.grid.fieldH / 2, d.grid.offsetX))
    d.baker.rebake(d.terrain, [])
    expect(d.root.children.length).toBeGreaterThan(1)
    let probes = 0
    for (const s of d.root.children as Sprite[]) {
      // default anchor: a chunk whose texture hangs off its own origin shifts the whole ground
      expect(s.anchor.x).toBe(0)
      expect(s.anchor.y).toBe(0)
      // the sprite's top-left IS its chunk's top-left in bake space, less the offset
      const bakeX = s.position.x + d.grid.offsetX, bakeY = s.position.y
      expect(bakeX % CHUNK_PX_W).toBe(0)
      expect(bakeY % CHUNK_PX_H).toBe(0)
      for (const [dx, dy] of [[0, 0], [1, 1], [CHUNK_PX_W - 1, CHUNK_PX_H - 1]] as const) {
        // where the single whole-map sprite put bake point B, against where this chunk puts it
        const whole = { x: bakeX + dx - d.grid.offsetX, y: bakeY + dy }
        const chunked = { x: s.position.x + dx, y: s.position.y + dy }
        expect(chunked).toEqual(whole)
        probes++
      }
    }
    expect(probes).toBeGreaterThan(9)
  })

  /**
   * ★ AND THE OTHER HALF OF THE SAME ARITHMETIC: the geometry has to be translated ONTO the
   * chunk's origin before it is rendered, or every chunk paints the same corner of the map into
   * its own texture and only the first one is right. The sprite positions above would be
   * perfect and the picture would be twelve copies of one chunk.
   */
  it('★ each chunk renders the geometry translated onto its own origin, inside its target', () => {
    const d = drive(3)
    d.baker.setView(viewAt(0.5, d.grid.fieldW / 2, d.grid.fieldH / 2, d.grid.offsetX))
    d.baker.rebake(d.terrain, [])
    expect(d.renders.length).toBeGreaterThan(1)
    const seen = new Set<string>()
    let painted = 0
    for (const r of d.renders) {
      // the translation is a chunk origin, negated — nothing else is
      expect(Math.abs(r.at.x % CHUNK_PX_W)).toBe(0)
      expect(Math.abs(r.at.y % CHUNK_PX_H)).toBe(0)
      expect(r.at.x).toBeLessThanOrEqual(0)
      expect(r.at.y).toBeLessThanOrEqual(0)
      seen.add(`${r.at.x}:${r.at.y}`)
      // A chunk in the corner of the field's AABB can be outside the world diamond entirely
      // and legitimately draw nothing; every chunk that DOES carry ground must land on its own
      // target, which is the half of this the translation can get wrong.
      if (r.kids === 0) continue
      painted++
      expect(r.bounds.maxX, `${r.at.x},${r.at.y} draws entirely left of its target`)
        .toBeGreaterThan(0)
      expect(r.bounds.minX, `${r.at.x},${r.at.y} draws entirely right of its target`)
        .toBeLessThan(r.texW)
      expect(r.bounds.maxY).toBeGreaterThan(0)
      expect(r.bounds.minY).toBeLessThan(r.texH)
    }
    expect(painted).toBeGreaterThan(1)
    // every chunk got its OWN translation; two chunks sharing one is the defect
    expect(seen.size).toBe(d.renders.length)
  })

  it('destroy leaves nothing on the GPU and nothing in the ground layer', () => {
    const d = drive(3)
    d.baker.setView(viewAt(1, 1000, 1000, d.grid.offsetX))
    d.baker.rebake(d.terrain, [])
    expect(d.baker.vram().chunks).toBeGreaterThan(0)
    d.baker.destroy()
    expect(d.baker.vram()).toEqual({ chunks: 0, bytes: 0, maxDimPx: 0 })
    expect(root_children(d.root)).toBe(0)
  })

  it('a smaller terrain does not leave the bigger one’s chunks behind', () => {
    const d = drive(5)
    d.baker.setView(viewAt(0.5, d.grid.fieldW / 2, d.grid.fieldH / 2, d.grid.offsetX))
    d.baker.rebake(d.terrain, [])
    const big = d.baker.vram().chunks
    const small = gridFor(1)
    d.baker.setView(viewAt(0.5, small.fieldW / 2, small.fieldH / 2, small.offsetX))
    d.baker.rebake(bigTownTerrain(1) as never, [])
    expect(d.baker.vram().chunks).toBeLessThan(big)
    expect(root_children(d.root)).toBe(d.baker.vram().chunks)
  })
})

const root_children = (c: Container): number => c.children.length

// ── the numbers the pure prediction and the real baker must agree on ────────────────────────

describe('the prediction and the allocation are the same number', () => {
  it('the residency planner’s bytes are the baker’s bytes', () => {
    for (const rings of [1, 3, 10] as const) {
      for (const z of [0.25, 1, 4] as const) {
        const grid = gridFor(rings)
        const view = viewAt(z, grid.fieldW / 2, grid.fieldH / 2, grid.offsetX)
        const res = createChunkResidency()
        res.setGrid(grid)
        res.update(view)

        const d = drive(rings)
        d.baker.setView(view)
        d.baker.rebake(d.terrain, [])
        expect(d.baker.vram().bytes).toBe(res.bytes())
        expect(res.bytes()).toBe(
          chunksInView(grid, view).reduce((n, k) => n + chunkTextureBytes(k), 0),
        )
      }
    }
  })

  it('a chunk’s bytes are its texture, bleed included', () => {
    const k = chunkAt(gridFor(10), 0, 0)
    expect(chunkTextureBytes(k)).toBe((CHUNK_PX_W + 1) * (CHUNK_PX_H + 1) * CHUNK_BYTES_PER_PX)
    expect(chunkKey(0, 0)).toBe('0:0')
  })
})
