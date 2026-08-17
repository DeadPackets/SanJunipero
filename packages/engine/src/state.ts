import type { SimConfig } from '@sj/shared'
import type { FaunaKind } from './data/faunaDefs.js'

// grass, dirt, water, forest, rock, sand, farmland, road, path, sapling, channel
export type TileId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
export const MAX_TILE_ID = 10

// The four ways a body can be failing. A named affliction is a cause with a clock on it —
// `ill: boolean` stays for the C1 logs that only ever knew the one word.
export const AFFLICTION_KINDS = ['fatigue', 'illness', 'injury', 'poison'] as const
export type AfflictionKind = (typeof AFFLICTION_KINDS)[number]
// `sourceId` is the hand behind it, absent when nobody is: a death has to be able to name
// an attacker a tick after the blow, and only the body still remembers.
export type Affliction = { kind: AfflictionKind; severity: number; sinceTick: number; sourceId?: string }

export type AgentBody = {
  id: string; name: string; x: number; y: number; alive: boolean; asleep: boolean
  needs: { hunger: number; energy: number; warmth: number; social: number }
  hp: number; injuries: Array<{ kind: 'minor' | 'serious' | 'grave'; day: number }>
  ill: boolean; ageDays: number
  sex?: 'f' | 'm'                         // absent = 'f'; read through sexOf(), keeps pre-C9 hashes stable
  pregnant?: { sinceDay: number; byId: string }
  parents?: [string, string]              // [motherId, fatherId]; only ever set on the born
  // Absent until the first affliction and absent again when the last one lifts, sorted by kind
  // so two bodies ailing the same way hash the same way.
  afflictions?: Affliction[]
  thirst?: number                         // 0..100; absent means full, read only through thirstOf()
  // How many times this body has hit the ground without a meal or a night's sleep since.
  // Absent until the first such fall, and absent again the moment it eats or sleeps.
  collapsesWithoutRecovery?: number
  tendedTick?: number                     // absent until first tended: keeps pre-health state hashes stable
  lastSpokeTick?: number                  // absent until first speech: keeps golden hashes stable
  insideId?: string                       // absent until first entry: keeps golden hashes stable
  skills: Record<string, number>          // track → xp
  activity: null | { verb: string; ticksRemaining: number; params: Record<string, unknown>; path?: Array<[number, number]> }
  collapsedSinceTick: number | null
  zeroHungerSinceTick: number | null
}

export type Structure = {
  id: string; kind: string; x: number; y: number; w: number; h: number
  hp: number; maxHp: number; flammable: boolean; stage: 'construction' | 'complete'
  progressTicks: number; builtBy: string | null; burning: boolean; burnTicks: number
  owner?: string                          // absent = public; the hash-stable form of `agentId | null`
  inscription?: { text: string; by: string }  // absent = unmarked; only the latest layer, the log keeps the rest
}

export type Item = {
  id: string; kind: string; qty: number
  text?: string
  owner?: string                          // absent = unowned; outlives the owner's death
  crafterMark?: string                    // expert crafts only; set once at spawn, never reassigned
  spoilage?: { spawnDay: number; days: number }  // absent = keeps forever
  durability?: number                     // absent = never wears; 0 breaks the thing
  charges?: number                        // absent = not a vessel; 0 = a vessel standing empty
  loc: { t: 'tile'; x: number; y: number } | { t: 'agent'; id: string } | { t: 'structure'; id: string }
}


export type Crop = { id: string; kind: string; x: number; y: number; plantedDay: number; stage: number; withered: boolean }

// A body with no mind. `stock` is the size of a fish school and is absent on anything that
// walks; `alive` is the interface the hunt reads, and a kill removes the entity outright.
export type Fauna = { kind: FaunaKind; x: number; y: number; alive: boolean; stock?: number }

export type WorldState = {
  tick: number
  terrain: TileId[][]                      // [y][x]
  weather: { kind: string; temperatureC: number }
  agents: Record<string, AgentBody>
  structures: Record<string, Structure>
  items: Record<string, Item>
  crops: Record<string, Crop>
  wildlife: { fish: number; deer: number }
  // Absent until the first co_slept, so a world with no nights hashes as it always did.
  pairNights?: Record<string, { nights: number; lastNightDay: number; formedTick: number | null; dissolvedTick: number | null }>
  // Runtime overrides of world physics, keyed by dotted config path. Absent until the
  // first config_changed; hashed, snapshotted and replayed like every other fact.
  laws?: Record<string, unknown>
  // How many times the map has grown. Absent until the first world_grown, so a world that
  // never widens hashes as it always did. Read only through growthsSoFar().
  growths?: number
  // Footfalls per tile, keyed "x,y" — sparse, because a 128x128 array of zeroes is a hash of
  // nothing. Absent until the first step anybody takes.
  traffic?: Record<string, number>
  // The day each standing trail went quiet; absent while every trail is still in use.
  quietSince?: Record<string, number>
  // The herd, the warren and the schools. Absent until the genesis scatter or the first dawn
  // that spawns one, and absent again when the last body is taken.
  fauna?: Record<string, Fauna>
  counters: { nextEntityId: number }
}

export function genesisState(config: SimConfig, terrain?: TileId[][]): WorldState {
  return {
    tick: 0,
    terrain: terrain ?? Array.from({ length: 32 }, () => Array.from({ length: 32 }, (): TileId => 0)),
    weather: { kind: 'sunny', temperatureC: config.weather.seasonTemps.spring },
    agents: {},
    structures: {},
    items: {},
    crops: {},
    wildlife: { fish: config.wildlife.fishMax, deer: config.wildlife.deerMax },
    counters: { nextEntityId: 1 },
  }
}

// The one reader of the field (G4). A body that has never been thirsty is a full one, which
// is what lets every pre-C11 log fold to the hash it always had.
export function thirstOf(a: { thirst?: number }): number {
  return a.thirst ?? 100
}

export function mintId(state: WorldState, prefix: string): string {
  return `${prefix}_${state.counters.nextEntityId}`
}
