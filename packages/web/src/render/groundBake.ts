import type { TileId } from '@sj/engine/state'
import type { AssetRecord } from '@sj/shared'
import type { Texture } from 'pixi.js'
import { Container, Graphics, RenderTexture, Sprite } from 'pixi.js'
import type { ViewRect } from './cull.js'
import {
  bucketLayers,
  bucketPolys,
  CHUNK_BYTES_PER_PX,
  type ChunkGrid,
  type ChunkKey,
  type ChunkRect,
  createChunkResidency,
  groundGrid,
} from './groundChunks.js'
import {
  type FieldLayer,
  groundField,
  isRoadMass,
  materialMatrix,
  OCTAVE_ALPHA,
  octaveMatrix,
  ROAD_SHOULDER_DARK,
  ROAD_SHOULDER_LIGHT,
  roadRibbonPolys,
  roadShoulderBands,
} from './groundField.js'
import { TILE_H, TILE_W } from './iso.js'
import { furrowLines, HEADLAND_COLOR, KERB_COLOR, patchOutline, type Tile } from './patches.js'
import type { TextureBook } from './textures.js'
import { tileKind } from './tileset.js'

// A grid of fixed-size chunks, not one texture the size of the field: a whole-map bake grows as
// the square of the ring count and passes `MAX_TEXTURE_SIZE`, where the allocation FAILS.
export type GroundBaker = {
  rebake(terrain: TileId[][], records: AssetRecord[]): void
  /** Which chunks are worth holding — the view is in world space, as `viewRect()` gives it. */
  setView(view: ViewRect): void
  /** What is on the GPU right now. A bound nobody can count is a claim, not a bound. */
  vram(): { chunks: number; bytes: number; maxDimPx: number }
  destroy(): void
}

/** D3: a diamond rasterised on its own composites fractional edge coverage against the
 *  transparent bake target, and every shared edge read as a dark line (×0.845 luma measured).
 *  Half a pixel of outset makes neighbours overlap, so no pixel is left half-covered. */
export const TILE_EDGE_OUTSET_PX = 0.5

/** A tile's diamond as `poly()` points, top vertex at (cx, cy), outset on every side. */
export function tileDiamond(cx: number, cy: number, outset = TILE_EDGE_OUTSET_PX): number[] {
  return [
    cx,
    cy - outset,
    cx + TILE_W / 2 + outset,
    cy + TILE_H / 2,
    cx,
    cy + TILE_H + outset,
    cx - TILE_W / 2 - outset,
    cy + TILE_H / 2,
  ]
}

/** D17: a zoom-out can put a whole grid on screen in one tick; this many bake per frame and
 *  the rest on the frames after. A new map still bakes whole — see `rebake`. */
export const BAKES_PER_FRAME = 2

/** The one thing the baker needs a live GPU for, named so a test can drive the real baker. */
export type BakeRenderer = {
  render(opts: { container: Container; target: RenderTexture; clear: boolean }): void
}

export function createGroundBaker(
  renderer: BakeRenderer,
  root: Container,
  book: TextureBook,
): GroundBaker {
  let grid: ChunkGrid | null = null
  /** the field's layers, cut per chunk — one O(shapes) pass per terrain, never per chunk */
  let buckets = new Map<ChunkKey, FieldLayer[]>()
  let skirtBuckets = new Map<ChunkKey, FieldLayer[]>()
  let kerbPolys = new Map<ChunkKey, number[][]>()
  let headlandPolys = new Map<ChunkKey, number[][]>()
  let furrowPolys = new Map<ChunkKey, number[][]>()
  const live = new Map<ChunkKey, { rect: ChunkRect; tex: RenderTexture; sprite: Sprite }>()
  const residency = createChunkResidency()
  let view: ViewRect = { x: 0, y: 0, w: 0, h: 0 }
  // one Texture per TERRAIN now — at most eight, whatever the size of the map
  const loaded = new Map<string, Texture>()
  let generation = 0

  // Geometry stays in BAKE space (`sx + offX`) with only the container translated, so a material
  // samples the same coordinates in any chunk and the framebuffer edge does all the cutting.
  function drawChunk(rect: ChunkRect, target: RenderTexture, offX: number, offY: number): void {
    const layer = new Container()
    layer.position.set(-rect.x, -rect.y)
    const stack = buckets.get(rect.key) ?? []
    const paint = (l: FieldLayer, li: number): void => {
      if (l.shapes.length === 0) return // its index is still its index — see bucketLayers
      // Every shoulder is laid down BEFORE any ribbon, so a neighbour's rim can never sit on
      // top of this tile's surface.
      if (l.kind === 'road') {
        // Two tones, because one flat shoulder sat 0.060 luma from the grass and vanished at 1x.
        for (const [tone, pick] of [
          [ROAD_SHOULDER_LIGHT, 'light'],
          [ROAD_SHOULDER_DARK, 'dark'],
        ] as const) {
          const sh = new Graphics()
          for (const shape of l.shapes) {
            if (shape.roadKey === null) continue
            for (const poly of roadShoulderBands(shape.roadKey)[pick]) {
              const pts: number[] = []
              for (let i = 0; i < poly.length; i += 2) {
                pts.push(shape.sx + offX + poly[i]!, shape.sy + offY + poly[i + 1]!)
              }
              sh.poly(pts)
            }
          }
          sh.fill(tone)
          layer.addChild(sh)
        }
      }
      // the layer's mask, laid down once per pass
      const shapesInto = (g: Graphics): void => {
        for (const shape of l.shapes) {
          const cx = shape.sx + offX,
            cy = shape.sy + offY
          if (shape.roadKey === null) {
            g.poly(tileDiamond(cx, cy))
            continue
          }
          for (const poly of roadRibbonPolys(shape.roadKey)) {
            const pts: number[] = []
            for (let i = 0; i < poly.length; i += 2) pts.push(cx + poly[i]!, cy + poly[i + 1]!)
            g.poly(pts)
          }
        }
      }

      const g = new Graphics()
      shapesInto(g)
      const tex = l.url === null ? undefined : loaded.get(l.url)
      if (tex === undefined) {
        g.fill(l.fallback) // art independence: palette-true flat ground
        layer.addChild(g)
      } else {
        tex.source.addressMode = 'repeat' // the field wraps; the material must too
        // An identity matrix would tile one 256px material on an axis-aligned lattice across
        // the whole map, so each layer samples through its own rotation and offset instead.
        g.fill({ texture: tex, matrix: materialMatrix(l.id, li) })
        layer.addChild(g)
        // A coarser octave at an incommensurate scale: two periods with no common multiple
        // inside the map cannot line up into a lattice. Bake-time cost only.
        const oct = new Graphics()
        shapesInto(oct)
        oct.fill({ texture: tex, matrix: octaveMatrix(l.id, li), alpha: OCTAVE_ALPHA })
        layer.addChild(oct)
      }
    }
    // the skirt goes under everything, at an index of its own past the field's layers
    const skirt = skirtBuckets.get(rect.key)?.[0]
    if (skirt !== undefined) paint(skirt, stack.length)
    stack.forEach(paint)
    // The tile scan that finds these patches lives in the terrain pass, not here: it is O(the
    // map), and running it per chunk would put the whole map into every chunk's bake.
    const strokeAt = (polys: number[][], color: number, alpha: number, close: boolean): void => {
      if (polys.length === 0) return
      const g = new Graphics()
      for (const poly of polys) {
        const pts: number[] = []
        for (let i = 0; i < poly.length; i += 2) pts.push(poly[i]! + offX, poly[i + 1]! + offY)
        if (close) g.poly(pts)
        else {
          g.moveTo(pts[0]!, pts[1]!)
          g.lineTo(pts[2]!, pts[3]!)
        }
      }
      g.stroke({ color, alpha, width: 1, alignment: 0.5 })
      layer.addChild(g)
    }

    strokeAt(furrowPolys.get(rect.key) ?? [], HEADLAND_COLOR, OCTAVE_ALPHA, false)
    strokeAt(headlandPolys.get(rect.key) ?? [], HEADLAND_COLOR, 1, true)
    strokeAt(kerbPolys.get(rect.key) ?? [], KERB_COLOR, 1, true)

    renderer.render({ container: layer, target, clear: true })
    layer.destroy({ children: true })
  }

  let offsetX = 0
  let offsetY = 0
  /** on screen and not yet baked — drained `BAKES_PER_FRAME` at a time by `setView` */
  const pending: ChunkRect[] = []

  function bake(rect: ChunkRect): void {
    // resolution 1 and NEAREST, stated rather than inherited: a chunk baked at the device ratio
    // would resample the pixel art the whole `nearest` law exists to keep unresampled.
    const tex = RenderTexture.create({
      width: rect.texW,
      height: rect.texH,
      scaleMode: 'nearest',
      resolution: 1,
    })
    const sprite = new Sprite(tex)
    sprite.position.set(rect.x - offsetX, rect.y - offsetY)
    root.addChild(sprite)
    live.set(rect.key, { rect, tex, sprite })
    drawChunk(rect, tex, offsetX, offsetY)
  }

  function drain(limit: number): void {
    for (const rect of pending.splice(0, limit)) bake(rect)
  }

  function release(key: ChunkKey): void {
    const held = live.get(key)
    if (held === undefined) return
    live.delete(key)
    held.sprite.destroy()
    held.tex.destroy(true)
  }

  function applyResidency(): void {
    const step = residency.update(view)
    pending.push(...step.bake)
    for (const key of step.evict) {
      release(key)
      const i = pending.findIndex((r) => r.key === key)
      if (i >= 0) pending.splice(i, 1)
    }
  }

  function releaseAll(): void {
    for (const key of [...live.keys()]) release(key)
    pending.length = 0
    residency.clear()
  }

  return {
    rebake(terrain, records) {
      const field = groundField(terrain, records)
      offsetX = field.offsetX
      offsetY = field.offsetY
      grid = groundGrid(field.widthPx, field.heightPx, field.offsetX, field.offsetY)
      buckets = bucketLayers(grid, field.layers)
      skirtBuckets = bucketLayers(grid, [field.skirt])

      const plaza: Tile[] = [],
        farmland: Tile[] = []
      for (let y = 0; y < terrain.length; y++) {
        const row = terrain[y]!
        for (let x = 0; x < row.length; x++) {
          if (tileKind(row[x]!) === 'farmland') farmland.push({ x, y })
          else if (isRoadMass(terrain, x, y)) plaza.push({ x, y })
        }
      }
      furrowPolys = bucketPolys(grid, furrowLines(farmland))
      headlandPolys = bucketPolys(grid, patchOutline(farmland))
      kerbPolys = bucketPolys(grid, patchOutline(plaza))

      // a new terrain is a new grid: every texture on the GPU belongs to the old one
      releaseAll()
      residency.setGrid(grid)
      applyResidency()
      drain(Infinity) // a new map appears whole; only a moving view is metered

      // Textures load async: paint the flat fallback now, repaint once the art is in, and let
      // the generation counter stop a stale load overwriting a newer bake.
      const urls = [...new Set([field.skirt, ...field.layers].map((l) => l.url))].filter(
        (u): u is string => u !== null && !loaded.has(u),
      )
      if (urls.length === 0) return
      const gen = ++generation
      void Promise.all(
        urls.map(async (u) => {
          loaded.set(u, await book.get(u))
        }),
      )
        .then(() => {
          if (gen !== generation) return
          for (const held of live.values()) drawChunk(held.rect, held.tex, offsetX, offsetY)
        })
        .catch(() => {
          /* art is optional — the flat diamonds already rendered */
        })
    },
    setView(next) {
      drain(BAKES_PER_FRAME)
      if (next.x === view.x && next.y === view.y && next.w === view.w && next.h === view.h) return
      view = next
      applyResidency()
    },
    vram() {
      let bytes = 0,
        maxDimPx = 0
      for (const held of live.values()) {
        bytes += held.rect.texW * held.rect.texH * CHUNK_BYTES_PER_PX
        maxDimPx = Math.max(maxDimPx, held.rect.texW, held.rect.texH)
      }
      return { chunks: live.size, bytes, maxDimPx }
    },
    destroy() {
      generation++
      releaseAll()
      grid = null
      buckets = new Map()
      skirtBuckets = new Map()
      loaded.clear()
    },
  }
}
