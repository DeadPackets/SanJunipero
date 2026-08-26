import { z } from 'zod'

const NeedsSchema = z.object({
  hungerDecayPerTick: z.number().default(0.035),
  energyDecayAwakePerTick: z.number().default(0.093),
  energyRegenAsleepPerTick: z.number().default(0.25),
  // ★ WHAT A BED IS WORTH, and until now it was worth nothing at all: one flat rate answered
  // the bare ground, a storehouse floor and a bed alike, and `sleep` named the HOUSE and never
  // the bed in it. A full night fills the bar from empty either way (720 ticks x 0.25 = 180 of
  // a 100 bar), so this is not a night's sleep made better — it is the SHORT one. Empty to full
  // is 400 ticks on the boards and 267 in a bed: two sim-hours of daylight given back to a body
  // that lay down at noon. Only ever a bonus; the boards are exactly as good as they were.
  bedRegenMultiplier: z.number().default(1.5),
  socialDecayPerTick: z.number().default(0.018),
  socialRegenConversingPerTick: z.number().default(0.5),
  socialRegenRecencyTicks: z.number().default(60),
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
  // C11 deviation 3: the per-tick contagion dials are gone with the loop that read them.
  // Contagion is one midnight roll now, on `illness`, so the world has one contagion system.
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
  deathOfOldAgeEnabled: z.boolean().default(true),
  elderEnergyDecayMultiplier: z.number().default(1.2),
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
  stormSpreadMultiplier: z.number().default(0.2),
}).strict()

const ConstructionSchema = z.object({
  houseTicks: z.number().default(2880),
  houseMaterials: z.object({
    wood: z.number().default(10),
  }).strict().prefault({}),
  houseSize: z.object({
    w: z.number().int().default(2),
    h: z.number().int().default(2),
  }).strict().prefault({}),
}).strict()

// `weaponKinds` is optional and carries NO default, which is the whole of it: absent from
// every authored row, absent from the parsed object, and therefore invisible to
// stateHash(DEFAULT_CONFIG). It is the one door left for an arbiter-codified spear to be a
// weapon now that the schema is closed (C11 Task 37, batch-4 ruling 1).
export const RecipeSchema = z.object({
  inputs: z.record(z.string(), z.number()),
  output: z.object({ kind: z.string(), qty: z.number() }).strict(),
  skill: z.string(),
  weaponKinds: z.array(z.string()).optional(),
}).strict()

const CraftingSchema = z.object({
  recipes: z.record(z.string(), RecipeSchema).default({
    plank: { inputs: { wood: 1 }, output: { kind: 'plank', qty: 2 }, skill: 'carpentry' },
    // The clothing line: what a hide or a handful of fiber becomes on the way to a warm night.
    cloth: { inputs: { fiber: 2 }, output: { kind: 'cloth', qty: 1 }, skill: 'tailoring' },
    garment: { inputs: { cloth: 2 }, output: { kind: 'garment', qty: 1 }, skill: 'tailoring' },
  }),
  expertLevel: z.number().int().default(5),
  expertDifficulty: z.number().int().default(4),
}).strict()

// What a building costs, how big it stands, how hard it is to knock down, how long it takes —
// and whether it has a roof.
//
// ★ `roofed` REPLACED TWO ROSTERS. `structures.enterableKinds` and `structures.sleepableKinds`
// were hand-written lists of kind names, and the valley's cabins, cottages and farmhouses were
// missing from both — so a mind walked to a cottage door, was told "there is no way into a
// cottage", and learned nothing it could use. A roster says which names somebody remembered;
// a property says what a building IS. Ask the kind whether it has a roof over it, and the
// answer is the same for the way in, the cold it holds off, and lying down out of the weather.
export const StructureRecipeSchema = z.object({
  inputs: z.record(z.string(), z.number()),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  maxHp: z.number().positive(),
  flammable: z.boolean(),
  durationTicks: z.number().int().positive(),
  // Defaults to false, so a kind the arbiter codifies is a thing in the world and not a shelter
  // until somebody says it is one.
  roofed: z.boolean().default(false),
  // ★ AND `hearth` KILLS THE THIRD ROSTER. `HEAT_SOURCE_KINDS` was a two-name Set in the warmth
  // system, so the fire in a house was a thing the renderer drew and no verb could reach. A
  // furnishing is NOT an entity here and NOT a coordinate: it is a property of the kind, exactly
  // as a roof is, and its fire is the building's own `fueledUntilTick`. One row answers what
  // glows, what a pot can be cooked on, and what holds the cold off a body beside it.
  hearth: z.boolean().default(false),
  // And a bed, for the same reason and by the same rule. TWO BOOLEANS AND NOT A LIST OF
  // FURNISHINGS: a house also holds a table, a chair and a rug, and putting those words here
  // would be dead data — no law reads them, and a mind handed a word with no verb behind it
  // spends turns being refused. A flag exists here because a law asks for it, and for no other
  // reason. The room the renderer draws is the wider truth; this is the part the world acts on.
  bed: z.boolean().default(false),
  // ★ WHO CHOOSES THE GROUND. Absent means the town does: the kind is a mass, it takes a plot,
  // and `claimInWorld` seats it. `sited` means the builder names x and y, because the thing is
  // not a mass — a deck belongs to the water it crosses, a lamp to the spot somebody wanted lit.
  // This replaced `kind !== BRIDGE_KIND`, which was the roster form of the same question.
  sited: z.boolean().default(false),
}).strict()

const StructuresSchema = z.object({
  privateKinds: z.array(z.string()).default(['house']),
  sleepIndoorsOnly: z.boolean().default(true),
  // An empty `inputs` marks a kind the world places and nobody builds. Every kind the world
  // places has a row here now, because a kind with no row is a kind nothing can say `roofed`
  // about — which is exactly how three dwellings became scenery.
  recipes: z.record(z.string(), StructureRecipeSchema).default({
    house: { inputs: { wood: 10 }, w: 2, h: 2, maxHp: 50, flammable: true, durationTicks: 2880, roofed: true, hearth: true, bed: true, sited: false },
    well: { inputs: { stone: 8 }, w: 1, h: 1, maxHp: 30, flammable: false, durationTicks: 720, roofed: false, hearth: false, bed: false, sited: false },
    bridge: { inputs: { wood: 6 }, w: 1, h: 2, maxHp: 20, flammable: false, durationTicks: 480, roofed: false, hearth: false, bed: false, sited: true },
    grave: { inputs: {}, w: 1, h: 1, maxHp: 10, flammable: false, durationTicks: 1, roofed: false, hearth: false, bed: false, sited: false },
    // The four the town template plants. Their mass and their hp were already authored — the
    // footprints in `cityTemplate`, the hp in the engine's genesis table — and this is the row
    // both now read, so a cottage is one building and not three descriptions.
    //
    // ★ THE COTTAGE AND THE FARMHOUSE ARE BUILDABLE, AND THE PRICE IS THE HOUSE'S OWN RATE.
    // A house is 4 tiles of floor for 10 wood and 2 880 ticks: 2.5 wood and 720 ticks a tile.
    // A cottage is 6 tiles and a farmhouse is 8, so they cost 15/4 320 and 20/5 760 — one
    // derivation, not three authored numbers, and `config.test.ts` holds them to it. They had
    // to become buildable for genesis to stand them up ROOFLESS: a wall nobody can finish is
    // the cabin-that-was-not-a-cabin all over again, and standing seven of them in the founding
    // valley would have rebuilt arm B at nine times the scale.
    //
    // The cabin stays unbuildable on purpose. It is 2x2, exactly a house's mass, so a buildable
    // one would be the same building under a second name — a word in every mind's vocabulary
    // that buys nothing. It is the one dwelling whose roof held.
    //
    // ★ AND IT IS THE ONLY INDOOR FIRE THE FOUNDING VALLEY HAS. Genesis takes the roof off every
    // buildable dwelling, so every `hearth` in the valley stood behind unfinished walls and
    // there was NOWHERE A BODY COULD GO TO BE WARM: a 720-tick rehearsal measured zero hearth
    // behaviour because the cold → shelter → fire chain had no terminal state on the shipped
    // world. The square's fire pit does not answer it — `fireIsOnYourSide` gives a body under a
    // roof none of an open fire, so stepping in out of the cold left it colder.
    //
    // The cabin is the only kind that COULD answer it. `roofFell` throws on a roofed kind that
    // is unbuildable and not sound, so the sound set is forced to be exactly the unbuildable
    // roofed kinds — this and the storehouse — and a storehouse is a roof over goods. A cabin
    // with a stove in it is what a cabin is.
    //
    // NO BED, and that is the point of it rather than an omission: the cabin is the refuge and
    // the house is the home. The founders can be warm on the first night and still have every
    // reason to finish a roof — `shelterLedger` stays at 0.8, and the want the abandoned
    // village exists to create is untouched.
    //
    // ★ AND THE LADDER RAN THE WRONG WAY, WHICH ONE RATE MAKES EASY TO PROVE. Under 2.5 wood a
    // tile, a farmhouse is 20 wood, 5 760 ticks and 4 sleeping slots — and so is a PAIR of
    // houses, to the wood and to the tick. So a mind that saved half again and worked half
    // again bought the same floor MINUS two fires and two beds: not a worse rung, a strictly
    // dominated one at an identical price. `wants` would have pointed a mind straight up it.
    //
    // The fix is effectiveness, not price (tuning order: effectiveness → abundance → time-cost
    // → difficulty LAST). Every dwelling gets the fire and the bed, and the rung a bigger one
    // buys is FUEL: `stoke` feeds the BUILDING for `light.fuelBurnTicks` on one wood, and
    // `besideAKeptFire` warms everybody in the room, so a farmhouse keeps 4 bodies warm on the
    // armful that keeps a house's 2: 0.375 wood a body-night against 0.75. A real trade, out of
    // laws already shipped, with no new dial and the rate untouched.
    //
    // What the house keeps is `privateKinds`, which names it and nothing else: a couple's night
    // only counts under its own roof. So the big dwellings are not better houses — they are
    // cheaper warmth bought by giving up the door you own.
    storehouse: { inputs: {}, w: 2, h: 2, maxHp: 40, flammable: true, durationTicks: 1, roofed: true, hearth: false, bed: false, sited: false },
    cabin: { inputs: {}, w: 2, h: 2, maxHp: 50, flammable: true, durationTicks: 1, roofed: true, hearth: true, bed: false, sited: false },
    cottage: { inputs: { wood: 15 }, w: 3, h: 2, maxHp: 60, flammable: true, durationTicks: 4320, roofed: true, hearth: true, bed: true, sited: false },
    farmhouse: { inputs: { wood: 20 }, w: 4, h: 2, maxHp: 80, flammable: true, durationTicks: 5760, roofed: true, hearth: true, bed: true, sited: false },
    // The town's open fire, here for the same reason the storehouse and the dwellings came off
    // `GENESIS_STRUCTURE_DEFS` when `roofed` landed: a kind with no row is a kind nothing can
    // say `hearth` about, and hp written in two places is hp that drifts. Nobody builds it —
    // `inputs` is empty — and it has no roof, which is what an open fire is.
    //
    // ★ THERE IS NO `hearth` ROW, AND THE OLD ROSTER'S FIRST NAME WAS A GHOST. `HEAT_SOURCE_KINDS`
    // was `['hearth', 'fire_pit']` and NOTHING IN THIS WORLD HAS EVER STOOD A STRUCTURE OF KIND
    // `hearth`: the template has no such building and genesis places none. A hearth is not a
    // building at all — it is a thing a house HAS, which is exactly what the flag above says.
    fire_pit: { inputs: {}, w: 1, h: 1, maxHp: 10, flammable: false, durationTicks: 1, roofed: false, hearth: true, bed: false, sited: false },
    // ★ THE CHEAPEST THING IN THE WORLD, ON PURPOSE. The dark has charged 1.5x for work since
    // C11 and the only fixed answer was the square's own fire pit; a torch is 240 ticks in one
    // hand. 2 wood and 120 ticks is two hours of one night, so the want that arrives at dusk
    // can be answered before dawn — which a house at 2 880 cannot. Wood, not stone: the only
    // outcrops are on the hill fifty tiles south-west, and a road that far is not a road.
    // `flammable: false` matches the bridge, which is also six planks that do not burn: what
    // burns here is the fuel in the basket, and `fueledUntilTick` already puts that out.
    lamp_post: { inputs: { wood: 2 }, w: 1, h: 1, maxHp: 15, flammable: false, durationTicks: 120, roofed: false, hearth: false, bed: false, sited: true },
  }),
}).strict()

const ReproductionSchema = z.object({
  enabled: z.boolean().default(true),
  coSleepNightsToPartner: z.number().int().default(3),
  partnerWindowDays: z.number().int().default(7),
  conceptionChancePerNight: z.number().default(0.2),
  gestationDays: z.number().int().default(72),
  fertileYears: z.object({
    from: z.number().int().default(16),
    to: z.number().int().default(45),
  }).strict().prefault({}),
}).strict()

const SpoilageSchema = z.object({
  enabled: z.boolean().default(true),
  // `hide` is deliberately absent: it is a material, not a meal, and absent means it keeps.
  days: z.record(z.string(), z.number()).default({ fish: 2, berries: 3, rabbit_meat: 3, venison: 4, bread: 6, wheat: 60 }),
  storehouseMultiplier: z.number().default(2),
  preservingKinds: z.array(z.string()).default(['storehouse']),
}).strict()

const SeasonsSchema = z.object({
  winter: z.object({
    hungerDecayMultiplier: z.number().default(1.25),
    fishCatchMultiplier: z.number().default(0.5),
  }).strict().prefault({}),
}).strict()

const ToolsSchema = z.object({
  wearEnabled: z.boolean().default(true),
  wearPerUse: z.number().default(1),
}).strict()

const MysterySchema = z.object({
  enabled: z.boolean().default(true),
  chancePerDay: z.number().default(0.08),
}).strict()

// C11 adds maxNodes here; roadCost stays C9's (deep-world addendum §11).
const PathingSchema = z.object({
  roadCost: z.number().default(0.6),
  maxNodes: z.number().int().positive().default(6000),
}).strict()

// Flag-only sections: the feature they gate is physics that already has a home elsewhere.
const FlagSchema = z.object({ enabled: z.boolean().default(true) }).strict()

// ------------------------------------------------------------------ C11: the deep world
// Every section below carries an `enabled` flag and lands in exactly one schema edit, so
// `stateHash(DEFAULT_CONFIG)` moves once for the whole chunk instead of twenty times.

// No `maxHp` of its own (deviation 1): `health.maxHp` already exists and fold reads it.
const MortalitySchema = z.object({
  enabled: z.boolean().default(true),
  drainPerTick: z.object({
    // At 0.05 a grave wound killed in 4.8 hours and a serious one in half a day — less time
    // than it takes to be seen from across a meadow and walked to, so the designed overlap
    // (one body notices another is hurt and crosses the town) could not physically happen.
    // 0.025 gives every tier a window longer than that walk and still leaves the herb as the
    // only answer to a grave one: tended and asleep saves a serious wound, not that (T37b).
    injury: z.number().default(0.025),
    poison: z.number().default(0.12),
    illness: z.number().default(0.08),
    fatigue: z.number().default(0.04),
  }).strict().prefault({}),
  hungerHpDrainPerTick: z.number().default(0.1),
  thirstHpDrainPerTick: z.number().default(0.15),
  poisonChanceSpoiled: z.number().default(0.35),
  sleepRegenMultiplier: z.number().default(3),
  fedThreshold: z.number().default(40),
  herbRelief: z.number().default(1),
  tendMultiplier: z.number().default(2),
  graveEnabled: z.boolean().default(true),
}).strict()

// Contagion is ON at a low dial from genesis (§13 option A, user ruling 2). §13 is closed.
const IllnessSchema = z.object({
  enabled: z.boolean().default(true),
  dailyWorsenChance: z.number().default(0.25),
  contagionEnabled: z.boolean().default(true),
  contagionChance: z.number().default(0.06),
  contagionRadius: z.number().default(3),
}).strict()

// Deviation 2: the spec writes the decay as "0.6 x hunger rate", which is a derivation and
// not a literal — so it is stored as the factor and derived once, by thirstDecayPerTick.
const ThirstSchema = z.object({
  enabled: z.boolean().default(true),
  decayFactorOfHunger: z.number().default(0.6),
  drinkRestore: z.number().default(60),
  waterskinCharges: z.number().int().positive().default(4),
}).strict()

const FertilitySchema = z.object({
  enabled: z.boolean().default(true),
  radius: z.number().default(3),
  waterBonus: z.number().default(0.5),
  maxMultiplier: z.number().default(1.5),
}).strict()

const RoadsSchema = z.object({
  enabled: z.boolean().default(true),
  stonePerTile: z.number().int().positive().default(1),
  paveDurationTicks: z.number().int().positive().default(6),
}).strict()

const DesirePathsSchema = z.object({
  enabled: z.boolean().default(true),
  wearThreshold: z.number().positive().default(120),
  decayPerDay: z.number().default(0.1),
  regrowThreshold: z.number().default(30),
  overgrowDays: z.number().int().positive().default(20),
  pathCost: z.number().default(0.8),
}).strict()

// The caps and the regen ARE the ecology: there is no population model beneath them.
const FaunaSchema = z.object({
  enabled: z.boolean().default(true),
  caps: z.object({
    deer: z.number().int().default(8),
    rabbit: z.number().int().default(12),
    fish: z.number().int().default(6),
  }).strict().prefault({}),
  movePeriodTicks: z.number().int().positive().default(4),
  fleeRadius: z.number().default(4),
  huntDifficulty: z.object({
    deer: z.number().default(3),
    rabbit: z.number().default(2),
  }).strict().prefault({}),
  fishSchoolBonus: z.number().default(2),
}).strict()

const ambientBand = (day: number, dusk: number, night: number) => z.object({
  day: z.number().default(day), dusk: z.number().default(dusk), night: z.number().default(night),
}).strict().prefault({})

// Controller ruling 4 ratified these numbers: they decide whether the first winter is
// survivable with effort, which is the product intent. Retune in C8 via config_changed.
const WarmthSchema = z.object({
  enabled: z.boolean().default(true),
  comfortBand: z.number().default(8),
  exposureDecayPerTick: z.number().default(0.3),
  heatRadius: z.number().default(2),
  // Twelve is the gap at the mildest winter hour (comfortBand 8 over ambient −4). At 2 the
  // coat decided one band of twelve — an autumn dusk — and nothing at all in the season the
  // clothing line exists for. Twelve is the LEAST that reaches winter and reaches no hour
  // past its mildest: dusk, night and a snowy day still want a roof or a fire (C11 T37b).
  insulation: z.object({ garment: z.number().default(12) }).strict().prefault({}),
  // ★ WHAT A FED FIRE IS ACTUALLY WORTH, and until now it was worth nothing. `isExposed` treats
  // a roof, a coat and a fire as three answers to the same question — but only the fire's answer
  // stopped at "you are not freezing". A body beside one still drifted to the WEATHER's number,
  // so on a winter night an indoor body sat at warmth 10 and read "you shiver against the cold"
  // and "these walls are holding it off you" in the same breath. Twelve, because it is the
  // garment's own number and the two are already interchangeable one line above `isExposed`:
  // it carries a winter night from 10 to 34, over the shiver line and no further.
  fireWarmth: z.number().default(12),
  ambient: z.object({
    spring: ambientBand(14, 9, 5),
    summer: ambientBand(26, 20, 15),
    autumn: ambientBand(10, 6, 2),
    winter: ambientBand(-4, -8, -12),
  }).strict().prefault({}),
  weatherDelta: z.object({
    storm: z.number().default(-1),
    snow: z.number().default(-2),
  }).strict().prefault({}),
}).strict()

const LightSchema = z.object({
  enabled: z.boolean().default(true),
  nightWorkPenalty: z.number().default(1.5),
  workRadius: z.number().default(2),
  torchBurnTicks: z.number().int().positive().default(240),
  fuelBurnTicks: z.number().int().positive().default(480),
  fireRiskPerTick: z.number().default(0.0005),
  glowRadius: z.object({
    torch: z.number().default(3),
    lantern: z.number().default(5),
    hearth: z.number().default(3),
    fire_pit: z.number().default(4),
    // A standing light: shorter reach than the square's fire, and it is not a heat source, so
    // this table is the whole of what makes it a lamp — glow, and a structure that takes fuel.
    lamp_post: z.number().default(4),
  }).strict().prefault({}),
}).strict()

// Light at the target restores visibility, not light at the eye. That asymmetry is the mechanic.
const NightWitnessSchema = z.object({
  enabled: z.boolean().default(true),
  nightFactor: z.number().default(0.35),
  duskFactor: z.number().default(0.7),
}).strict()

const FoodVarietySchema = z.object({
  enabled: z.boolean().default(true),
  windowDays: z.number().int().positive().default(3),
  bonusPerKind: z.number().default(0.05),
  maxBonus: z.number().default(0.2),
}).strict()

const RegrowthSchema = z.object({
  enabled: z.boolean().default(true),
  saplingChancePerDay: z.number().default(0.02),
  saplingDays: z.number().int().positive().default(30),
}).strict()

// ★ NO CEILING, NO PACE, NO STEP. `maxSize` was a round number in a world whose grammar plats
// rings forever, and `step`/`structuresPerStep` were a pace guessed against it. What the world
// owes is a clearance — `WORLD_MARGIN` of ground beyond everything standing — and a clearance
// says by itself which edge to widen and by how much. The one thing left to decide is whether
// the world may widen at all.
const MapGrowthSchema = z.object({
  enabled: z.boolean().default(true),
}).strict()

// `custom` exists precisely so the taxonomy is open-ended: the arbiter may recognize a type
// nobody seeded. None of these words ever reaches a prompt.
const ConstructsSchema = z.object({
  enabled: z.boolean().default(true),
  minParticipants: z.number().int().positive().default(3),
  minRecurrences: z.number().int().positive().default(2),
  windowDays: z.number().int().positive().default(7),
  types: z.object({
    festival: z.boolean().default(true),
    faith: z.boolean().default(true),
    council: z.boolean().default(true),
    market: z.boolean().default(true),
    custom: z.boolean().default(true),
  }).strict().prefault({}),
}).strict()

// A genesis input, not a dial. The map grows by world_grown, never by an operator edit.
const WorldSchema = z.object({
  size: z.object({
    w: z.number().int().positive().default(128),
    h: z.number().int().positive().default(128),
  }).strict().prefault({}),
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
}).strict()

export type SimConfig = z.infer<typeof SimConfigSchema>
export type CropDef = z.infer<typeof CropDefSchema>
export type RecipeDef = z.infer<typeof RecipeSchema>
export type StructureRecipeDef = z.infer<typeof StructureRecipeSchema>

/** Does a building of this kind have a roof over it? The one derivation (G4) behind every
 *  question that used to be answered by a roster: the way in, the cold held off, and whether a
 *  body can lie down out of the weather. A kind with no row is not a shelter. */
export function isRoofedKind(config: SimConfig, kind: string): boolean {
  return config.structures.recipes[kind]?.roofed === true
}

/** Does a building of this kind hold a fire somebody can feed? The one derivation (G4) behind
 *  what glows after dark, what a pot can be cooked on, and what holds the cold off a body
 *  beside it. A kind with no row has no fire in it. */
export function isHearthKind(config: SimConfig, kind: string): boolean {
  return config.structures.recipes[kind]?.hearth === true
}

/** Is there a bed in a building of this kind? The one derivation (G4) behind how well a body
 *  sleeps in it. `roofed` says a body may lie down out of the weather at all; this says whether
 *  it lies down on a bed or on the boards. */
export function isBeddedKind(config: SimConfig, kind: string): boolean {
  return config.structures.recipes[kind]?.bed === true
}

// The one derivation of the slower clock (G4): 0.021/tick at defaults, 0.6x hunger by ruling D4.
export function thirstDecayPerTick(config: SimConfig): number {
  return config.needs.hungerDecayPerTick * config.thirst.decayFactorOfHunger
}

// World law, not a dial: a mind wakes at twelve. Config would make it negotiable.
export const SPAWN_AGE_YEARS = 12

export const DEFAULT_CONFIG: SimConfig = SimConfigSchema.parse({})
