import { describe, it, expect } from 'vitest'
import { SimConfigSchema, DEFAULT_CONFIG } from './config.js'

describe('SimConfigSchema', () => {
  it('parse({}) fully hydrates to DEFAULT_CONFIG', () => {
    expect(SimConfigSchema.parse({})).toEqual(DEFAULT_CONFIG)
  })

  it('defaults carry the binding values', () => {
    const c = SimConfigSchema.parse({})
    expect(c.needs.hungerDecayPerTick).toBe(0.035)
    expect(c.needs.deathAfterZeroHungerTicks).toBe(1440)
    expect(c.movement.sightRadius).toBe(12)
    expect(c.health.injuryDamage.grave).toBe(60)
    expect(c.skills.tracks).toHaveLength(12)
    expect(c.weather.seasonTemps.winter).toBe(-4)
    expect(c.crops['wheat']!.growthDays).toBe(8)
    expect(c.fire.burnTicksToDestroy).toBe(120)
    expect(c.construction.hutMaterials.wood).toBe(10)
  })

  it('rejects unknown keys at the top level', () => {
    expect(() => SimConfigSchema.parse({ bogus: true })).toThrow()
  })

  it('rejects unknown keys inside a nested section', () => {
    expect(() => SimConfigSchema.parse({ needs: { bogus: 1 } })).toThrow()
    expect(() => SimConfigSchema.parse({ health: { injuryDamage: { fatal: 99 } } })).toThrow()
  })

  it('an override survives and the rest still defaults', () => {
    const c = SimConfigSchema.parse({ needs: { hungerDecayPerTick: 1 } })
    expect(c.needs.hungerDecayPerTick).toBe(1)
    expect(c.needs.eatRestoreHunger).toBe(60)
    expect(c.movement.baseTicksPerTile).toBe(1)
  })
})
