import {
  TERRAIN_TILE_KINDS, materialKind, roadAutotile, roadAutotileKind,
  type AssetRecord, type RoadAutotileKey, type TerrainTileKind,
} from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import { TILE_H, TILE_W, tileToScreen } from './iso.js'
import { TILE_COLORS } from './ground.js'
import { ROAD_TILE_ID, TILE_KIND, roadNeighborsAt, tileKind } from './tileset.js'

const ID_OF_KIND = new Map<TerrainTileKind, TileId>(
  (Object.entries(TILE_KIND) as Array<[string, TerrainTileKind]>).map(([id, k]) => [k, Number(id) as TileId]),
)

// TERRAIN V2 — user directive 2026-08-17: "why are they not high fidelity textures? You
// should have just generated a square and placed it on the grid. It also looks unsettling to
// have a checkerboard texture on the city, I want a natural normal distribution."
//
// The old ground stamped one 32x16 diamond PER TILE and picked between four variants with a
// per-tile hash. Both halves of that are the complaint: a 32x16 stamp cannot carry fidelity,
// and a per-tile choice puts a visible pattern at exactly tile frequency — the checkerboard.
//
// The ground is now a CONTINUOUS FIELD. One high-resolution seamless material per terrain is
// laid across the whole map in WORLD SPACE, and each tile is a window onto it: the material
// flows across tile boundaries, so there is no stamp to see and nothing varies at tile
// frequency. A tile contributes only its SHAPE, to the mask that decides where its terrain
// shows. Roads keep their autotile silhouettes — as mask shapes now, not as baked art.

export const MATERIAL_REPEAT_PX = 256   // must match the forge's MATERIAL_PX

/** Where a point in bake space lands inside the repeating material. World space, not tile space. */
export function materialUv(sx: number, sy: number, repeat: number = MATERIAL_REPEAT_PX): { u: number; v: number } {
  const wrap = (n: number): number => ((n % repeat) + repeat) % repeat
  return { u: wrap(sx), v: wrap(sy) }
}

export function resolveMaterial(records: AssetRecord[], kind: TerrainTileKind): string | null {
  let best: AssetRecord | null = null
  for (const r of records) {
    if (r.status !== 'ready' || r.class !== 'terrain' || r.kind !== materialKind(kind)) continue
    if (best === null || r.seq > best.seq) best = r
  }
  return best === null ? null : `/assets/${best.id}.png`
}

/** One tile's contribution to a mask: the diamond it covers, or a road silhouette. */
export type MaskShape = { sx: number; sy: number; roadKey: RoadAutotileKey | null }

export type FieldLayer = {
  kind: TerrainTileKind
  /** the continuous material to lay under this layer's mask; null → flat fallback colour */
  url: string | null
  fallback: number
  shapes: MaskShape[]
}

export type GroundField = {
  layers: FieldLayer[]
  /** the ground that fills a road tile's diamond around its ribbon */
  under: TerrainTileKind
  widthPx: number
  heightPx: number
  offsetX: number
}

export const ROAD_UNDER: TerrainTileKind = 'grass'

// Layer order is TERRAIN_TILE_KINDS order with road last, so a road ribbon is drawn over the
// ground it runs through rather than punched out of it.
const LAYER_ORDER: TerrainTileKind[] =
  [...TERRAIN_TILE_KINDS.filter((k) => k !== 'road'), 'road']

export function groundField(terrain: TileId[][], records: AssetRecord[]): GroundField {
  const h = terrain.length
  const w = terrain[0]?.length ?? 0
  const shapes = new Map<TerrainTileKind, MaskShape[]>()
  const push = (kind: TerrainTileKind, s: MaskShape): void => {
    const list = shapes.get(kind)
    if (list === undefined) shapes.set(kind, [s])
    else list.push(s)
  }

  for (let y = 0; y < h; y++) {
    const row = terrain[y]!
    for (let x = 0; x < row.length; x++) {
      const id = row[x]!
      const { sx, sy } = tileToScreen(x, y)
      const kind = tileKind(id)
      if (id === ROAD_TILE_ID) {
        // the diamond under the ribbon belongs to the ground the road runs through, and the
        // ribbon itself is a shaped mask over the road material
        push(ROAD_UNDER, { sx, sy, roadKey: null })
        push('road', { sx, sy, roadKey: roadAutotile(roadNeighborsAt(terrain, x, y)) })
        continue
      }
      push(kind, { sx, sy, roadKey: null })
    }
  }

  const layers: FieldLayer[] = []
  for (const kind of LAYER_ORDER) {
    const list = shapes.get(kind)
    if (list === undefined || list.length === 0) continue
    layers.push({
      kind, shapes: list,
      url: resolveMaterial(records, kind),
      fallback: TILE_COLORS[ID_OF_KIND.get(kind) ?? 0],
    })
  }

  return {
    layers, under: ROAD_UNDER,
    widthPx: (w + h) * (TILE_W / 2),
    heightPx: (w + h) * (TILE_H / 2),
    offsetX: h * (TILE_W / 2),
  }
}

/** The road strip cell a key occupies, for cutting a silhouette out of the shipped strip. */
export function roadStripFrame(key: RoadAutotileKey, keys: readonly RoadAutotileKey[]): {
  x: number; y: number; w: number; h: number
} {
  return { x: keys.indexOf(key) * TILE_W, y: 0, w: TILE_W, h: TILE_H }
}

// ── road silhouettes as SHAPES over the continuous material ─────────────────────────────
// C13's strip painted each junction as finished art. In a continuous field the road surface
// comes from the material like every other ground, and a key contributes only its outline:
// a stub at the tile centre plus one arm per direction the road actually continues in. The
// arms are read from the key NAME, the same rule roadTiles.ts paints from — the isolated
// tile and the south stub share `cap-s`, and only the name tells them apart.

export const ARM_HALF_W = 5 / 32          // half-width of an arm, in tile-space units
export const ARM_DIRS = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] } as const
export type ArmDir = keyof typeof ARM_DIRS

export function roadArms(key: RoadAutotileKey): Record<ArmDir, boolean> {
  const has = (d: ArmDir): boolean => {
    if (key === 'cross') return true
    if (key.startsWith('straight-')) return key.slice(9).includes(d)
    if (key.startsWith('corner-')) return key.slice(7).includes(d)
    if (key.startsWith('t-no-')) return key.slice(5) !== d
    return key.slice(4) === d              // cap-<d>
  }
  return { n: has('n'), e: has('e'), s: has('s'), w: has('w') }
}

/** tile-space (dx,dy) offset from the tile CENTRE → screen offset from the tile's top vertex */
const toScreen = (dx: number, dy: number): [number, number] =>
  [(dx - dy) * (TILE_W / 2), (dx + dy) * (TILE_H / 2) + TILE_H / 2]

/**
 * Polygons covering one road cell, in screen coords relative to the tile's TOP VERTEX.
 * A central stub, plus a quad reaching to the edge midpoint of every present arm.
 */
export function roadRibbonPolys(key: RoadAutotileKey): number[][] {
  const h = ARM_HALF_W
  const polys: number[][] = [
    [...toScreen(-h, -h), ...toScreen(h, -h), ...toScreen(h, h), ...toScreen(-h, h)],
  ]
  const arms = roadArms(key)
  for (const dir of Object.keys(ARM_DIRS) as ArmDir[]) {
    if (!arms[dir]) continue
    const [ax, ay] = ARM_DIRS[dir]
    // perpendicular in tile space, so the arm keeps its width under the dimetric skew
    const [px, py] = [-ay * h, ax * h]
    const [tx, ty] = [ax * 0.5, ay * 0.5]      // the shared edge midpoint, half a tile out
    polys.push([
      ...toScreen(-px, -py), ...toScreen(px, py),
      ...toScreen(tx + px, ty + py), ...toScreen(tx - px, ty - py),
    ])
  }
  return polys
}

export { roadAutotileKind }
