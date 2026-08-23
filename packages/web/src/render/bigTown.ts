import { TILE_H, TILE_W } from './iso.js'

// A TOWN LARGER THAN THE VIEWPORT, BUILT WITHOUT THE GENERATOR.
//
// The approved layout plats blocks in rings around a square and agents claim plots forever, so
// the renderer has to be ready for an extent nobody wrote down. This module is that extent: the
// same 19-tile block pitch the grammar uses, laid out to any ring count, with a structure on
// every plot. It is a measuring instrument for the camera and the cull — the numbers in the
// camera report come from here — and it stands in no shipped scene.
//
// It lives here rather than in `cityTemplate.ts` because the template is a place agents live in
// and this is a ruler. Nothing imports it but tests.

/** 18 tiles of block and one of road between them, the pitch the ring grammar plats on. */
export const BLOCK_PITCH = 19
/** The plot side inside one block; the remaining tile of the pitch is the street. */
export const BLOCK_SIDE = BLOCK_PITCH - 1

export type FixtureStructure = {
  id: string
  kind: string
  x: number
  y: number
  w: number
  h: number
  stage: 'complete'
}

/** The footprints the town actually stands, smallest to largest — a 4×2 roof is the one that
 *  reaches furthest past its own ground, which is what a cull margin has to survive. */
const FOOTPRINTS: ReadonlyArray<{ kind: string; w: number; h: number }> = [
  { kind: 'well', w: 1, h: 1 },
  { kind: 'house', w: 2, h: 2 },
  { kind: 'cottage', w: 2, h: 2 },
  { kind: 'storehouse', w: 3, h: 2 },
  { kind: 'farmhouse', w: 4, h: 2 },
]

/** Eight plots around one block's perimeter, the way a street rank claims frontage. */
const PLOT_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 1, dy: 1 }, { dx: 7, dy: 1 }, { dx: 13, dy: 1 },
  { dx: 1, dy: 8 }, { dx: 13, dy: 8 },
  { dx: 1, dy: 15 }, { dx: 7, dy: 15 }, { dx: 13, dy: 15 },
]

/**
 * Every block in `rings` rings about the square, each with eight claimed plots. Ring 0 is the
 * square itself and stands nothing, so a town of R rings holds `((2R+1)² − 1) · 8` structures.
 * Deterministic: the same ring count always yields the same list, in the same order.
 */
export function bigTown(rings: number): FixtureStructure[] {
  const out: FixtureStructure[] = []
  for (let by = -rings; by <= rings; by++) {
    for (let bx = -rings; bx <= rings; bx++) {
      if (bx === 0 && by === 0) continue
      PLOT_OFFSETS.forEach((p, i) => {
        const f = FOOTPRINTS[(Math.abs(bx) * 3 + Math.abs(by) * 5 + i) % FOOTPRINTS.length]!
        out.push({
          id: `s_${bx}_${by}_${i}`,
          kind: f.kind,
          x: bx * BLOCK_PITCH + p.dx,
          y: by * BLOCK_PITCH + p.dy,
          w: f.w,
          h: f.h,
          stage: 'complete',
        })
      })
    }
  }
  return out
}

// ── the same platting, as GROUND ─────────────────────────────────────────────────────────
//
// A terrain array cannot hold a negative index, so the ruler above is offered a second time in
// a frame shifted to the origin: `bigTownTerrain` lays the streets, the square and a channel,
// and `bigTownPlaced` moves the structures to match. The two agree by construction — both are
// `bigTownTileExtent(rings)` shifted by the same `lo` — so a fixture cannot drift apart.

export const ROAD = 7, WATER = 2, GRASS = 0

/** One tile of the pitch is street; the channel is ONE tile wide on purpose — the thinnest
 *  feature the grammar produces, and the thing a map that point-samples loses first. */
export const CHANNEL_X = 2

export function bigTownSide(rings: number): number {
  const e = bigTownTileExtent(rings)
  return e.x1 - e.x0 + 1
}

export function bigTownTerrain(rings: number): number[][] {
  const n = bigTownSide(rings)
  const out: number[][] = []
  for (let y = 0; y < n; y++) {
    const row = new Array<number>(n).fill(GRASS)
    for (let x = 0; x < n; x++) {
      if (x % BLOCK_PITCH === BLOCK_SIDE || y % BLOCK_PITCH === BLOCK_SIDE) row[x] = ROAD
    }
    row[CHANNEL_X] = WATER          // the channel runs unbroken; the streets bridge it
    out.push(row)
  }
  // ring 0 is the square: the whole central block is paved, and nothing stands on it
  const s = rings * BLOCK_PITCH
  for (let y = s; y < s + BLOCK_SIDE; y++) for (let x = s; x < s + BLOCK_SIDE; x++) out[y]![x] = ROAD
  return out
}

/** `bigTown` in the same origin-shifted frame `bigTownTerrain` indexes. */
export function bigTownPlaced(rings: number): FixtureStructure[] {
  const lo = -rings * BLOCK_PITCH
  return bigTown(rings).map((s) => ({ ...s, x: s.x - lo, y: s.y - lo }))
}

/** The tile box the ring grammar plats into at this ring count, streets included. */
export function bigTownTileExtent(rings: number): { x0: number; y0: number; x1: number; y1: number } {
  const lo = -rings * BLOCK_PITCH
  const hi = rings * BLOCK_PITCH + BLOCK_SIDE
  return { x0: lo, y0: lo, x1: hi, y1: hi }
}

/** What that extent measures on screen at scale 1 — the number the brief's 992 × 496 is one of. */
export function bigTownScreenSize(rings: number): { w: number; h: number } {
  const e = bigTownTileExtent(rings)
  const span = e.x1 - e.x0 + (e.y1 - e.y0)
  return { w: span * (TILE_W / 2), h: span * (TILE_H / 2) }
}
