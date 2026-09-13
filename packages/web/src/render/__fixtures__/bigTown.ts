import { TILE_H, TILE_W } from './iso.js'

// A town larger than the viewport, platted to any ring count on the grammar's own 19-tile
// pitch. A measuring instrument for the camera and the cull; nothing but tests imports it.

/** 18 tiles of block and one of road between them, the pitch the ring grammar plats on. */
const BLOCK_PITCH = 19
/** The plot side inside one block; the remaining tile of the pitch is the street. */
const BLOCK_SIDE = BLOCK_PITCH - 1

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
const FOOTPRINTS: readonly { kind: string; w: number; h: number }[] = [
  { kind: 'well', w: 1, h: 1 },
  { kind: 'house', w: 2, h: 2 },
  { kind: 'cottage', w: 2, h: 2 },
  { kind: 'storehouse', w: 3, h: 2 },
  { kind: 'farmhouse', w: 4, h: 2 },
]

/** Eight plots around one block's perimeter, the way a street rank claims frontage. */
const PLOT_OFFSETS: readonly { dx: number; dy: number }[] = [
  { dx: 1, dy: 1 },
  { dx: 7, dy: 1 },
  { dx: 13, dy: 1 },
  { dx: 1, dy: 8 },
  { dx: 13, dy: 8 },
  { dx: 1, dy: 15 },
  { dx: 7, dy: 15 },
  { dx: 13, dy: 15 },
]

/** Eight claimed plots per block; ring 0 is the square and stands nothing, so R rings hold `((2R+1)² − 1) · 8` structures, always in the same order. */
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
// A terrain array cannot hold a negative index, so this frame is shifted to the origin; ground
// and structures cannot drift apart because both shift `bigTownTileExtent(rings)` by the same `lo`.

const ROAD = 7,
  WATER = 2
const GRASS = 0

/** One tile of the pitch is street; the channel is ONE tile wide on purpose — the thinnest
 *  feature the grammar produces, and the thing a map that point-samples loses first. */
const CHANNEL_X = 2

function bigTownSide(rings: number): number {
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
    row[CHANNEL_X] = WATER // the channel runs unbroken; the streets bridge it
    out.push(row)
  }
  // ring 0 is the square: the whole central block is paved, and nothing stands on it
  const s = rings * BLOCK_PITCH
  for (let y = s; y < s + BLOCK_SIDE; y++)
    for (let x = s; x < s + BLOCK_SIDE; x++) out[y]![x] = ROAD
  return out
}

/** The tile box the ring grammar plats into at this ring count, streets included. */
function bigTownTileExtent(rings: number): {
  x0: number
  y0: number
  x1: number
  y1: number
} {
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
