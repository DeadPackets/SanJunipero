// @slow — the showcase town under its real weather, three sim-days, seed g6. No LLM, no network, $0.
import { describe, expect, it } from 'vitest'
import type { SimConfig } from '@sj/shared'
import { SHOWCASE_CONFIG } from './devWorld.js'
import { runFoundersWorld } from './testutil.js'

type StormRun = { spells: number; roofs: number; struck: number; lost: number }

function stormyDays(stormLightningFireChance: number): StormRun {
  const config: SimConfig = {
    ...SHOWCASE_CONFIG,
    // The founding-week mercy (harshFromDay) would blank the storms this test exists to measure.
    weather: { ...SHOWCASE_CONFIG.weather, stormLightningFireChance, harshFromDay: 0 },
  }
  const { events } = runFoundersWorld(
    { interiors: true, builders: true, holdings: true },
    4320,
    3,
    undefined,
    config,
  )
  const count = (type: string, key: string, value: unknown): number =>
    events.filter((e) => e.type === type && e.payload[key] === value).length
  const flammable = new Set(
    events
      .filter((e) => e.type === 'structure_planned' && e.payload.flammable === true)
      .map((e) => e.payload.id),
  )
  return {
    // `weather_changed` carries the kind it came FROM, so a spell is an edge and not a duration.
    spells: events.filter(
      (e) =>
        e.type === 'weather_changed' &&
        e.payload.kind === 'storm' &&
        e.payload.prevKind !== 'storm',
    ).length,
    roofs: events.filter((e) => e.type === 'structure_completed' && flammable.has(e.payload.id))
      .length,
    struck: count('fire_ignited', 'cause', 'lightning'),
    lost: count('fire_extinguished', 'cause', 'burnout'),
  }
}

describe('★ lightning is rare drama: a storm-heavy town keeps its roofs', () => {
  const ruled = stormyDays(SHOWCASE_CONFIG.weather.stormLightningFireChance)

  it('runs the weather it is measuring — three storm spells over fifty-eight roofs', () => {
    expect(ruled.spells).toBeGreaterThan(0)
    expect(ruled.roofs).toBe(58)
  })

  it('★ burns two roofs at most over three days', () => {
    expect(SHOWCASE_CONFIG.weather.stormLightningFireChance).toBe(0.001)
    expect(ruled.lost).toBeLessThanOrEqual(2)
  })

  // ★ VACUOUS GUARD: the same world and the same seed with the old dial burns the town down.
  it('is the dial doing it: at the old 0.02 the same three days take a third of the town', () => {
    const before = stormyDays(0.02)
    expect(before.spells).toBe(ruled.spells)
    expect(before.struck).toBeGreaterThan(10)
    expect(before.lost).toBeGreaterThan(10)
  })
})
