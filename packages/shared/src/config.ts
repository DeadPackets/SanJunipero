import { z } from 'zod'

const NeedsSchema = z.object({
  hungerDecayPerTick: z.number().default(0.035),
  energyDecayAwakePerTick: z.number().default(0.093),
  energyRegenAsleepPerTick: z.number().default(0.25),
  socialDecayPerTick: z.number().default(0.018),
  socialRegenConversingPerTick: z.number().default(0.5),
  warmthEqualizeFactorPerTick: z.number().default(0.05),
  debuffThreshold: z.number().default(30),
  collapseThreshold: z.number().default(5),
  deathAfterZeroHungerTicks: z.number().default(1440),
  eatRestoreHunger: z.number().default(60),
}).strict()

const MovementSchema = z.object({
  baseTicksPerTile: z.number().default(1),
  debuffTicksPerTile: z.number().default(2),
  sightRadius: z.number().default(12),
  earshotRadius: z.number().default(8),
}).strict()

const HealthSchema = z.object({
  maxHp: z.number().default(100),
  injuryDamage: z.object({
    minor: z.number().default(10),
    serious: z.number().default(30),
    grave: z.number().default(60),
  }).strict().prefault({}),
  infectionChancePerInjuryPerDay: z.number().default(0.2),
  contagionRadius: z.number().default(4),
  contagionChancePerTick: z.number().default(0.001),
  recoveryHpPerDay: z.number().default(5),
  tendedRecoveryHpPerDay: z.number().default(15),
  collapseHp: z.number().default(15),
  deathHp: z.number().default(0),
}).strict()

const AgingSchema = z.object({
  childUntilYears: z.number().default(16),
  elderFromYears: z.number().default(60),
  naturalDeathBaseChancePerDay: z.number().default(0.0005),
  naturalDeathChancePerYearOver: z.number().default(0.0002),
}).strict()

const SkillsSchema = z.object({
  tracks: z.array(z.string()).default([
    'farming', 'carpentry', 'cooking', 'medicine', 'fishing', 'foraging',
    'brewing', 'masonry', 'tailoring', 'smithing', 'scholarship', 'art',
  ]),
  xpLevelDivisor: z.number().default(100),
  maxLevel: z.number().default(10),
}).strict()

const WeatherSchema = z.object({
  hourlyChangeChance: z.number().default(0.15),
  kinds: z.array(z.string()).default(['sunny', 'cloudy', 'rain', 'storm', 'snow']),
  seasonTemps: z.object({
    spring: z.number().default(14),
    summer: z.number().default(26),
    autumn: z.number().default(10),
    winter: z.number().default(-4),
  }).strict().prefault({}),
  nightTempDelta: z.number().default(-6),
  rainTempDelta: z.number().default(-4),
  snowOnlyIn: z.string().default('winter'),
  stormLightningFireChance: z.number().default(0.02),
}).strict()

export const CropDefSchema = z.object({
  growthDays: z.number(),
  stages: z.number(),
  seasons: z.array(z.string()),
  yield: z.number(),
}).strict()

const CropsSchema = z.record(z.string(), CropDefSchema).default({
  wheat: { growthDays: 8, stages: 4, seasons: ['spring', 'summer'], yield: 3 },
})

const WildlifeSchema = z.object({
  fishMax: z.number().default(100),
  fishRegenPerDay: z.number().default(5),
  fishCatchBase: z.number().default(0.4),
  deerMax: z.number().default(20),
  deerRegenPerDay: z.number().default(1),
  forageYieldBySeason: z.object({
    spring: z.number().default(2),
    summer: z.number().default(3),
    autumn: z.number().default(2),
    winter: z.number().default(0),
  }).strict().prefault({}),
}).strict()

const FireSchema = z.object({
  spreadChancePerTickAdjacent: z.number().default(0.02),
  burnTicksToDestroy: z.number().default(120),
  rainSpreadMultiplier: z.number().default(0.2),
}).strict()

const ConstructionSchema = z.object({
  hutTicks: z.number().default(2880),
  hutMaterials: z.object({
    wood: z.number().default(10),
  }).strict().prefault({}),
  hutSize: z.object({
    w: z.number().int().default(2),
    h: z.number().int().default(2),
  }).strict().prefault({}),
  hutMaxHp: z.number().default(50),
}).strict()

export const RecipeSchema = z.object({
  inputs: z.record(z.string(), z.number()),
  output: z.object({ kind: z.string(), qty: z.number() }).strict(),
  skill: z.string(),
}).strict()

const CraftingSchema = z.object({
  recipes: z.record(z.string(), RecipeSchema).default({
    plank: { inputs: { wood: 1 }, output: { kind: 'plank', qty: 2 }, skill: 'carpentry' },
  }),
}).strict()

export const SimConfigSchema = z.object({
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
}).strict()

export type SimConfig = z.infer<typeof SimConfigSchema>
export type CropDef = z.infer<typeof CropDefSchema>
export type RecipeDef = z.infer<typeof RecipeSchema>

export const DEFAULT_CONFIG: SimConfig = SimConfigSchema.parse({})
