import { describe, it, expect } from 'vitest'
import { SimConfigSchema, DEFAULT_CONFIG, SPAWN_AGE_YEARS, thirstDecayPerTick } from './config.js'

// Every C11 section flag, in the order Task 37 will unpin them.
const C11_FLAGS = [
  'mortality', 'illness', 'thirst', 'fertility', 'roads', 'desirePaths', 'fauna',
  'warmth', 'light', 'nightWitness', 'foodVariety', 'regrowth', 'mapGrowth', 'constructs',
] as const

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
    expect(c.spoilage.days).toEqual({ fish: 2, berries: 3, rabbit_meat: 3, venison: 4, bread: 6, wheat: 60 })
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

  // C11 Task 2 — the single SimConfigSchema edit for the chunk. Leaf by leaf, never a snapshot:
  // a snapshot would let a wrong default ride in behind a green test.
  it('every C11 section carries an enabled flag defaulting true', () => {
    const c = SimConfigSchema.parse({}) as unknown as Record<string, { enabled: boolean }>
    for (const section of C11_FLAGS) expect(c[section]!.enabled).toBe(true)
  })

  it('mortality, illness and thirst carry their exact dials', () => {
    const c = SimConfigSchema.parse({})
    expect(c.mortality.drainPerTick).toEqual({ injury: 0.025, poison: 0.12, illness: 0.08, fatigue: 0.04 })
    expect(c.mortality.hungerHpDrainPerTick).toBe(0.1)
    expect(c.mortality.thirstHpDrainPerTick).toBe(0.15)
    expect(c.mortality.poisonChanceSpoiled).toBe(0.35)
    expect(c.mortality.sleepRegenMultiplier).toBe(3)
    expect(c.mortality.fedThreshold).toBe(40)
    expect(c.mortality.herbRelief).toBe(1)
    expect(c.mortality.tendMultiplier).toBe(2)
    expect(c.mortality.graveEnabled).toBe(true)
    expect(c.illness.dailyWorsenChance).toBe(0.25)
    expect(c.illness.contagionEnabled).toBe(true)
    expect(c.illness.contagionChance).toBe(0.06)
    expect(c.illness.contagionRadius).toBe(3)
    expect(c.thirst.decayFactorOfHunger).toBe(0.6)
    expect(c.thirst.drinkRestore).toBe(60)
    expect(c.thirst.waterskinCharges).toBe(4)
  })

  // Deviation 1: mortality reads health.maxHp. Deviation 3: C9's per-tick contagion is retired.
  it('mortality has no maxHp of its own, and health lost its contagion dials', () => {
    expect(DEFAULT_CONFIG.mortality).not.toHaveProperty('maxHp')
    expect(DEFAULT_CONFIG.health).not.toHaveProperty('contagionRadius')
    expect(DEFAULT_CONFIG.health).not.toHaveProperty('contagionChancePerTick')
    expect(DEFAULT_CONFIG.health.maxHp).toBe(100)
  })

  // Deviation 2: the spec writes thirst decay as a derivation, so it is exported once (G4).
  it('thirstDecayPerTick is the one derivation of the slower clock', () => {
    expect(thirstDecayPerTick(DEFAULT_CONFIG)).toBeCloseTo(0.021, 10)
    const fast = SimConfigSchema.parse({ needs: { hungerDecayPerTick: 0.1 }, thirst: { decayFactorOfHunger: 0.5 } })
    expect(thirstDecayPerTick(fast)).toBeCloseTo(0.05, 10)
  })

  it('ground, water and road dials carry their exact values', () => {
    const c = SimConfigSchema.parse({})
    expect(c.fertility).toEqual({ enabled: true, radius: 3, waterBonus: 0.5, maxMultiplier: 1.5 })
    expect(c.roads).toEqual({ enabled: true, stonePerTile: 1, paveDurationTicks: 6 })
    expect(c.desirePaths).toEqual({
      enabled: true, wearThreshold: 120, decayPerDay: 0.1, regrowThreshold: 30, overgrowDays: 20, pathCost: 0.8,
    })
    expect(c.pathing).toEqual({ roadCost: 0.6, maxNodes: 6000, regionSize: 16 })
    expect(c.world).toEqual({ size: { w: 128, h: 128 } })
  })

  it('fauna, regrowth, food variety and map growth carry their exact values', () => {
    const c = SimConfigSchema.parse({})
    expect(c.fauna.caps).toEqual({ deer: 8, rabbit: 12, fish: 6 })
    expect(c.fauna.movePeriodTicks).toBe(4)
    expect(c.fauna.fleeRadius).toBe(4)
    expect(c.fauna.huntDifficulty).toEqual({ deer: 3, rabbit: 2 })
    expect(c.fauna.fishSchoolBonus).toBe(2)
    expect(c.foodVariety).toEqual({ enabled: true, windowDays: 3, bonusPerKind: 0.05, maxBonus: 0.2 })
    expect(c.regrowth).toEqual({ enabled: true, saplingChancePerDay: 0.02, saplingDays: 30 })
    expect(c.mapGrowth).toEqual({ enabled: true, step: 16, structuresPerStep: 12, maxSize: 192 })
  })

  // Controller ruling 4 ratified these numbers: they decide whether the first winter is survivable.
  it('warmth and light carry the ratified values', () => {
    const c = SimConfigSchema.parse({})
    expect(c.warmth.comfortBand).toBe(8)
    expect(c.warmth.exposureDecayPerTick).toBe(0.3)
    expect(c.warmth.heatRadius).toBe(2)
    expect(c.warmth.insulation).toEqual({ garment: 12 })
    expect(c.warmth.ambient).toEqual({
      spring: { day: 14, dusk: 9, night: 5 },
      summer: { day: 26, dusk: 20, night: 15 },
      autumn: { day: 10, dusk: 6, night: 2 },
      winter: { day: -4, dusk: -8, night: -12 },
    })
    expect(c.warmth.weatherDelta).toEqual({ storm: -1, snow: -2 })
    expect(c.light.nightWorkPenalty).toBe(1.5)
    expect(c.light.workRadius).toBe(2)
    expect(c.light.torchBurnTicks).toBe(240)
    expect(c.light.fuelBurnTicks).toBe(480)
    expect(c.light.fireRiskPerTick).toBe(0.0005)
    expect(c.light.glowRadius).toEqual({ torch: 3, lantern: 5, hearth: 3, fire_pit: 4 })
    expect(c.nightWitness).toEqual({ enabled: true, nightFactor: 0.35, duskFactor: 0.7 })
  })

  it('constructs keeps an open taxonomy', () => {
    const c = SimConfigSchema.parse({})
    expect(c.constructs.minParticipants).toBe(3)
    expect(c.constructs.minRecurrences).toBe(2)
    expect(c.constructs.windowDays).toBe(7)
    expect(c.constructs.types).toEqual({ festival: true, faith: true, council: true, market: true, custom: true })
  })

  it('structures.recipes is the one table that knows what a building costs and measures', () => {
    const r = SimConfigSchema.parse({}).structures.recipes
    expect(r['hut']).toEqual({ inputs: { wood: 10 }, w: 2, h: 2, maxHp: 50, flammable: true, durationTicks: 2880 })
    expect(r['well']).toEqual({ inputs: { stone: 8 }, w: 1, h: 1, maxHp: 30, flammable: false, durationTicks: 720 })
    expect(r['bridge']).toEqual({ inputs: { wood: 6 }, w: 1, h: 2, maxHp: 20, flammable: false, durationTicks: 480 })
    expect(r['grave']).toEqual({ inputs: {}, w: 1, h: 1, maxHp: 10, flammable: false, durationTicks: 1 })
    // The hut row must agree with the C9 dials it replaces, or Task 12's generalisation drifts.
    expect(r['hut']!.inputs).toEqual(DEFAULT_CONFIG.construction.hutMaterials)
    expect(r['hut']!.durationTicks).toBe(DEFAULT_CONFIG.construction.hutTicks)
    expect(r['hut']!.maxHp).toBe(DEFAULT_CONFIG.construction.hutMaxHp)
    // Enterability stays in structures.enterableKinds, its one landed home (G4).
    expect(r['hut']).not.toHaveProperty('enterable')
  })

  it('the clothing chain and the rabbit are on the tables their tasks read', () => {
    const c = SimConfigSchema.parse({})
    expect(c.crafting.recipes['cloth']).toEqual({ inputs: { fiber: 2 }, output: { kind: 'cloth', qty: 1 }, skill: 'tailoring' })
    expect(c.crafting.recipes['garment']).toEqual({ inputs: { cloth: 2 }, output: { kind: 'garment', qty: 1 }, skill: 'tailoring' })
    expect(c.spoilage.days['rabbit_meat']).toBe(3)
    // A hide is a material, not a meal: absent means it keeps.
    expect(c.spoilage.days['hide']).toBeUndefined()
  })

  it('every C11 section rejects an unknown key and overrides one dial without disturbing its neighbours', () => {
    for (const section of C11_FLAGS) {
      expect(() => SimConfigSchema.parse({ [section]: { bogus: 1 } })).toThrow()
    }
    expect(() => SimConfigSchema.parse({ world: { size: { d: 1 } } })).toThrow()
    expect(() => SimConfigSchema.parse({ warmth: { ambient: { spring: { noon: 1 } } } })).toThrow()
    const o = SimConfigSchema.parse({ thirst: { drinkRestore: 10 } })
    expect(o.thirst.drinkRestore).toBe(10)
    expect(o.thirst.waterskinCharges).toBe(4)
    expect(o.mortality.enabled).toBe(true)
  })

  it('SPAWN_AGE_YEARS is a world-law constant, not config', () => {
    expect(SPAWN_AGE_YEARS).toBe(12)
    expect(DEFAULT_CONFIG).not.toHaveProperty('spawnAgeYears')
  })
})
