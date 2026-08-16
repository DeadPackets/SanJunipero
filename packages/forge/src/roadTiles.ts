import { ROAD_AUTOTILE_KEYS, type RoadAutotileKey, type RoadNeighbors } from '@sj/shared'
import type { RawImage } from './post/raw.js'

export const TILE_W = 32, TILE_H = 16
export const ROAD_BASE = 0xD4BC9E, ROAD_EDGE = 0xB89D7E, ROAD_GRIT = 0xE8D5BC   // MASTER_PALETTE members
export const ROAD_ARM_HALF_W = 5     // arm half-width in tile-space units before the dimetric skew

// Tile-space N/E/S/W are the NE/SE/SW/NW screen edges of the diamond, so a road joins its
// neighbour at these edge midpoints. Each falls on a lattice corner, so these are the
// innermost pixels touching it.
export const ARM_EDGE_MIDPOINT: Record<'n' | 'e' | 's' | 'w', readonly [number, number]> = {
  n: [23, 4], e: [23, 11], s: [8, 11], w: [8, 4],
}

const CORE = ROAD_ARM_HALF_W / TILE_W          // half-extent of the junction stub in tile space

// screen pixel -> fractional tile-space (u,v) about the tile centre; the diamond is |u|,|v| <= 0.5
function tileSpace(x: number, y: number): { u: number; v: number; inside: boolean } {
  const a = (x + 0.5 - TILE_W / 2) / (TILE_W / 2)
  const b = (y + 0.5 - TILE_H / 2) / (TILE_H / 2)
  return { u: (a + b) / 2, v: (b - a) / 2, inside: Math.abs(a) + Math.abs(b) <= 1 }
}

const GRIT_AT: readonly (readonly [number, number])[] = [[8, 4], [23, 5], [12, 11], [20, 10]]

// Arms come from the key NAME, not from a reverse lookup: the isolated tile and the
// south stub share the key `cap-s` (deviation 3), and only the name says which arm it opens.
function armsOf(key: RoadAutotileKey): RoadNeighbors {
  const has = (d: 'n' | 'e' | 's' | 'w'): boolean => {
    if (key === 'cross') return true
    if (key.startsWith('straight-')) return key.slice(9).includes(d)
    if (key.startsWith('corner-')) return key.slice(7).includes(d)
    if (key.startsWith('t-no-')) return key.slice(5) !== d
    return key.slice(4) === d          // cap-<d>
  }
  return { n: has('n'), e: has('e'), s: has('s'), w: has('w') }
}

function put(img: RawImage, x: number, y: number, rgb: number, a: number): void {
  const i = (y * TILE_W + x) * 4
  img.data[i] = (rgb >> 16) & 0xff; img.data[i + 1] = (rgb >> 8) & 0xff
  img.data[i + 2] = rgb & 0xff; img.data[i + 3] = a
}

export function paintRoadAutotile(key: RoadAutotileKey): RawImage {
  const arms = armsOf(key)
  const img: RawImage = { width: TILE_W, height: TILE_H, data: new Uint8ClampedArray(TILE_W * TILE_H * 4) }

  // 1. the full diamond in ROAD_BASE, minus the outer wedge of every quadrant the key has no arm for
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      const { u, v, inside } = tileSpace(x, y)
      if (!inside) continue
      const northSouth = Math.abs(v) >= Math.abs(u)
      const dir = northSouth ? (v < 0 ? 'n' : 's') : (u > 0 ? 'e' : 'w')
      const outer = (northSouth ? Math.abs(v) : Math.abs(u)) > CORE
      if (outer && !arms[dir]) continue          // the road stops at the tile edge
      put(img, x, y, ROAD_BASE, 255)
    }

  // 2. stroke where road meets grass INSIDE the diamond. The diamond's own rim is left
  //    unstroked so a road runs unbroken into the next tile instead of being ruled off.
  const cut: [number, number][] = []
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      if (img.data[(y * TILE_W + x) * 4 + 3] === 0) continue
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= TILE_W || ny >= TILE_H) continue
        if (img.data[(ny * TILE_W + nx) * 4 + 3] !== 0) continue
        if (!tileSpace(nx, ny).inside) continue
        cut.push([x, y]); break
      }
    }
  for (const [x, y] of cut) put(img, x, y, ROAD_EDGE, 255)

  // 3. deterministic grit, only where the base survived (never on the stroke, never on grass)
  for (const [x, y] of GRIT_AT) {
    const i = (y * TILE_W + x) * 4
    const isBase = img.data[i + 3] === 255 && img.data[i] === ((ROAD_BASE >> 16) & 0xff)
      && img.data[i + 1] === ((ROAD_BASE >> 8) & 0xff) && img.data[i + 2] === (ROAD_BASE & 0xff)
    if (isBase) put(img, x, y, ROAD_GRIT, 255)
  }
  return img
}

export function paintRoadStrip(): RawImage {
  const width = ROAD_AUTOTILE_KEYS.length * TILE_W
  const strip: RawImage = { width, height: TILE_H, data: new Uint8ClampedArray(width * TILE_H * 4) }
  ROAD_AUTOTILE_KEYS.forEach((key, k) => {
    const tile = paintRoadAutotile(key)
    for (let y = 0; y < TILE_H; y++)
      strip.data.set(tile.data.subarray(y * TILE_W * 4, (y + 1) * TILE_W * 4), (y * width + k * TILE_W) * 4)
  })
  return strip
}
