import { z } from 'zod'

const NeedsSchema = z
  .object({
    // World one: nobody ate after tick 455 and 100/0.035 put the first body on the ground at
    // tick 2715, day 2. At 0.021 an empty stomach takes 4524 ticks to fall — past day 3.
    hungerDecayPerTick: z.number().default(0.021),
    energyDecayAwakePerTick: z.number().default(0.093),
    energyRegenAsleepPerTick: z.number().default(0.25),
    // Only ever a bonus, and what it shortens is the SHORT sleep: a full night fills the bar from
    // empty either way (720 x 0.25), so the boards are exactly as good as they were.
    bedRegenMultiplier: z.number().default(1.5),
    socialDecayPerTick: z.number().default(0.018),
    socialRegenConversingPerTick: z.number().default(0.5),
    socialRegenRecencyTicks: z.number().default(60),
    warmthEqualizeFactorPerTick: z.number().default(0.05),
    debuffThreshold: z.number().default(30),
    collapseThreshold: z.number().default(5),
    deathAfterZeroHungerTicks: z.number().default(2880),
    eatRestoreHunger: z.number().default(60),
  })
  .strict()

const MovementSchema = z
  .object({
    baseTilesPerTick: z.number().positive().default(3),
    debuffTilesPerTick: z.number().positive().default(2),
    // What a body on the ground pays, in ticks, for the one tile it can still reach.
    crawlTickMultiplier: z.number().positive().default(8),
    sightRadius: z.number().default(12),
    earshotRadius: z.number().default(8),
  })
  .strict()

const HealthSchema = z
  .object({
    maxHp: z.number().default(100),
    injuryDamage: z
      .object({
        minor: z.number().default(10),
        serious: z.number().default(30),
        grave: z.number().default(60),
      })
      .strict()
      .prefault({}),
    infectionChancePerInjuryPerDay: z.number().default(0.2),
    recoveryHpPerDay: z.number().default(5),
    tendedRecoveryHpPerDay: z.number().default(15),
    collapseHp: z.number().default(15),
    // Warm, fed and left alone is the whole of the cure, and it is measured against the fatigue
    // the fall itself put on the body: it outruns the first rung and the second, and the third
    // outruns it. Resting off one fall is a road out; resting off a habit of falling is not.
    downedRecoveryHpPerTick: z.number().default(0.1),
    deathHp: z.number().default(0),
  })
  .strict()

const AgingSchema = z
  .object({
    childUntilYears: z.number().default(16),
    elderFromYears: z.number().default(60),
    naturalDeathBaseChancePerDay: z.number().default(0.0005),
    naturalDeathChancePerYearOver: z.number().default(0.0002),
    deathOfOldAgeEnabled: z.boolean().default(true),
    elderEnergyDecayMultiplier: z.number().default(1.2),
  })
  .strict()

const SkillsSchema = z
  .object({
    tracks: z
      .array(z.string())
      .default([
        'farming',
        'carpentry',
        'cooking',
        'medicine',
        'fishing',
        'foraging',
        'brewing',
        'masonry',
        'tailoring',
        'smithing',
        'scholarship',
        'art',
      ]),
    xpLevelDivisor: z.number().default(100),
    maxLevel: z.number().default(10),
  })
  .strict()

const WeatherSchema = z
  .object({
    hourlyChangeChance: z.number().default(0.15),
    kinds: z.array(z.string()).default(['sunny', 'cloudy', 'rain', 'storm', 'snow']),
    seasonTemps: z
      .object({
        spring: z.number().default(14),
        summer: z.number().default(26),
        autumn: z.number().default(10),
        winter: z.number().default(-4),
      })
      .strict()
      .prefault({}),
    nightTempDelta: z.number().default(-6),
    rainTempDelta: z.number().default(-4),
    snowOnlyIn: z.string().default('winter'),
    // A founding week has no roofs, no woodpile and no habits yet; the sky waits for them.
    harshFromDay: z.number().int().default(7),
    // Rare drama: at 0.02 three storm days burned 27 of 42 houses.
    stormLightningFireChance: z.number().default(0.001),
  })
  .strict()

export const CropDefSchema = z
  .object({
    growthDays: z.number(),
    stages: z.number(),
    seasons: z.array(z.string()),
    yield: z.number(),
  })
  .strict()

const CropsSchema = z.record(z.string(), CropDefSchema).default({
  wheat: { growthDays: 8, stages: 4, seasons: ['spring', 'summer'], yield: 3 },
})

const WildlifeSchema = z
  .object({
    fishMax: z.number().default(100),
    fishRegenPerDay: z.number().default(5),
    fishCatchBase: z.number().default(0.4),
    deerMax: z.number().default(20),
    deerRegenPerDay: z.number().default(1),
    forageYieldBySeason: z
      .object({
        spring: z.number().default(2),
        summer: z.number().default(3),
        autumn: z.number().default(2),
        winter: z.number().default(0),
      })
      .strict()
      .prefault({}),
  })
  .strict()

const FireSchema = z
  .object({
    spreadChancePerTickAdjacent: z.number().default(0.02),
    burnTicksToDestroy: z.number().default(120),
    stormSpreadMultiplier: z.number().default(0.2),
  })
  .strict()

const ConstructionSchema = z
  .object({
    houseTicks: z.number().default(2880),
    houseMaterials: z
      .object({
        wood: z.number().default(10),
      })
      .strict()
      .prefault({}),
    houseSize: z
      .object({
        w: z.number().int().default(2),
        h: z.number().int().default(2),
      })
      .strict()
      .prefault({}),
  })
  .strict()

// Optional and carrying NO default on purpose: absent from every authored row, so it stays out
// of stateHash(DEFAULT_CONFIG) — the one door left for an arbiter-codified weapon.
export const RecipeSchema = z
  .object({
    inputs: z.record(z.string(), z.number()),
    output: z.object({ kind: z.string(), qty: z.number() }).strict(),
    skill: z.string(),
    weaponKinds: z.array(z.string()).optional(),
  })
  .strict()

const CraftingSchema = z
  .object({
    recipes: z.record(z.string(), RecipeSchema).default({
      plank: { inputs: { wood: 1 }, output: { kind: 'plank', qty: 2 }, skill: 'carpentry' },
      // The clothing line: what a hide or a handful of fiber becomes on the way to a warm night.
      cloth: { inputs: { fiber: 2 }, output: { kind: 'cloth', qty: 1 }, skill: 'tailoring' },
      garment: { inputs: { cloth: 2 }, output: { kind: 'garment', qty: 1 }, skill: 'tailoring' },
    }),
    expertLevel: z.number().int().default(5),
    expertDifficulty: z.number().int().default(4),
  })
  .strict()

// What a building costs, how big it stands, how hard it is to knock down, how long it takes,
// and whether it has a roof.
export const StructureRecipeSchema = z
  .object({
    inputs: z.record(z.string(), z.number()),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
    maxHp: z.number().positive(),
    flammable: z.boolean(),
    durationTicks: z.number().int().positive(),
    // Defaults to false, so a kind the arbiter codifies is a thing in the world and not a shelter
    // until somebody says it is one.
    roofed: z.boolean().default(false),
    // A furnishing is a property of the kind, not an entity and not a coordinate: this fire is the
    // building's own fueledUntilTick, and one row answers glow, cooking and the cold held off.
    hearth: z.boolean().default(false),
    // A flag lives here because a law reads it. Table, chair and rug are absent on purpose: a word
    // with no verb behind it only buys refusals.
    bed: z.boolean().default(false),
    // Absent means the town seats the kind on a plot; sited means the builder names x and y, because
    // a deck belongs to the water it crosses and a lamp to the spot somebody wanted lit.
    sited: z.boolean().default(false),
  })
  .strict()

const StructuresSchema = z
  .object({
    privateKinds: z.array(z.string()).default(['house']),
    sleepIndoorsOnly: z.boolean().default(true),
    // Empty inputs mark a kind the world places and nobody builds. Every kind the world places needs
    // a row here: a kind with no row is a kind nothing can say roofed about.
    recipes: z.record(z.string(), StructureRecipeSchema).default({
      house: {
        inputs: { wood: 10 },
        w: 2,
        h: 2,
        maxHp: 50,
        flammable: true,
        durationTicks: 2880,
        roofed: true,
        hearth: true,
        bed: true,
        sited: false,
      },
      well: {
        inputs: { stone: 8 },
        w: 1,
        h: 1,
        maxHp: 30,
        flammable: false,
        durationTicks: 720,
        roofed: false,
        hearth: false,
        bed: false,
        sited: false,
      },
      bridge: {
        inputs: { wood: 6 },
        w: 1,
        h: 2,
        maxHp: 20,
        flammable: false,
        durationTicks: 480,
        roofed: false,
        hearth: false,
        bed: false,
        sited: true,
      },
      grave: {
        inputs: {},
        w: 1,
        h: 1,
        maxHp: 10,
        flammable: false,
        durationTicks: 1,
        roofed: false,
        hearth: false,
        bed: false,
        sited: false,
      },
      // Every BUILDABLE dwelling is priced at one rate — 2.5 wood and 720 ticks a tile; config.test.ts holds it.
      // The cabin and the storehouse have empty inputs on purpose: 2x2 is a house's mass, so a buildable one is a second name for house.
      storehouse: {
        inputs: {},
        w: 2,
        h: 2,
        maxHp: 40,
        flammable: true,
        durationTicks: 1,
        roofed: true,
        hearth: false,
        bed: false,
        sited: false,
      },
      cabin: {
        inputs: {},
        w: 2,
        h: 2,
        maxHp: 50,
        flammable: true,
        durationTicks: 1,
        roofed: true,
        hearth: true,
        bed: false,
        sited: false,
      },
      cottage: {
        inputs: { wood: 15 },
        w: 3,
        h: 2,
        maxHp: 60,
        flammable: true,
        durationTicks: 4320,
        roofed: true,
        hearth: true,
        bed: true,
        sited: false,
      },
      farmhouse: {
        inputs: { wood: 20 },
        w: 4,
        h: 2,
        maxHp: 80,
        flammable: true,
        durationTicks: 5760,
        roofed: true,
        hearth: true,
        bed: true,
        sited: false,
      },
      // The town's open fire: nobody builds it (inputs empty) and it has no roof. A hearth is not a
      // building — it is a thing a house has.
      fire_pit: {
        inputs: {},
        w: 1,
        h: 1,
        maxHp: 10,
        flammable: false,
        durationTicks: 1,
        roofed: false,
        hearth: true,
        bed: false,
        sited: false,
      },
      // 2 wood and 120 ticks, so a want that arrives at dusk can be answered before dawn. Wood, not
      // stone: the only outcrops are fifty tiles south-west. What burns is the fuel in the basket.
      lamp_post: {
        inputs: { wood: 2 },
        w: 1,
        h: 1,
        maxHp: 15,
        flammable: false,
        durationTicks: 120,
        roofed: false,
        hearth: false,
        bed: false,
        sited: true,
      },
    }),
  })
  .strict()

const ReproductionSchema = z
  .object({
    enabled: z.boolean().default(true),
    coSleepNightsToPartner: z.number().int().default(3),
    partnerWindowDays: z.number().int().default(7),
    conceptionChancePerNight: z.number().default(0.2),
    gestationDays: z.number().int().default(72),
    fertileYears: z
      .object({
        from: z.number().int().default(16),
        to: z.number().int().default(45),
      })
      .strict()
      .prefault({}),
  })
  .strict()

const SpoilageSchema = z
  .object({
    enabled: z.boolean().default(true),
    // `hide` is deliberately absent: it is a material, not a meal, and absent means it keeps.
    days: z
      .record(z.string(), z.number())
      .default({ fish: 2, berries: 3, rabbit_meat: 3, venison: 4, bread: 6, wheat: 60 }),
    storehouseMultiplier: z.number().default(2),
    preservingKinds: z.array(z.string()).default(['storehouse']),
  })
  .strict()

const SeasonsSchema = z
  .object({
    winter: z
      .object({
        hungerDecayMultiplier: z.number().default(1.25),
        fishCatchMultiplier: z.number().default(0.5),
      })
      .strict()
      .prefault({}),
  })
  .strict()

const ToolsSchema = z
  .object({
    wearEnabled: z.boolean().default(true),
    wearPerUse: z.number().default(1),
  })
  .strict()

const MysterySchema = z
  .object({
    enabled: z.boolean().default(true),
    chancePerDay: z.number().default(0.08),
  })
  .strict()

// maxNodes lives here; roadCost keeps its original default (deep-world addendum §11).
const PathingSchema = z
  .object({
    roadCost: z.number().default(0.6),
    maxNodes: z.number().int().positive().default(6000),
  })
  .strict()

// Flag-only sections: the feature they gate is physics that already has a home elsewhere.
const FlagSchema = z.object({ enabled: z.boolean().default(true) }).strict()

// Every section below carries an `enabled` flag, so stateHash(DEFAULT_CONFIG) moves once for the group.

// No `maxHp` of its own (deviation 1): `health.maxHp` already exists and fold reads it.
const MortalitySchema = z
  .object({
    enabled: z.boolean().default(true),
    drainPerTick: z
      .object({
        // At 0.05 a grave wound killed in 4.8 hours — less time than it takes to be seen across a meadow
        // and walked to. 0.025 gives every tier a window longer than that walk.
        injury: z.number().default(0.025),
        poison: z.number().default(0.12),
        illness: z.number().default(0.08),
        fatigue: z.number().default(0.04),
      })
      .strict()
      .prefault({}),
    hungerHpDrainPerTick: z.number().default(0.04),
    // An empty stomach is not a wound yet. Half a day passes before it starts costing hp.
    hungerGraceTicks: z.number().default(720),
    thirstHpDrainPerTick: z.number().default(0.08),
    poisonChanceSpoiled: z.number().default(0.35),
    sleepRegenMultiplier: z.number().default(3),
    fedThreshold: z.number().default(40),
    herbRelief: z.number().default(1),
    tendMultiplier: z.number().default(2),
    graveEnabled: z.boolean().default(true),
  })
  .strict()

const IllnessSchema = z
  .object({
    enabled: z.boolean().default(true),
    dailyWorsenChance: z.number().default(0.25),
    contagionEnabled: z.boolean().default(true),
    contagionChance: z.number().default(0.06),
    contagionRadius: z.number().default(3),
  })
  .strict()

// Deviation 2: the spec writes the decay as "0.6 x hunger rate", which is a derivation and
// not a literal — so it is stored as the factor and derived once, by thirstDecayPerTick.
const ThirstSchema = z
  .object({
    enabled: z.boolean().default(true),
    decayFactorOfHunger: z.number().default(0.6),
    drinkRestore: z.number().default(60),
    waterskinCharges: z.number().int().positive().default(4),
  })
  .strict()

const FertilitySchema = z
  .object({
    enabled: z.boolean().default(true),
    radius: z.number().default(3),
    waterBonus: z.number().default(0.5),
    maxMultiplier: z.number().default(1.5),
  })
  .strict()

const RoadsSchema = z
  .object({
    enabled: z.boolean().default(true),
    stonePerTile: z.number().int().positive().default(1),
    paveDurationTicks: z.number().int().positive().default(6),
  })
  .strict()

const DesirePathsSchema = z
  .object({
    enabled: z.boolean().default(true),
    wearThreshold: z.number().positive().default(120),
    decayPerDay: z.number().default(0.1),
    regrowThreshold: z.number().default(30),
    overgrowDays: z.number().int().positive().default(20),
    pathCost: z.number().default(0.8),
  })
  .strict()

// The caps and the regen ARE the ecology: there is no population model beneath them.
const FaunaSchema = z
  .object({
    enabled: z.boolean().default(true),
    caps: z
      .object({
        deer: z.number().int().default(8),
        rabbit: z.number().int().default(12),
        fish: z.number().int().default(6),
      })
      .strict()
      .prefault({}),
    movePeriodTicks: z.number().int().positive().default(4),
    fleeRadius: z.number().default(4),
    huntDifficulty: z
      .object({
        deer: z.number().default(3),
        rabbit: z.number().default(2),
      })
      .strict()
      .prefault({}),
    fishSchoolBonus: z.number().default(2),
  })
  .strict()

const ambientBand = (day: number, dusk: number, night: number) =>
  z
    .object({
      day: z.number().default(day),
      dusk: z.number().default(dusk),
      night: z.number().default(night),
    })
    .strict()
    .prefault({})

// These numbers are ratified: they decide whether the first winter is
// survivable with effort, which is the product intent. Retune via config_changed.
const WarmthSchema = z
  .object({
    enabled: z.boolean().default(true),
    comfortBand: z.number().default(8),
    exposureDecayPerTick: z.number().default(0.15),
    // The cold's share of the awake energy decay, billed ON TOP of it — not a factor on it.
    coldEnergyDrainShare: z.number().default(0.5),
    heatRadius: z.number().default(2),
    // Twelve is the gap at the mildest winter hour (comfortBand 8 over ambient -4): the least that
    // reaches winter, and no hour past its mildest.
    insulation: z
      .object({ garment: z.number().default(12) })
      .strict()
      .prefault({}),
    // The garment's own number, and the two are interchangeable one line above isExposed: it carries
    // a winter night from 10 to 34, over the shiver line and no further.
    fireWarmth: z.number().default(12),
    ambient: z
      .object({
        spring: ambientBand(14, 9, 5),
        summer: ambientBand(26, 20, 15),
        autumn: ambientBand(10, 6, 2),
        winter: ambientBand(-4, -8, -12),
      })
      .strict()
      .prefault({}),
    weatherDelta: z
      .object({
        storm: z.number().default(-1),
        snow: z.number().default(-2),
      })
      .strict()
      .prefault({}),
  })
  .strict()

const LightSchema = z
  .object({
    enabled: z.boolean().default(true),
    nightWorkPenalty: z.number().default(1.5),
    workRadius: z.number().default(2),
    torchBurnTicks: z.number().int().positive().default(240),
    fuelBurnTicks: z.number().int().positive().default(480),
    fireRiskPerTick: z.number().default(0.0005),
    glowRadius: z
      .object({
        torch: z.number().default(3),
        lantern: z.number().default(5),
        hearth: z.number().default(3),
        fire_pit: z.number().default(4),
        // A standing light: shorter reach than the square's fire, and it is not a heat source, so
        // this table is the whole of what makes it a lamp — glow, and a structure that takes fuel.
        lamp_post: z.number().default(4),
      })
      .strict()
      .prefault({}),
  })
  .strict()

// Light at the target restores visibility, not light at the eye. That asymmetry is the mechanic.
const NightWitnessSchema = z
  .object({
    enabled: z.boolean().default(true),
    nightFactor: z.number().default(0.35),
    duskFactor: z.number().default(0.7),
  })
  .strict()

const FoodVarietySchema = z
  .object({
    enabled: z.boolean().default(true),
    windowDays: z.number().int().positive().default(3),
    bonusPerKind: z.number().default(0.05),
    maxBonus: z.number().default(0.2),
  })
  .strict()

const RegrowthSchema = z
  .object({
    enabled: z.boolean().default(true),
    saplingChancePerDay: z.number().default(0.02),
    saplingDays: z.number().int().positive().default(30),
  })
  .strict()

// A clearance, not a ceiling: WORLD_MARGIN of ground beyond everything standing says by itself
// which edge to widen and by how much. All that is left to decide is whether the world may widen.
const MapGrowthSchema = z
  .object({
    enabled: z.boolean().default(true),
  })
  .strict()

// `custom` exists precisely so the taxonomy is open-ended: the arbiter may recognize a type
// nobody seeded. None of these words ever reaches a prompt.
const ConstructsSchema = z
  .object({
    enabled: z.boolean().default(true),
    minParticipants: z.number().int().positive().default(3),
    minRecurrences: z.number().int().positive().default(2),
    windowDays: z.number().int().positive().default(7),
    types: z
      .object({
        festival: z.boolean().default(true),
        faith: z.boolean().default(true),
        council: z.boolean().default(true),
        market: z.boolean().default(true),
        custom: z.boolean().default(true),
      })
      .strict()
      .prefault({}),
  })
  .strict()

// A genesis input, not a dial. The map grows by world_grown, never by an operator edit.
const WorldSchema = z
  .object({
    size: z
      .object({
        w: z.number().int().positive().default(128),
        h: z.number().int().positive().default(128),
      })
      .strict()
      .prefault({}),
  })
  .strict()

export const SimConfigSchema = z
  .object({
    needs: NeedsSchema.prefault({}),
    movement: MovementSchema.prefault({}),
    health: HealthSchema.prefault({}),
    aging: AgingSchema.prefault({}),
    skills: SkillsSchema.prefault({}),
    weather: WeatherSchema.prefault({}),
    crops: CropsSchema,
    wildlife: WildlifeSchema.prefault({}),
    fire: FireSchema.prefault({}),
    construction: ConstructionSchema.prefault({}),
    crafting: CraftingSchema.prefault({}),
    structures: StructuresSchema.prefault({}),
    reproduction: ReproductionSchema.prefault({}),
    spoilage: SpoilageSchema.prefault({}),
    seasons: SeasonsSchema.prefault({}),
    tools: ToolsSchema.prefault({}),
    mystery: MysterySchema.prefault({}),
    pathing: PathingSchema.prefault({}),
    occlusion: FlagSchema.prefault({}),
    ownership: FlagSchema.prefault({}),
    inscription: FlagSchema.prefault({}),
    mortality: MortalitySchema.prefault({}),
    illness: IllnessSchema.prefault({}),
    thirst: ThirstSchema.prefault({}),
    fertility: FertilitySchema.prefault({}),
    roads: RoadsSchema.prefault({}),
    desirePaths: DesirePathsSchema.prefault({}),
    fauna: FaunaSchema.prefault({}),
    warmth: WarmthSchema.prefault({}),
    light: LightSchema.prefault({}),
    nightWitness: NightWitnessSchema.prefault({}),
    foodVariety: FoodVarietySchema.prefault({}),
    regrowth: RegrowthSchema.prefault({}),
    mapGrowth: MapGrowthSchema.prefault({}),
    constructs: ConstructsSchema.prefault({}),
    world: WorldSchema.prefault({}),
  })
  .strict()

export type SimConfig = z.infer<typeof SimConfigSchema>
export type CropDef = z.infer<typeof CropDefSchema>
export type RecipeDef = z.infer<typeof RecipeSchema>
export type StructureRecipeDef = z.infer<typeof StructureRecipeSchema>

/** Does a building of this kind have a roof over it? A kind with no row is not a shelter. */
export function isRoofedKind(config: SimConfig, kind: string): boolean {
  return config.structures.recipes[kind]?.roofed === true
}

/** Does a building of this kind hold a fire somebody can feed? A kind with no row has no fire in it. */
export function isHearthKind(config: SimConfig, kind: string): boolean {
  return config.structures.recipes[kind]?.hearth === true
}

/** Is there a bed in a building of this kind? `roofed` says a body may lie down out of the weather; this says on what. */
export function isBeddedKind(config: SimConfig, kind: string): boolean {
  return config.structures.recipes[kind]?.bed === true
}

// The one derivation of the slower clock: 0.021/tick at defaults, 0.6x hunger.
export function thirstDecayPerTick(config: SimConfig): number {
  return config.needs.hungerDecayPerTick * config.thirst.decayFactorOfHunger
}

// World law, not a dial: a mind wakes at twelve. Config would make it negotiable.
export const SPAWN_AGE_YEARS = 12

export const DEFAULT_CONFIG: SimConfig = SimConfigSchema.parse({})
