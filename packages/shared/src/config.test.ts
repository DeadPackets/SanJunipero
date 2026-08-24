import { describe, it, expect } from 'vitest'
import {
  SimConfigSchema, DEFAULT_CONFIG, isBeddedKind, isHearthKind, isRoofedKind, SPAWN_AGE_YEARS,
  thirstDecayPerTick,
} from './config.js'
import { CITY_BED_KIND, CITY_HEARTH_KIND, cityStructures } from './cityTemplate.js'
import { MINUTES_PER_DAY } from './time.js'

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
    expect(c.construction.houseMaterials.wood).toBe(10)
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
    expect(c.structures.privateKinds).toEqual(['house'])
  })

  // ★ THE ROSTERS ARE GONE. `enterableKinds` and `sleepableKinds` were two hand-written lists
  // of kind names and both said `house` (plus a storehouse) — so the valley's own cabins,
  // cottages and farmhouses were buildings nobody could get into or lie down in. The kind's own
  // row answers it now, and nothing may reintroduce a list of names beside it.
  it('a roof is a property of the kind, not a roster of names', () => {
    expect(c.structures).not.toHaveProperty('enterableKinds')
    expect(c.structures).not.toHaveProperty('sleepableKinds')
    const roofed = Object.keys(c.structures.recipes).filter((k) => isRoofedKind(c, k)).sort()
    expect(roofed).toEqual(['cabin', 'cottage', 'farmhouse', 'house', 'storehouse'])
    for (const k of ['well', 'bridge', 'grave']) expect(isRoofedKind(c, k), k).toBe(false)
    // A kind nothing has ever heard of is not a shelter by accident.
    expect(isRoofedKind(c, 'standing_stone')).toBe(false)
  })

  // ★ AND NEITHER IS A FIRE. `HEAT_SOURCE_KINDS` was the third roster — two names in a Set in
  // the warmth system — and it is why the hearth every house has held was a thing the renderer
  // drew and no verb could reach. Same medicine, same shape: ask the kind.
  it('a fire is a property of the kind, not a roster of names', () => {
    const hearths = Object.keys(c.structures.recipes).filter((k) => isHearthKind(c, k)).sort()
    // Two, not three: the old roster's first name, `hearth`, was a structure kind NOTHING in
    // this world has ever stood. A hearth is a thing a house has, not a building.
    expect(hearths).toEqual(['fire_pit', 'house'])
    expect(c.structures.recipes).not.toHaveProperty('hearth')
    for (const k of ['well', 'bridge', 'grave', 'storehouse', 'cabin']) expect(isHearthKind(c, k), k).toBe(false)
    expect(isHearthKind(c, 'standing_stone')).toBe(false)
    // Neither open fire is a shelter and nobody builds either — an empty `inputs` is the whole
    // of what "the world places this" means, and `buildableRecipe` reads exactly that.
    expect(c.structures.recipes['fire_pit']!.inputs).toEqual({})
    expect(isRoofedKind(c, 'fire_pit')).toBe(false)
  })

  // ★ THE SEAM THAT MUST NOT DRIFT: the engine's furnishings ARE the ones the room draws. The
  // city template furnishes a house with a hearth and a bed and furnishes nothing else with
  // either, and if these two halves ever disagree then a mind can feed a fire nobody can see,
  // or sleep in a bed that is not in the picture.
  //
  // Only `house` is on either side today. A cottage and a farmhouse are dwellings a mind can
  // raise and the template gives them no furnishings at all — the day it does, this test says
  // so out loud instead of letting the two halves part company in silence.
  it('the furnishings the engine acts on are exactly the ones the room is drawn with', () => {
    const furnishedWith = (kind: string): string[] => [...new Set(cityStructures()
      .filter((s) => s.furnishings.some((f) => f.kind === kind))
      .map((s) => s.kind))].sort()
    expect(furnishedWith(CITY_HEARTH_KIND)).toEqual(['house'])
    expect(furnishedWith(CITY_BED_KIND)).toEqual(['house'])
    const dwellingsWith = (has: (c: typeof DEFAULT_CONFIG, k: string) => boolean): string[] =>
      Object.keys(c.structures.recipes).filter((k) => has(c, k) && isRoofedKind(c, k)).sort()
    expect(dwellingsWith(isHearthKind)).toEqual(furnishedWith(CITY_HEARTH_KIND))
    expect(dwellingsWith(isBeddedKind)).toEqual(furnishedWith(CITY_BED_KIND))
  })

  // ★ AND A FURNISHING FLAG EXISTS ONLY WHERE A LAW ASKS FOR ONE. A house also holds a table, a
  // chair and a rug; none of the three is here, because nothing in the world reads them and a
  // mind handed a word with no verb behind it spends turns being refused. This test is what
  // stops the row quietly becoming a copy of the renderer's furniture list.
  it('the row carries the two furnishings a law reads and not the room\'s whole inventory', () => {
    const row = c.structures.recipes['house']!
    // `sited` joins the dimensions rather than the furnishings: it says who picks the ground,
    // not what is in the room, so it is no more a furnishing than `w` is.
    expect(Object.keys(row).filter((k) => !['inputs', 'w', 'h', 'maxHp', 'flammable', 'durationTicks', 'sited'].includes(k)).sort())
      .toEqual(['bed', 'hearth', 'roofed'])
    // and every one of those three IS in the room the template draws
    const inTheRoom = cityStructures().find((s) => s.kind === 'house')!.furnishings.map((f) => f.kind)
    expect(inTheRoom).toContain(CITY_HEARTH_KIND)
    expect(inTheRoom).toContain(CITY_BED_KIND)
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
    // ★ ONE KEY. `maxSize` was a ceiling on a grammar that plats rings forever and `step` and
    // `structuresPerStep` were a pace guessed against it. The world owes a CLEARANCE now —
    // `WORLD_MARGIN` of ground beyond everything standing — and a clearance names its own edge
    // and its own depth. All that is left to decide is whether the world may widen at all.
    expect(c.mapGrowth).toEqual({ enabled: true })
    expect(() => SimConfigSchema.parse({ mapGrowth: { maxSize: 192 } })).toThrow()
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
    expect(c.light.glowRadius).toEqual({ torch: 3, lantern: 5, hearth: 3, fire_pit: 4, lamp_post: 4 })
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
    expect(r['house']).toEqual({ inputs: { wood: 10 }, w: 2, h: 2, maxHp: 50, flammable: true, durationTicks: 2880, roofed: true, hearth: true, bed: true, sited: false })
    expect(r['well']).toEqual({ inputs: { stone: 8 }, w: 1, h: 1, maxHp: 30, flammable: false, durationTicks: 720, roofed: false, hearth: false, bed: false, sited: false })
    expect(r['bridge']).toEqual({ inputs: { wood: 6 }, w: 1, h: 2, maxHp: 20, flammable: false, durationTicks: 480, roofed: false, hearth: false, bed: false, sited: true })
    expect(r['grave']).toEqual({ inputs: {}, w: 1, h: 1, maxHp: 10, flammable: false, durationTicks: 1, roofed: false, hearth: false, bed: false, sited: false })
    // The four the town template plants. All four are roofed; an empty `inputs` is still the
    // whole of what "nobody builds this" means, and only the two 2x2 ones keep it — a buildable
    // cabin or storehouse would be a second name for `house`.
    for (const k of ['storehouse', 'cabin', 'cottage', 'farmhouse']) expect(r[k]!.roofed, k).toBe(true)
    expect(r['storehouse']!.inputs).toEqual({})
    expect(r['cabin']!.inputs).toEqual({})
    // ★ ONE RATE, NOT THREE AUTHORED NUMBERS. A house is 4 tiles of floor for 10 wood and 2 880
    // ticks. Everything else with a roof that a mind can raise is priced off that: 2.5 wood and
    // 720 ticks a tile. They had to be buildable for genesis to stand them up roofless.
    const perTileWood = r['house']!.inputs['wood']! / (r['house']!.w * r['house']!.h)
    const perTileTicks = r['house']!.durationTicks / (r['house']!.w * r['house']!.h)
    expect([perTileWood, perTileTicks]).toEqual([2.5, 720])
    for (const k of ['cottage', 'farmhouse']) {
      const tiles = r[k]!.w * r[k]!.h
      expect(r[k]!.inputs, k).toEqual({ wood: tiles * perTileWood })
      expect(r[k]!.durationTicks, k).toBe(tiles * perTileTicks)
    }
    // ★ THE LAMP, AND ITS WHOLE ARGUMENT IN FOUR NUMBERS. 2 wood against a house's 10, and 120
    // ticks against 2 880 — a night is 720, so this is the one roofless thing a want that
    // arrives at dusk can actually finish before dawn. `sited` because a plot spent on a lamp
    // is a house not built, and the lattice plats masses, not street furniture.
    expect(r['lamp_post']).toEqual({ inputs: { wood: 2 }, w: 1, h: 1, maxHp: 15, flammable: false, durationTicks: 120, roofed: false, hearth: false, bed: false, sited: true })
    expect(r['lamp_post']!.durationTicks).toBeLessThan(MINUTES_PER_DAY / 2)   // finishable in one night
    // Only the two kinds that are not masses choose their own ground.
    expect(Object.entries(r).filter(([, v]) => v.sited).map(([k]) => k).sort()).toEqual(['bridge', 'lamp_post'])
    // The house row must agree with the C9 dials it replaces, or Task 12's generalisation drifts.
    expect(r['house']!.inputs).toEqual(DEFAULT_CONFIG.construction.houseMaterials)
    expect(r['house']!.durationTicks).toBe(DEFAULT_CONFIG.construction.houseTicks)
    expect(r['house']!.maxHp).toBe(DEFAULT_CONFIG.construction.houseMaxHp)
    // Enterability is `roofed` on this row, and there is nowhere else to say it (G4).
    expect(r['house']).not.toHaveProperty('enterable')
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
