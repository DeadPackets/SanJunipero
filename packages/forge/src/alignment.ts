import type { Footprint } from '@sj/shared'
import type { ForgeConfig } from './forgeConfig.js'
import type { RawImage } from './post/raw.js'
import { TILE_W } from './roadTiles.js'

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
