import { z } from 'zod'
import { TOWN_FACINGS } from '@sj/shared'

export const TickAdvanced = z.object({}).strict()
export const AgentSpawned = z.object({
  id: z.string(), name: z.string(), x: z.number(), y: z.number(), ageDays: z.number(),
  sex: z.enum(['f', 'm']).optional(),
}).strict()
export const CoSlept = z.object({ aId: z.string(), bId: z.string(), day: z.number().int() }).strict()
export const AgentConceived = z.object({
  motherId: z.string(), fatherId: z.string(), day: z.number().int(),
}).strict()
export const AgentBorn = z.object({
  id: z.string(), name: z.string(), sex: z.enum(['f', 'm']),
  motherId: z.string(), fatherId: z.string(), x: z.number(), y: z.number(),
}).strict()
export const AgentMoved = z.object({ id: z.string(), x: z.number(), y: z.number() }).strict()
// `reason` is optional so every recorded need change still parses. Only the cold sets
// it, on the one event per tick where a body with no warmth left pays for it in energy.
export const NeedChanged = z.object({
  id: z.string(), need: z.enum(['hunger', 'energy', 'warmth', 'social']), delta: z.number(),
  reason: z.literal('exposure').optional(),
}).strict()

export const ItemLoc = z.discriminatedUnion('t', [
  z.object({ t: z.literal('tile'), x: z.number(), y: z.number() }).strict(),
  z.object({ t: z.literal('agent'), id: z.string() }).strict(),
  z.object({ t: z.literal('structure'), id: z.string() }).strict(),
])
export const ItemSpawned = z.object({
  id: z.string(), kind: z.string(), qty: z.number(), loc: ItemLoc, text: z.string().optional(),
  owner: z.string().optional(), crafterMark: z.string().optional(),
  spoilage: z.object({ spawnDay: z.number(), days: z.number() }).strict().optional(),
  durability: z.number().int().positive().optional(),
  charges: z.number().int().nonnegative().optional(),
}).strict()
export const ItemMoved = z.object({ id: z.string(), loc: ItemLoc }).strict()
export const ItemSpoiled = z.object({ id: z.string() }).strict()
export const ItemWorn = z.object({ id: z.string(), delta: z.number().int() }).strict()
export const ItemBroke = z.object({ id: z.string() }).strict()
export const ItemOwnerChanged = z.object({ id: z.string(), owner: z.string() }).strict()
// A vessel is filled to a whole number of doses, never topped up by a fraction.
export const ItemFilled = z.object({ itemId: z.string(), charges: z.number().int().nonnegative() }).strict()
// Pure witness record — folds to nothing. Whether a taking is theft is the town's to decide.
export const ItemTaken = z.object({
  itemId: z.string(), kind: z.string(), takerId: z.string(), ownerId: z.string(), x: z.number(), y: z.number(),
}).strict()
// Clothing. One slot in v1, and the slot rides the event so a second one costs a schema
// change and not a guess. Taking a worn thing out of the hands takes it off the body too.
export const ItemEquipped = z.object({
  agentId: z.string(), itemId: z.string(), slot: z.literal('body'),
}).strict()
export const ItemUnequipped = z.object({ agentId: z.string(), itemId: z.string() }).strict()
// `burnsUntilTick` rides the event so the fold need not know the config to place the flame in
// time; snuffing carries nothing, because what is left is arithmetic the fold can do.
export const ItemLit = z.object({ itemId: z.string(), burnsUntilTick: z.number().int() }).strict()
export const ItemSnuffed = z.object({ itemId: z.string() }).strict()
export const ItemBurnedOut = z.object({ itemId: z.string() }).strict()
export const StructureFueled = z.object({
  structureId: z.string(), burnsUntilTick: z.number().int(),
}).strict()
export const ItemQtyChanged = z.object({ id: z.string(), delta: z.number() }).strict()
export const ItemTextChanged = z.object({ id: z.string(), text: z.string() }).strict()
export const StructurePlanned = z.object({
  id: z.string(), kind: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  maxHp: z.number(), flammable: z.boolean(), builderId: z.string(), owner: z.string().optional(),
  // Two facings and no third: NE and NW are unauthored and must stay unrepresentable. Written
  // only when the plot TURNED the building, so an unturned world folds the payload it always did.
  facing: z.enum(TOWN_FACINGS).optional(),
}).strict()
export const StructureProgressed = z.object({ id: z.string(), ticks: z.number() }).strict()
export const StructureCompleted = z.object({ id: z.string() }).strict()
export const StructureInscribed = z.object({
  structureId: z.string(), text: z.string().min(1).max(280), agentId: z.string(),
}).strict()
export const StructureDamaged = z.object({ id: z.string(), amount: z.number() }).strict()
export const StructureDestroyed = z.object({ id: z.string() }).strict()
export const FireIgnited = z.object({ structureId: z.string(), cause: z.string() }).strict()
export const FireSpread = z.object({ fromId: z.string(), toId: z.string() }).strict()
// A dousing has a place and a pair of hands. The new fields are optional so
// every recorded rain and burnout still parses, and `cause` stays required.
export const FireExtinguished = z.object({
  structureId: z.string().optional(), cause: z.enum(['doused', 'rain', 'burnout']),
  x: z.number().int().optional(), y: z.number().int().optional(), agentId: z.string().optional(),
}).strict()

export const ActionStarted = z.object({
  agentId: z.string(), verb: z.string(), params: z.record(z.string(), z.unknown()), duration: z.number(),
}).strict()
export const ActionProgressed = z.object({ agentId: z.string(), ticks: z.number() }).strict()
export const ActionCompleted = z.object({
  agentId: z.string(), verb: z.string(), results: z.record(z.string(), z.unknown()).optional(),
}).strict()
export const ActionInterrupted = z.object({ agentId: z.string(), reason: z.string() }).strict()
export const SkillGained = z.object({ agentId: z.string(), track: z.string(), xp: z.number() }).strict()
export const AgentWoke = z.object({ agentId: z.string() }).strict()
export const AgentSlept = z.object({ agentId: z.string() }).strict()
export const AgentEntered = z.object({ agentId: z.string(), structureId: z.string() }).strict()
export const AgentExited = z.object({ agentId: z.string(), structureId: z.string() }).strict()
// insideId replays the doorway rule from the event alone — absent when the speaker was outdoors.
export const AgentSpoke = z.object({
  agentId: z.string(), text: z.string(), x: z.number(), y: z.number(), insideId: z.string().optional(),
}).strict()
// A witness record and nothing else. `sense` says which way the act travelled, so a replay knows
// a song from a dance; `insideId` replays the doorway rule from the event alone.
export const AgentExpressed = z.object({
  agentId: z.string(), verb: z.string().min(1), targetId: z.string().optional(),
  x: z.number(), y: z.number(), sense: z.enum(['sight', 'sound']).optional(),
  insideId: z.string().optional(),
}).strict()
// `byId` is the inventor, `intent` the words they used, `makes` the item kinds the new verb can
// produce (empty for a coined word). The tick is the envelope's.
export const DiscoveryMade = z.object({
  recipeId: z.string().min(1), name: z.string().min(1), kind: z.enum(['craft', 'word']),
  byId: z.string().min(1), intent: z.string().min(1), makes: z.array(z.string().min(1)),
}).strict()
export const AgentCollapsed = z.object({ agentId: z.string() }).strict()
// `cause` stays a free string so every recorded log still parses; DEATH_CAUSES is the
// vocabulary emitters are held to.
export const AgentDied = z.object({ agentId: z.string(), cause: z.string(), byId: z.string().optional() }).strict()
export const AgentAged = z.object({ agentId: z.string() }).strict()
export const AgentInjured = z.object({ agentId: z.string(), kind: z.enum(['minor', 'serious', 'grave']) }).strict()
export const AgentInfected = z.object({ agentId: z.string() }).strict()
export const AgentFellIll = z.object({ agentId: z.string() }).strict()
export const AgentRecovered = z.object({ agentId: z.string() }).strict()
// `agentId` stays the PATIENT so recorded logs fold unchanged; the hands and what was in
// them arrive as optional fields.
export const AgentTended = z.object({
  agentId: z.string(), tenderId: z.string().optional(), itemId: z.string().optional(),
}).strict()
export const HpChanged = z.object({ agentId: z.string(), delta: z.number() }).strict()

// Mortality. Harm is an amount with a source; an affliction is a cause with a clock.
const AfflictionKindSchema = z.enum(['fatigue', 'illness', 'injury', 'poison'])
export const AgentHarmed = z.object({
  agentId: z.string(), amount: z.number().nonnegative(),
  source: z.enum(['attack', 'fire', 'accident']), byId: z.string().optional(),
}).strict()
export const AgentAfflicted = z.object({
  agentId: z.string(), kind: AfflictionKindSchema, severity: z.number().positive(),
  sourceId: z.string().optional(), itemId: z.string().optional(),
}).strict()
export const AfflictionWorsened = z.object({
  agentId: z.string(), kind: AfflictionKindSchema, severity: z.number().positive(),
}).strict()
export const AfflictionRecovered = z.object({ agentId: z.string(), kind: AfflictionKindSchema }).strict()
// `x`/`y` are where the stone goes, already stepped clear of anything standing on the death
// tile; `name` is the dead as they were known, kept in the log because a grave has no name field.
export const GravePlaced = z.object({
  id: z.string(), agentId: z.string(), name: z.string(), x: z.number().int(), y: z.number().int(),
}).strict()
// Thirst is not one of the four needs: widening the NeedChanged enum would change what every
// recorded log means. It gets its own event and its own clock.
export const ThirstChanged = z.object({ id: z.string(), delta: z.number() }).strict()
export const AgentDrank = z.object({
  agentId: z.string(), source: z.enum(['water_tile', 'well', 'item']), itemId: z.string().optional(),
}).strict()
export const WeatherChanged = z.object({ kind: z.string(), temperatureC: z.number(), prevKind: z.string().optional() }).strict()
// Pure sensation: no fold effect, no cause, no resolution anywhere in the world.
export const MysteryEvent = z.object({
  kind: z.string(), x: z.number().int().optional(), y: z.number().int().optional(),
}).strict()

export const CropPlanted = z.object({
  id: z.string(), kind: z.string(), x: z.number(), y: z.number(), plantedDay: z.number(),
}).strict()
export const CropGrew = z.object({ cropId: z.string(), stage: z.number() }).strict()
export const CropWithered = z.object({ cropId: z.string() }).strict()
export const CropHarvested = z.object({ cropId: z.string() }).strict()
export const WildlifeChanged = z.object({ fish: z.number().optional(), deer: z.number().optional() }).strict()

// Fauna: bodies with no minds. `stock` rides the spawn because a school arrives as a
// number of fish, not as one; nothing that walks ever carries it.
const FaunaKindSchema = z.enum(['deer', 'rabbit', 'fish'])
export const FaunaSpawned = z.object({
  id: z.string(), kind: FaunaKindSchema, x: z.number().int(), y: z.number().int(),
  stock: z.number().int().positive().optional(),
}).strict()
// One event per movement beat, whatever moved. The destinations ARE the roll: they are drawn
// from the `fauna` stream at emission and travel here, so the fold never touches randomness.
export const FaunaMoved = z.object({
  moves: z.array(z.object({ id: z.string(), x: z.number().int(), y: z.number().int() }).strict()).min(1),
}).strict()
// fold is the only writer of world state, so taking one fish needs an event of its own. A school
// that reaches zero disbands as fauna_killed, which is why this one never carries a zero.
export const FaunaStockChanged = z.object({ id: z.string(), stock: z.number().int().positive() }).strict()
export const FaunaKilled = z.object({
  id: z.string(), kind: FaunaKindSchema, x: z.number().int(), y: z.number().int(),
  byId: z.string().optional(),
}).strict()
// Forageables. Stripping one is a stock change; the last handful is a depletion, which is
// the same arithmetic with a name the chronicle can use. A node is never removed.
const ForageableKindSchema = z.enum([
  'berry_bush', 'mushroom_patch', 'pale_mushroom_patch', 'herb_patch', 'clay_deposit', 'stone_outcrop',
  'reed_bed',
])
// `fullStock` is the abundance the ground climbs back toward. Optional so every recorded
// scatter still parses; absent means the old ceiling of one.
export const ForageableSpawned = z.object({
  id: z.string(), kind: ForageableKindSchema,
  x: z.number().int(), y: z.number().int(), stock: z.number().int().nonnegative(),
  fullStock: z.number().int().positive().optional(),
}).strict()
export const ForageableStockChanged = z.object({ id: z.string(), stock: z.number().int().positive() }).strict()
export const ForageableDepleted = z.object({ id: z.string() }).strict()
export const ForageableRegrown = z.object({ id: z.string(), stock: z.number().int().positive() }).strict()

export const TerrainChanged = z.object({ x: z.number(), y: z.number(), tile: z.number().int().min(0).max(7) }).strict()
// The terrain event. `terrain_changed` stays folded so recorded logs replay; this one
// carries where the cell came from and why, which is what a doctored log cannot fake.
export const TileChanged = z.object({
  x: z.number(), y: z.number(),
  from: z.number().int().min(0).max(10),
  to: z.number().int().min(0).max(10),
  reason: z.enum(['paved', 'worn', 'overgrown', 'channel', 'seeded', 'grown', 'tilled', 'cleared']),
  byId: z.string().optional(),
}).strict()
// The border strip is rolled from the `worldgen` stream at emission and travels in the
// payload, so replay from genesis and replay from any snapshot reach the identical map.
export const WorldGrown = z.object({
  edge: z.enum(['n', 'e', 's', 'w']),
  depth: z.number().int().positive(),
  tiles: z.array(z.array(z.number().int().min(0).max(10))),
}).strict()
// The nightly bookkeeping of the trails: no payload, because the arithmetic is the same
// everywhere and reading it out of the world is cheaper than writing it into the log.
export const TrafficDecayed = z.object({}).strict()
// The only road a world law travels. `value` is checked against TOGGLABLE_PATHS at fold.
export const ConfigChanged = z.object({ path: z.string(), value: z.unknown() }).strict()
