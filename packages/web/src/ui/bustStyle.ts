import type { AssetRecord } from '@sj/shared'
import { characterArt } from '../render/textures.js'

export const BUST_FIGURE_SHARE = 0.45 // bust crop = head + shoulders ≈ top 45% of the chibi figure

export type BustStyle = {
  backgroundImage: string
  backgroundSize: string
  backgroundPosition: string
}

// CSS sprite-crop of the v4 atlas idle cell around the head; null → pixel-token fallback
export function bustStyle(records: AssetRecord[], agentId: string, px: number): BustStyle | null {
  const art = characterArt(records, agentId)
  if (art.manifest === null || art.size === null) return null
  const cell = art.manifest.cells['idle-se'] ?? art.manifest.cells['idle-sw']
  if (cell === undefined) return null
  const k = px / (BUST_FIGURE_SHARE * art.manifest.figureH)
  const headX = (cell.x + cell.feetX) * k // the head sits above the feet column
  const topY = (cell.y + Math.max(0, cell.feetY - art.manifest.figureH)) * k
  const r = (n: number): number => Math.round(n * 100) / 100
  return {
    backgroundImage: `url("${art.url}")`,
    backgroundSize: `${r(art.size.w * k)}px ${r(art.size.h * k)}px`,
    backgroundPosition: `${r(px / 2 - headX)}px ${r(-topY)}px`,
  }
}
