import { DEFAULT_CONFIG, simTimeFromTick } from '@sj/shared'
import { type EventStore } from '@sj/engine/store'
import {
  createWorldTick,
  RngStreams,
  TickLoop,
  type LawQueue,
  type TickHandler,
  type WorldState,
} from '@sj/engine'
import { EngineBridge } from '../runtime/bridge.js'
import type { PersonalityDoc } from '../personality.js'
import type { ScoredMemory } from '../memory/retrieve.js'
import type { IdentityCore, PromptBlocks } from '../prompt/assemble.js'
import type { PerceptionPacket } from '../prompt/prose.js'
import { RULES_OF_BEING } from '../prompt/rulesOfBeing.js'

export const tamarIdentity: IdentityCore = {
  name: 'Tamar',
  age: 34,
  backstory: 'Raised by the miller, I took to the road after the flood and never looked back.',
  temperament: 'steadfast and quietly stubborn',
  voiceCard: {
    register: 'low and unhurried',
    rhythm: 'short sentences, long pauses',
    tics: ['takes a beat before she answers', 'reaches for the river to explain a thing'],
    neverSays: ['I give up', 'hurry along now'],
    exampleLines: ['The grain can wait a little longer.', 'I will mend it before dark.'],
  },
}

const tamarPersonality: PersonalityDoc = {
  temperament: 'steadfast and quietly stubborn',
  values: ['hard work', 'honesty', 'looking after neighbors'],
  beliefs: ['rain follows the west wind', 'a full barn is a quiet mind'],
  current: {
    mood: 'calm',
    worries: ['the roof will not hold another storm'],
    goals: ['repair the roof', 'walk down to the weir'],
  },
}

export const quietMeadowPacket: PerceptionPacket = {
  time: simTimeFromTick(10 * 60),
  self: {
    body: {
      needs: { hunger: 62, energy: 78, warmth: 71, social: 55 },
      hp: 100,
      injuries: [],
      ill: false,
    },
    x: 12,
    y: 9,
    asleep: false,
    collapsed: false,
    activity: null,
    inventory: [],
  },
  weather: { kind: 'sunny', temperatureC: 18 },
  visible: { agents: [], structures: [], items: [], crops: [] },
  heard: [],
  seen: [],
  feltEvents: [],
}

export const conversationPacket: PerceptionPacket = {
  time: simTimeFromTick(14 * 60),
  self: {
    body: {
      needs: { hunger: 48, energy: 60, warmth: 66, social: 40 },
      hp: 100,
      injuries: [],
      ill: false,
    },
    x: 15,
    y: 10,
    asleep: false,
    collapsed: false,
    activity: 'walk',
    inventory: [],
  },
  weather: { kind: 'cloudy', temperatureC: 14 },
  visible: {
    agents: [
      {
        id: 'nadia',
        name: 'Nadia',
        x: 16,
        y: 10,
        activityVerb: null,
        collapsed: false,
        asleep: false,
      },
    ],
    structures: [],
    items: [],
    crops: [],
  },
  heard: [{ speakerId: 'nadia', name: 'Nadia', text: 'Good to see you.', distance: 2 }],
  seen: [],
  feltEvents: ['rain_started'],
}

function makeMemory(
  id: number,
  text: string,
  importance: number,
  people: string[] = [],
): ScoredMemory {
  return {
    id,
    agentId: 'tamar',
    tick: 100 + id,
    day: 1,
    kind: 'perception',
    text,
    gist: null,
    importance,
    tags: { people, place: 'meadow', objects: [], topics: ['day'] },
    score: 1 - id * 0.05,
    parts: { tag: 1, bm25: 1, cosine: 1, recency: 1, importance: importance / 10 },
  }
}

export function fixtureBlocks(overrides: Partial<PromptBlocks> = {}): PromptBlocks {
  const memories: ScoredMemory[] = [
    makeMemory(1, 'The well water ran clear this morning.', 6),
    makeMemory(2, 'Nadia waved from across the field.', 5, ['Nadia']),
    makeMemory(3, 'A heron stood still in the shallows.', 4),
    makeMemory(4, 'The roof creaked under the wind.', 7),
    makeMemory(5, 'I traded two planks for a sack of flour.', 8),
    makeMemory(6, 'The fire in the stove burned low and warm.', 5),
    makeMemory(7, 'Footprints crossed the far path before dawn.', 6),
    makeMemory(8, 'The plum tree has begun to flower.', 4),
  ]
  const base: PromptBlocks = {
    rulesOfBeing: RULES_OF_BEING,
    identity: tamarIdentity,
    personality: {
      doc: tamarPersonality,
      autobiography: [
        'I left the mill after the flood and found the valley.',
        'I have kept bees since my first spring here.',
      ],
    },
    journal: [],
    recalled: null,
    scene: {
      ledgers: [{ name: 'Nadia', doc: 'The basket weaver; she shares her bread with me. [mem#2]' }],
      memories,
    },
    dayLog: ['Woke with the light.', 'Drew water and fed the hens.', 'Sat a while by the gate.'],
    now: { prose: 'The sun is high and the meadow is quiet.' },
  }
  return { ...base, ...overrides }
}

// Flat, foodless, waterless: every horizon a perception test reads is a distance and nothing else.
export const FLAT_WORLD = {
  isWalkable: () => true,
  isEdible: () => false,
  waterAtHand: () => false,
  nearestWater: () => null,
  nearestFood: () => null,
}

/** The real world tick, loop and bridge, so a prose test reads packets the runtime would produce. */
export function wireTown(opts: {
  state: WorldState
  store: EventStore
  seed: string
  startTick: number
}): { bridge: EngineBridge; loop: TickLoop } {
  const rng = new RngStreams(opts.seed)
  const lawQueue: LawQueue = []
  const worldTick = createWorldTick(DEFAULT_CONFIG, rng, lawQueue)
  // Replaced below, once the bridge that wraps it exists.
  let handler: TickHandler = () => undefined
  const loop = new TickLoop({
    store: opts.store,
    state: opts.state,
    rng,
    config: DEFAULT_CONFIG,
    startTick: opts.startTick,
    realMsPerTick: 0,
    onTick: (c) => {
      handler(c)
    },
  })
  const bridge = new EngineBridge({ loop, store: opts.store, simConfig: DEFAULT_CONFIG })
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
  })
  return { bridge, loop }
}
