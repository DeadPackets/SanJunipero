import {
  T_EARTH,
  T_FARMLAND,
  T_FOREST,
  T_GRASS,
  T_ROCK,
  T_SAND,
  T_WATER,
  type SimConfig,
  type TileId,
  type TownFacing,
} from '@sj/shared'
import type { FaunaKind } from './data/faunaDefs.js'
import type { ForageableKind } from './data/forageables.js'

export type { TileId }

// The ground a recipe is allowed to name, and the one table for it. Road, path, sapling and
// channel are deliberately absent — a rule may not ask for ground the town has no word for.
export const RECIPE_TILE_IDS: Readonly<Record<string, TileId>> = {
  grass: T_GRASS,
  dirt: T_EARTH,
  water: T_WATER,
  forest: T_FOREST,
  rock: T_ROCK,
  sand: T_SAND,
  farmland: T_FARMLAND,
}

const RECIPE_TILE_KIND_BY_ID: ReadonlyMap<TileId, string> = new Map(
  Object.entries(RECIPE_TILE_IDS).map(([kind, id]) => [id, kind]),
)

export function recipeTileKind(tile: TileId): string | null {
  return RECIPE_TILE_KIND_BY_ID.get(tile) ?? null
}

// The four ways a body can be failing. A named affliction is a cause with a clock on it —
// `ill: boolean` stays for the older logs that only ever knew the one word.
export const AFFLICTION_KINDS = ['fatigue', 'illness', 'injury', 'poison'] as const
export type AfflictionKind = (typeof AFFLICTION_KINDS)[number]
// `sourceId` is the hand behind it, absent when nobody is: a death has to be able to name
// an attacker a tick after the blow, and only the body still remembers.
export type Affliction = {
  kind: AfflictionKind
  severity: number
  sinceTick: number
  sourceId?: string
}

export type AgentBody = {
  id: string
  name: string
  x: number
  y: number
  alive: boolean
  asleep: boolean
  needs: { hunger: number; energy: number; warmth: number; social: number }
  hp: number
  injuries: { kind: 'minor' | 'serious' | 'grave'; day: number }[]
  ill: boolean
  ageDays: number
  sex?: 'f' | 'm' // absent = 'f'; read through sexOf(), keeps pre-C9 hashes stable
  pregnant?: { sinceDay: number; byId: string }
  parents?: [string, string] // [motherId, fatherId]; only ever set on the born
  // Absent until the first affliction and absent again when the last one lifts, sorted by kind
  // so two bodies ailing the same way hash the same way.
  afflictions?: Affliction[]
  thirst?: number // 0..100; absent means full, read only through thirstOf()
  // How many times this body has hit the ground without a meal or a night's sleep since.
  // Absent until the first such fall, and absent again the moment it eats or sleeps.
  collapsesWithoutRecovery?: number
  // Absent until the first such tick, and absent again the moment it recovers — it is what lets
  // a fatal ladder a winter night drove be named for the night.
  coldTicksSinceRecovery?: number
  // What this body has eaten lately, pruned to the variety window at every meal. Absent until
  // the first one, so a body that has never eaten hashes as it always did.
  recentFoods?: { kind: string; day: number }[]
  // What the body is wearing. One slot in v1; absent until the first thing is put on, so a
  // town that never made a garment hashes exactly as it always did.
  equipped?: { body?: string }
  tendedTick?: number // absent until first tended: keeps pre-health state hashes stable
  lastSpokeTick?: number // absent until first speech: keeps golden hashes stable
  insideId?: string // absent until first entry: keeps golden hashes stable
  skills: Record<string, number> // track → xp
  activity: null | {
    verb: string
    ticksRemaining: number
    params: Record<string, unknown>
    path?: [number, number][]
  }
  collapsedSinceTick: number | null
  zeroHungerSinceTick: number | null
}

export type Structure = {
  id: string
  kind: string
  x: number
  y: number
  w: number
  h: number
  hp: number
  maxHp: number
  flammable: boolean
  stage: 'construction' | 'complete'
  progressTicks: number
  builtBy: string | null
  burning: boolean
  burnTicks: number
  owner?: string // absent = public; the hash-stable form of `agentId | null`
  // Absent means `sw`. A turned 2x2 is byte-identical to an unturned one, so w/h cannot answer
  // for a house the way they do for a deck; absent-means-default keeps every old world's hash.
  facing?: TownFacing
  inscription?: { text: string; by: string } // absent = unmarked; only the latest layer, the log keeps the rest
  // The tick a fed fire burns down to. Absent until somebody stokes it, so an unlit hearth is
  // a hearth that was never lit — and the same field answers "is it warm" and "is it bright".
  fueledUntilTick?: number
}

export type Item = {
  id: string
  kind: string
  qty: number
  text?: string
  owner?: string // absent = unowned; outlives the owner's death
  crafterMark?: string // expert crafts only; set once at spawn, never reassigned
  spoilage?: { spawnDay: number; days: number } // absent = keeps forever
  durability?: number // absent = never wears; 0 breaks the thing
  charges?: number // absent = not a vessel; 0 = a vessel standing empty
  // A flame and the fuel behind it, never both at once. Absent on both is a torch nobody has
  // struck yet — which is a full one.
  litUntilTick?: number
  fuelTicks?: number
  loc:
    | { t: 'tile'; x: number; y: number }
    | { t: 'agent'; id: string }
    | { t: 'structure'; id: string }
}

export type Crop = {
  id: string
  kind: string
  x: number
  y: number
  plantedDay: number
  stage: number
  withered: boolean
}

// A body with no mind. `stock` is the size of a fish school and is absent on anything that
// walks; `alive` is the interface the hunt reads, and a kill removes the entity outright.
export type Fauna = { kind: FaunaKind; x: number; y: number; alive: boolean; stock?: number }

// Stripped it stays where it is at zero: the ground remembers where to put the berries back.
// fullStock is absent on a node from a log that predates the ceiling, which crawls back to one.
export type Forageable = {
  kind: ForageableKind
  x: number
  y: number
  stock: number
  fullStock?: number
}

export type WorldState = {
  tick: number
  terrain: TileId[][] // [y][x]
  weather: { kind: string; temperatureC: number }
  agents: Record<string, AgentBody>
  structures: Record<string, Structure>
  items: Record<string, Item>
  crops: Record<string, Crop>
  wildlife: { fish: number; deer: number }
  // Absent until the first co_slept, so a world with no nights hashes as it always did.
  pairNights?: Record<
    string,
    {
      nights: number
      lastNightDay: number
      formedTick: number | null
      dissolvedTick: number | null
    }
  >
  // Runtime overrides of world physics, keyed by dotted config path. Absent until the
  // first config_changed; hashed, snapshotted and replayed like every other fact.
  laws?: Record<string, unknown>
  // How many times the map has grown. Absent until the first world_grown, so a world that
  // never widens hashes as it always did. Read only through growthsSoFar().
  growths?: number
  // Where the array's (0, 0) stands in the AUTHORED frame. Growing north or west moves it, south
  // or east never does; absent while the frames agree, so such a world hashes exactly as it did.
  origin?: { x: number; y: number } | undefined
  // Footfalls per tile, keyed "x,y" — sparse, because a 128x128 array of zeroes is a hash of
  // nothing. Absent until the first step anybody takes.
  traffic?: Record<string, number>
  // The day each standing trail went quiet; absent while every trail is still in use.
  quietSince?: Record<string, number>
  // The day each standing sapling was seeded, keyed "x,y" — the maturity clock, sparse and
  // dropped the moment the tile stops being a sapling, so a grown wood hashes like an old one.
  saplings?: Record<string, number>
  // The herd, the warren and the schools. Absent until the genesis scatter or the first dawn
  // that spawns one, and absent again when the last body is taken.
  fauna?: Record<string, Fauna>
  // Every bush, patch, bank and outcrop the world authored. Absent until the genesis scatter,
  // and never removed: a picked node is a node at zero, not a node that stopped existing.
  forageables?: Record<string, Forageable>
  counters: { nextEntityId: number }
}

export function genesisState(config: SimConfig, terrain?: TileId[][]): WorldState {
  return {
    tick: 0,
    terrain:
      terrain ?? Array.from({ length: 32 }, () => Array.from({ length: 32 }, (): TileId => 0)),
    weather: { kind: 'sunny', temperatureC: config.weather.seasonTemps.spring },
    agents: {},
    structures: {},
    items: {},
    crops: {},
    wildlife: { fish: config.wildlife.fishMax, deer: config.wildlife.deerMax },
    counters: { nextEntityId: 1 },
  }
}

/** Where the array's (0, 0) stands in the frame genesisTerrainAt is written in. Homed beside the
 *  field rather than in mapGrowth, because the town has to ask it too. */
export function authoredOrigin(state: { origin?: { x: number; y: number } | undefined }): {
  x: number
  y: number
} {
  return state.origin ?? { x: 0, y: 0 }
}

// The one reader of the field. A body that has never been thirsty is a full one, which
// is what lets every older log fold to the hash it always had.
export function thirstOf(a: { thirst?: number }): number {
  return a.thirst ?? 100
}

// `offset` is for the rare emitter that mints two ids before either has folded — a carcass
// that yields meat and a hide. One derivation of an id, still.
export function mintId(state: WorldState, prefix: string, offset = 0): string {
  return `${prefix}_${state.counters.nextEntityId + offset}`
}
