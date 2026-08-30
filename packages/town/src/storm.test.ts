// @slow — the showcase town under its real weather, three sim-days, seed g6. No LLM, no network, $0.
import { describe, expect, it } from 'vitest'
import type { SimConfig } from '@sj/shared'
import { SHOWCASE_CONFIG } from './devWorld.js'
import { runFoundersWorld } from './testutil.js'

type StormRun = { spells: number; roofs: number; struck: number; lost: number }

function stormyDays(stormLightningFireChance: number): StormRun {
  const config: SimConfig = {
    ...SHOWCASE_CONFIG,
    weather: { ...SHOWCASE_CONFIG.weather, stormLightningFireChance },
  }
  let spells = 0
  let previous = ''
  const { events } = runFoundersWorld(
    { interiors: true, builders: true, holdings: true },
    4320,
    3,
    (_tick, s) => {
      if (s.weather.kind === 'storm' && previous !== 'storm') spells++
      previous = s.weather.kind
    },
    config,
  )
  const flammable = new Set(
    events
      .filter((e) => e.type === 'structure_planned' && e.payload.flammable === true)
      .map((e) => e.payload.id),
  )
  const has = (e: { type: string; payload: Record<string, unknown> }, t: string, cause: string) =>
    e.type === t && e.payload.cause === cause
  return {
    spells,
    roofs: events.filter((e) => e.type === 'structure_completed' && flammable.has(e.payload.id))
      .length,
    struck: events.filter((e) => has(e, 'fire_ignited', 'lightning')).length,
    lost: events.filter((e) => has(e, 'fire_extinguished', 'burnout')).length,
  }
}

describe('★ lightning is rare drama: a storm-heavy town keeps its roofs', () => {
  const ruled = stormyDays(SHOWCASE_CONFIG.weather.stormLightningFireChance)

  it('runs the weather it is measuring — three storm spells over forty-two roofs', () => {
    expect(ruled.spells).toBeGreaterThan(0)
    expect(ruled.roofs).toBe(42)
  })

  it('★ burns two roofs at most over three days', () => {
    expect(SHOWCASE_CONFIG.weather.stormLightningFireChance).toBe(0.001)
    expect(ruled.lost).toBeLessThanOrEqual(2)
  })

  // ★ VACUOUS GUARD: the same world, the same seed, the old dial. The town it burned down is
  // the whole reason the number moved (ruling 22, 2026-08-30).
  it('is the dial doing it: at the old 0.02 the same three days take a third of the town', () => {
    const before = stormyDays(0.02)
    expect(before.spells).toBe(ruled.spells)
    expect(before.struck).toBeGreaterThan(10)
    expect(before.lost).toBeGreaterThan(10)
  })
})
