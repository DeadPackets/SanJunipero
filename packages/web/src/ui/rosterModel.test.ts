import { describe, expect, it } from 'vitest'
import type { WorldState } from '@sj/engine/state'
import type { AssetRecord } from '@sj/shared'
import { BUST_FIGURE_SHARE, bustStyle, rosterRows } from './rosterModel.js'

const agent = (over: Record<string, unknown>) => ({
  id: 'a',
  name: 'A',
  x: 0,
  y: 0,
  ageDays: 30 * 364,
  alive: true,
  asleep: false,
  collapsedSinceTick: null,
  activity: null,
  needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
  hp: 10,
  injuries: [],
  skills: {},
  ...over,
})

const state = (agents: Record<string, unknown>): WorldState => ({ agents }) as unknown as WorldState

describe('rosterRows', () => {
  it('maps bands and ONE state word; sorts by name; counts the dead', () => {
    const s = state({
      omar: agent({
        id: 'omar',
        name: 'Omar',
        ageDays: 24 * 364,
        activity: { verb: 'walk', ticksRemaining: 3 },
      }),
      yusuf: agent({
        id: 'yusuf',
        name: 'Yusuf',
        ageDays: 65 * 364,
        asleep: true,
        activity: { verb: 'sleep', ticksRemaining: 9 },
      }),
      kid: agent({ id: 'kid', name: 'Bud', ageDays: 10 * 364 }),
      ghost: agent({ id: 'ghost', name: 'Ghost', alive: false }),
    })
    const { alive, gone } = rosterRows(s)
    expect(alive.map((r) => r.name)).toEqual(['Bud', 'Omar', 'Yusuf'])
    expect(alive.map((r) => r.band)).toEqual(['young', 'grown', 'elder'])
    // one word each, and the sleeper's is `Asleep` alone — never `Asleep` plus `sleeping`
    expect(alive.map((r) => r.state)).toEqual(['Between things', 'Walking', 'Asleep'])
    expect(alive.every((r) => r.conditions.length === 0)).toBe(true)
    expect(gone).toBe(1)
  })

  it('is graceful on empty and null worlds', () => {
    expect(rosterRows(null)).toEqual({ alive: [], gone: 0 })
    expect(rosterRows(state({}))).toEqual({ alive: [], gone: 0 })
  })
})

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
