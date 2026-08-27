import { describe, expect, it } from 'vitest'
import type { AssetRecord } from '@sj/shared'
import { BUST_FIGURE_SHARE, bustStyle } from './bustStyle.js'

describe('bustStyle', () => {
  const rec: AssetRecord = {
    id: 'asset_omar',
    seq: 1,
    class: 'rig-part',
    desc: 'character sheet v4: omar',
    kind: 'character:omar',
    footprint: { w: 1, h: 1 },
    widthPx: 2000,
    heightPx: 3400,
    status: 'ready',
    score: null,
    attempts: 1,
    costUsd: 0,
    createdAt: 'now',
    meta: JSON.stringify({
      version: 'v4-hires-atlas',
      figureH: 800,
      cells: { 'idle-se': { x: 400, y: 850, w: 340, h: 810, feetX: 170, feetY: 805 } },
    }),
  }

  it('crops the idle cell around the head at the requested size', () => {
    const b = bustStyle([rec], 'omar', 48)!
    const k = 48 / (BUST_FIGURE_SHARE * 800)
    expect(b.backgroundImage).toBe('url("/assets/asset_omar.png")')
    expect(b.backgroundSize).toBe(
      `${Math.round(2000 * k * 100) / 100}px ${Math.round(3400 * k * 100) / 100}px`,
    )
    // x centers the feet column, y starts at the figure top (feetY - figureH + cell y)
    const headX = (400 + 170) * k
    const topY = (850 + 5) * k
    expect(b.backgroundPosition).toBe(
      `${Math.round((24 - headX) * 100) / 100}px ${Math.round(-topY * 100) / 100}px`,
    )
  })

  it('returns null without a v4 record (pixel-token fallback)', () => {
    expect(bustStyle([], 'omar', 48)).toBeNull()
    expect(bustStyle([{ ...rec, meta: null }], 'omar', 48)).toBeNull()
  })
})
