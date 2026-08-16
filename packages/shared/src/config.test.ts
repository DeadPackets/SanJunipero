import { describe, it, expect } from 'vitest'
import { SimConfigSchema, DEFAULT_CONFIG, SPAWN_AGE_YEARS } from './config.js'

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

describe('SimConfigSchema: C9 living-world sections', () => {
  const c = SimConfigSchema.parse({})

  it('structures: interiors', () => {
    expect(c.structures.enterableKinds).toEqual(['hut', 'storehouse'])
    expect(c.structures.privateKinds).toEqual(['hut'])
  })

  it('reproduction: partnership, conception, gestation, fertility', () => {
    expect(c.reproduction.coSleepNightsToPartner).toBe(3)
    expect(c.reproduction.partnerWindowDays).toBe(7)
    expect(c.reproduction.conceptionChancePerNight).toBe(0.2)
    expect(c.reproduction.gestationDays).toBe(72)
    expect(c.reproduction.fertileYears).toEqual({ from: 16, to: 45 })
  })

  it('spoilage: per-kind days, preserving structures', () => {
    expect(c.spoilage.days).toEqual({ fish: 2, berries: 3, venison: 4, bread: 6, wheat: 60 })
    expect(c.spoilage.storehouseMultiplier).toBe(2)
    expect(c.spoilage.preservingKinds).toEqual(['storehouse'])
  })

  it('seasons, tools, mystery, expert crafts, elder aging', () => {
    expect(c.seasons.winter.hungerDecayMultiplier).toBe(1.25)
    expect(c.seasons.winter.fishCatchMultiplier).toBe(0.5)
    expect(c.tools.wearPerUse).toBe(1)
    expect(c.mystery.chancePerDay).toBe(0.08)
    expect(c.crafting.expertLevel).toBe(5)
    expect(c.crafting.expertDifficulty).toBe(4)
    expect(c.aging.elderEnergyDecayMultiplier).toBe(1.2)
  })

  it('every C9 feature flag exists and defaults true', () => {
    expect(c.reproduction.enabled).toBe(true)
    expect(c.aging.deathOfOldAgeEnabled).toBe(true)
    expect(c.spoilage.enabled).toBe(true)
    expect(c.tools.wearEnabled).toBe(true)
    expect(c.mystery.enabled).toBe(true)
    expect(c.occlusion.enabled).toBe(true)
    expect(c.ownership.enabled).toBe(true)
    expect(c.inscription.enabled).toBe(true)
  })

  it('new sections are strict and independently overridable', () => {
    expect(() => SimConfigSchema.parse({ reproduction: { bogus: 1 } })).toThrow()
    expect(() => SimConfigSchema.parse({ mystery: { chancePerDay: 0.5, bogus: 1 } })).toThrow()
    expect(() => SimConfigSchema.parse({ seasons: { winter: { bogus: 1 } } })).toThrow()
    const o = SimConfigSchema.parse({ reproduction: { gestationDays: 1 } })
    expect(o.reproduction.gestationDays).toBe(1)
    expect(o.reproduction.coSleepNightsToPartner).toBe(3)
    expect(o.spoilage.enabled).toBe(true)
  })

  it('SPAWN_AGE_YEARS is a world-law constant, not config', () => {
    expect(SPAWN_AGE_YEARS).toBe(12)
    expect(DEFAULT_CONFIG).not.toHaveProperty('spawnAgeYears')
  })
})
