import type { Footprint } from '@sj/shared'
import type { ForgeConfig } from './forgeConfig.js'
import { downscaleNearest, type RawImage } from './post/raw.js'
import { TILE_W, TILE_H, ROAD_EDGE } from './roadTiles.js'
import { targetSize } from './styleBible.js'
import { checkerBackground, compositeOver } from './visionQa/rubric.js'

export type AlignmentConfig = ForgeConfig['alignment']   // one source; never a re-declared shape

// Ruling R-2: the plan's `nearVertexY = cell.h - 1` stays the default, but shipped v4 cells
// declare their own feet line (storehouse: 866 tall, feetY 861), so an explicit one wins.
// Without it nothing can sit BELOW the near vertex and the sunken check is unreachable.
export type AlignmentCell = { w: number; h: number; feetY?: number }

export function footprintDiamond(fp: Footprint, cell: AlignmentCell): {
  nearVertexY: number; centerX: number; leftX: number; rightX: number
} {
  const span = (fp.w + fp.h) * TILE_W / 2
  const centerX = cell.w / 2
  return {
    nearVertexY: cell.feetY ?? cell.h - 1,
    centerX,
    leftX: centerX - span / 2,
    rightX: centerX + span / 2,
  }
}

// Ruling R-3: v4 building cells ship at NATIVE resolution, trimmed to the figure, with a feet
// anchor; the renderer scales them into the target cell. The alignment law is written in
// TARGET-cell pixels, so the cell has to be rebuilt before the law can be applied — validating
// a raw hi-res cell fails every shipped building spuriously.
export function toTargetCell(
  img: RawImage, man: { footprint: Footprint; cell: { w: number; h: number; feetX: number; feetY: number } },
): { img: RawImage; cell: Required<AlignmentCell> } {
  const t = targetSize('building', man.footprint)
  const scale = man.cell.h / t.h
  const small = downscaleNearest(img, Math.max(1, Math.round(man.cell.w / scale)), t.h)
  const feetX = Math.round(man.cell.feetX / scale)
  const feetY = Math.min(t.h - 1, Math.round(man.cell.feetY / scale))
  const dx = Math.round(t.w / 2) - feetX
  const out: RawImage = { width: t.w, height: t.h, data: new Uint8ClampedArray(t.w * t.h * 4) }
  for (let y = 0; y < small.height && y < t.h; y++)
    for (let x = 0; x < small.width; x++) {
      const nx = x + dx
      if (nx < 0 || nx >= t.w) continue
      const s = (y * small.width + x) * 4
      out.data.set(small.data.subarray(s, s + 4), (y * t.w + nx) * 4)
    }
  return { img: out, cell: { w: t.w, h: t.h, feetY } }
}

export function validateBuildingAlignment(
  img: RawImage, fp: Footprint, cfg: AlignmentConfig, cell?: AlignmentCell,
): { ok: boolean; failures: string[]; measured: { bottomY: number; baseLeft: number; baseRight: number } } {
  const d = footprintDiamond(fp, cell ?? { w: img.width, h: img.height })
  const failures: string[] = []
  const opaque = (x: number, y: number) => img.data[(y * img.width + x) * 4 + 3] !== 0

  let bottomY = -1, belowCount = 0
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      if (!opaque(x, y)) continue
      bottomY = y
      if (y > d.nearVertexY) belowCount++
    }

  if (bottomY < 0)
    return { ok: false, failures: ['no opaque pixels'], measured: { bottomY: -1, baseLeft: -1, baseRight: -1 } }

  // 1. feet line — the base meets the near vertex, and nothing sinks past it
  const delta = Math.abs(bottomY - d.nearVertexY)
  if (delta > cfg.feetTolerancePx)
    failures.push(`feet line: base bottom y=${bottomY} is ${delta}px from the near vertex y=${d.nearVertexY} (tolerance ${cfg.feetTolerancePx}px)`)
  if (belowCount > 0)
    failures.push(`feet line: ${belowCount} opaque pixels below the near vertex y=${d.nearVertexY}`)

  // 2. base fit — the bottom band stays inside the diamond, plus a quarter-tile of slop
  const bandTop = d.nearVertexY - cfg.feetTolerancePx
  let baseLeft = Number.POSITIVE_INFINITY, baseRight = Number.NEGATIVE_INFINITY
  for (let y = Math.max(0, bandTop); y < img.height && y <= d.nearVertexY; y++)
    for (let x = 0; x < img.width; x++)
      if (opaque(x, y)) { if (x < baseLeft) baseLeft = x; if (x > baseRight) baseRight = x }

  if (baseRight < baseLeft) { baseLeft = -1; baseRight = -1 }
  else {
    const tol = cfg.baseFitToleranceQuarterTiles * TILE_W / 4
    if (baseLeft < d.leftX - tol || baseRight > d.rightX + tol)
      failures.push(`base fit: base spans x=${baseLeft}..${baseRight}, outside the diamond ${d.leftX}..${d.rightX} (tolerance ${tol}px)`)
  }

  return { ok: failures.length === 0, failures, measured: { bottomY, baseLeft, baseRight } }
}

export const GRID_MARGIN = 32
export const DIAMOND_STROKE = '#E8785A'          // warm accent, MASTER_PALETTE
const GRID_SPAN = 2                              // tiles either side of centre -> a 5x5 lattice

function paint(img: RawImage, x: number, y: number, hex: string): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
  const i = (y * img.width + x) * 4
  img.data[i] = parseInt(hex.slice(1, 3), 16); img.data[i + 1] = parseInt(hex.slice(3, 5), 16)
  img.data[i + 2] = parseInt(hex.slice(5, 7), 16); img.data[i + 3] = 255
}

function line(img: RawImage, x0: number, y0: number, x1: number, y1: number, hex: string): void {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx + dy, x = x0, y = y0
  for (;;) {
    paint(img, x, y, hex)
    if (x === x1 && y === y1) return
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x += sx }
    if (e2 <= dx) { err += dx; y += sy }
  }
}

const HEX_ROAD_EDGE = `#${ROAD_EDGE.toString(16).padStart(6, '0').toUpperCase()}`

// The seat picture: the sprite on a neutral checker, over a dimetric lattice, with its
// own footprint diamond stroked in the warm accent. The judge scores `alignment` on this.
export function testGridRender(img: RawImage, fp: Footprint): RawImage {
  const out = checkerBackground(img.width + 2 * GRID_MARGIN, img.height + 2 * GRID_MARGIN)
  const d = footprintDiamond(fp, { w: img.width, h: img.height })
  const ox = GRID_MARGIN, oy = GRID_MARGIN
  const vx = d.centerX + ox, vy = d.nearVertexY + oy      // the near vertex, lattice origin

  // two families of tile-lattice hairlines, +x = (+16,+8) and +y = (-16,+8)
  for (let i = -GRID_SPAN; i <= GRID_SPAN; i++) {
    const ax = vx + i * TILE_W / 2, ay = vy + i * TILE_H / 2
    line(out, ax - GRID_SPAN * TILE_W / 2, ay + GRID_SPAN * TILE_H / 2,
      ax + GRID_SPAN * TILE_W / 2, ay - GRID_SPAN * TILE_H / 2, HEX_ROAD_EDGE)
    const bx = vx - i * TILE_W / 2, by = vy + i * TILE_H / 2
    line(out, bx - GRID_SPAN * TILE_W / 2, by - GRID_SPAN * TILE_H / 2,
      bx + GRID_SPAN * TILE_W / 2, by + GRID_SPAN * TILE_H / 2, HEX_ROAD_EDGE)
  }

  const halfH = (fp.w + fp.h) * TILE_H / 4
  const verts: [number, number][] = [
    [d.centerX + ox, d.nearVertexY + oy],
    [d.leftX + ox, d.nearVertexY - halfH + oy],
    [d.centerX + ox, d.nearVertexY - 2 * halfH + oy],
    [d.rightX + ox, d.nearVertexY - halfH + oy],
  ]
  for (let i = 0; i < 4; i++) {
    const a = verts[i]!, b = verts[(i + 1) % 4]!
    line(out, a[0], a[1], b[0], b[1], DIAMOND_STROKE)
  }
  for (const [x, y] of verts) paint(out, x, y, DIAMOND_STROKE)

  compositeOver(out, img, ox, oy)
  return out
}

export const SEAT_CRITERION_PROMPT =
  'Does the building sit ON the highlighted diamond: not floating above it, not sunken into it, ' +
  'not perspective-skewed relative to the grid? Its base must meet the near corner of the diamond, ' +
  'its footprint must not overhang the diamond sideways, and its receding edges must run parallel ' +
  'to the lattice hairlines.'
