import type { SimConfig } from '@sj/shared'

// grass, dirt, water, forest, rock, sand, farmland, road
export type TileId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export type AgentBody = {
  id: string; name: string; x: number; y: number; alive: boolean; asleep: boolean
  needs: { hunger: number; energy: number; warmth: number; social: number }
  hp: number; injuries: Array<{ kind: 'minor' | 'serious' | 'grave'; day: number }>
  ill: boolean; ageDays: number
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
}

export type Item = {
  id: string; kind: string; qty: number
  text?: string
  owner?: string                          // absent = unowned; outlives the owner's death
  crafterMark?: string                    // expert crafts only; set once at spawn, never reassigned
  spoilage?: { spawnDay: number; days: number }  // absent = keeps forever
  durability?: number                     // absent = never wears; 0 breaks the thing
  loc: { t: 'tile'; x: number; y: number } | { t: 'agent'; id: string } | { t: 'structure'; id: string }
}


export type Crop = { id: string; kind: string; x: number; y: number; plantedDay: number; stage: number; withered: boolean }

export type WorldState = {
  tick: number
  terrain: TileId[][]                      // [y][x]
  weather: { kind: string; temperatureC: number }
  agents: Record<string, AgentBody>
  structures: Record<string, Structure>
  items: Record<string, Item>
  crops: Record<string, Crop>
  wildlife: { fish: number; deer: number }
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

export function mintId(state: WorldState, prefix: string): string {
  return `${prefix}_${state.counters.nextEntityId}`
}
