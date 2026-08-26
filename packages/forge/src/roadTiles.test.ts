import { describe, it, expect } from 'vitest'
import { ROAD_AUTOTILE_KEYS, type RoadAutotileKey } from '@sj/shared'
import { MASTER_PALETTE } from './palette.js'
import type { RawImage } from './post/raw.js'
import {
  TILE_W,
  TILE_H,
  ROAD_BASE,
  ROAD_EDGE,
  ROAD_GRIT,
  ROAD_ARM_HALF_W,
  paintRoadAutotile,
  paintRoadStrip,
  ARM_EDGE_MIDPOINT,
} from './roadTiles.js'

const hex = (img: RawImage, x: number, y: number) => {
  const i = (y * img.width + x) * 4
  return `#${[0, 1, 2].map((k) => img.data[i + k]!.toString(16).padStart(2, '0').toUpperCase()).join('')}`
}
const alpha = (img: RawImage, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3]!
const bytes = (img: RawImage) => Array.from(img.data)

// The arms of the key, derived from its NAME, never from the implementation.
function armsOf(key: RoadAutotileKey): Record<'n' | 'e' | 's' | 'w', boolean> {
  const has = (d: string) => {
    if (key === 'cross') return true
    if (key.startsWith('straight-')) return key.slice(9).includes(d)
    if (key.startsWith('corner-')) return key.slice(7).includes(d)
    if (key.startsWith('t-no-')) return key.slice(5) !== d
    return key.slice(4) === d // cap-<d>
  }
  return { n: has('n'), e: has('e'), s: has('s'), w: has('w') }
}

describe('paintRoadAutotile', () => {
  it('paints every key at 32x16 using only master-palette colours', () => {
    for (const key of ROAD_AUTOTILE_KEYS) {
      const img = paintRoadAutotile(key)
      expect(img.width).toBe(TILE_W)
      expect(img.height).toBe(TILE_H)
      for (let y = 0; y < TILE_H; y++)
        for (let x = 0; x < TILE_W; x++)
          if (alpha(img, x, y) !== 0)
            expect(MASTER_PALETTE, `${key} @${x},${y}`).toContain(hex(img, x, y))
    }
  })

  it('uses palette members for its three road colours', () => {
    const h = (n: number) => `#${n.toString(16).padStart(6, '0').toUpperCase()}`
    for (const c of [ROAD_BASE, ROAD_EDGE, ROAD_GRIT]) expect(MASTER_PALETTE).toContain(h(c))
    expect(ROAD_ARM_HALF_W).toBe(5)
  })

  it('is deterministic for all 15 keys', () => {
    for (const key of ROAD_AUTOTILE_KEYS)
      expect(bytes(paintRoadAutotile(key))).toEqual(bytes(paintRoadAutotile(key)))
  })

  it('keeps the diamond centre opaque and the tile corner clear on every key', () => {
    for (const key of ROAD_AUTOTILE_KEYS) {
      const img = paintRoadAutotile(key)
      expect(alpha(img, 16, 8), `${key} centre`).toBe(255)
      for (const [x, y] of [
        [0, 0],
        [31, 0],
        [0, 15],
        [31, 15],
      ] as const)
        expect(alpha(img, x, y), `${key} corner ${x},${y}`).toBe(0)
    }
  })

  it('EDGE CONTINUITY: an arm edge midpoint is opaque exactly when that arm is present', () => {
    for (const key of ROAD_AUTOTILE_KEYS) {
      const img = paintRoadAutotile(key)
      const arms = armsOf(key)
      for (const d of ['n', 'e', 's', 'w'] as const) {
        const [x, y] = ARM_EDGE_MIDPOINT[d]
        expect(alpha(img, x, y) !== 0, `${key}: ${d} edge midpoint`).toBe(arms[d])
      }
    }
  })

  it('spot-checks the continuity law on three named tiles', () => {
    const capN = paintRoadAutotile('cap-n')
    expect(alpha(capN, ...ARM_EDGE_MIDPOINT.n)).not.toBe(0)
    for (const d of ['e', 's', 'w'] as const) expect(alpha(capN, ...ARM_EDGE_MIDPOINT[d])).toBe(0)
    const cross = paintRoadAutotile('cross')
    for (const d of ['n', 'e', 's', 'w'] as const)
      expect(alpha(cross, ...ARM_EDGE_MIDPOINT[d])).not.toBe(0)
    const ns = paintRoadAutotile('straight-ns')
    expect(alpha(ns, ...ARM_EDGE_MIDPOINT.n)).not.toBe(0)
    expect(alpha(ns, ...ARM_EDGE_MIDPOINT.s)).not.toBe(0)
    expect(alpha(ns, ...ARM_EDGE_MIDPOINT.e)).toBe(0)
    expect(alpha(ns, ...ARM_EDGE_MIDPOINT.w)).toBe(0)
  })

  it('produces 15 pairwise-distinct tiles', () => {
    const seen = new Map<string, string>()
    for (const key of ROAD_AUTOTILE_KEYS) {
      const sig = bytes(paintRoadAutotile(key)).join(',')
      expect(seen.has(sig), `${key} duplicates ${seen.get(sig)}`).toBe(false)
      seen.set(sig, key)
    }
    expect(seen.size).toBe(15)
  })
})

// A road tile is a RIBBON on transparency, not a filled diamond — half of a straight run is a hole.
// Drawn instead of the ground it shows the stage behind it; drawn over the ground it is a road.
describe('a road tile is an overlay, not a ground tile', () => {
  const inDiamond = (x: number, y: number): boolean => {
    const half = 2 * ((y < TILE_H / 2 ? y : TILE_H - 1 - y) + 1)
    return x >= TILE_W / 2 - half && x < TILE_W / 2 + half
  }
  const holeFraction = (key: RoadAutotileKey): number => {
    const img = paintRoadAutotile(key)
    let inside = 0,
      clear = 0
    for (let y = 0; y < TILE_H; y++) {
      for (let x = 0; x < TILE_W; x++) {
        if (!inDiamond(x, y)) continue
        inside++
        if (img.data[(y * TILE_W + x) * 4 + 3] === 0) clear++
      }
    }
    return clear / inside
  }

  it('leaves a real hole inside the diamond for every key that is not a full junction', () => {
    expect(holeFraction('straight-ns')).toBeGreaterThan(0.4)
    expect(holeFraction('straight-ew')).toBeGreaterThan(0.4)
    expect(holeFraction('cap-n')).toBeGreaterThan(0.6)
    expect(holeFraction('corner-ne')).toBeGreaterThan(0.4)
  })

  it('is nearly solid at a crossroads — which is why the plaza looked right and roads did not', () => {
    expect(holeFraction('cross')).toBeLessThan(0.2)
  })

  it('has SOME hole in every one of the fifteen, so none of them may replace the ground', () => {
    for (const key of ROAD_AUTOTILE_KEYS) expect(holeFraction(key), key).toBeGreaterThan(0)
  })
})

describe('paintRoadStrip', () => {
  it('is 480x16 and its k-th slice is the k-th key', () => {
    const strip = paintRoadStrip()
    expect(strip.width).toBe(15 * TILE_W)
    expect(strip.height).toBe(TILE_H)
    ROAD_AUTOTILE_KEYS.forEach((key, k) => {
      const tile = paintRoadAutotile(key)
      for (let y = 0; y < TILE_H; y++)
        for (let x = 0; x < TILE_W; x++)
          for (let c = 0; c < 4; c++)
            expect(
              strip.data[(y * strip.width + k * TILE_W + x) * 4 + c],
              `${key} @${x},${y}.${c}`,
            ).toBe(tile.data[(y * TILE_W + x) * 4 + c])
    })
  })
})
