import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { EventStore, openDb } from '@sj/engine/store'
import { fold, genesisState, RngStreams, TickLoop } from '@sj/engine'
import { SimConfigSchema, type SimEvent, type TileId } from '@sj/shared'
import { openAgentDb } from '../memory/schema.js'
import { TieStore } from '../memory/ties.js'
import { EngineBridge } from '../runtime/bridge.js'
import { SceneCoordinator, type SceneMind } from './coordinator.js'
import type { SceneAsk, SceneClose, SceneLlm, SceneTurn, TieDelta } from './scene.js'
import { sceneBlock } from './sceneLlm.js'

const NADIA = 'nadia'
const OMAR = 'omar'
const MIRA = 'mira'
const NOON = 12 * 60

const QUIET: SceneTurn = {
  thought: 'A new face.',
  speech: 'You have come a long way.',
  to: null,
  gesture: null,
  move: 'none',
  stance: null,
  answer: null,
  ask: null,
  leave: false,
  importance: 5,
}

class Silent implements SceneLlm {
  async line(): Promise<SceneTurn> {
    return QUIET
  }
  async close(): Promise<SceneClose> {
    return { summary: '', deltas: [] }
  }
}

type Who = { id: string; name: string; x: number; road?: true }

function town(who: readonly Who[], ties: Record<string, TieDelta[]> = {}) {
  const config = SimConfigSchema.parse({
    needs: { hungerDecayPerTick: 0 },
    warmth: { enabled: false },
  })
  const terrain: TileId[][] = Array.from({ length: 24 }, () =>
    Array.from({ length: 24 }, (): TileId => 0),
  )
  const engineDb = openDb(':memory:')
  const store = new EventStore(engineDb)
  let state = genesisState(config, terrain)
  const emit = (type: string, payload: unknown): void => {
    state = fold(state, store.append(state.tick, type, payload), config)
  }
  for (const w of who) {
    if (w.road === true) {
      emit('agent_arrived', { id: w.id, name: w.name, sex: 'f', ageDays: 868, x: w.x, y: 3 })
    } else {
      emit('agent_spawned', { id: w.id, name: w.name, x: w.x, y: 3, ageDays: 9000 })
    }
  }
  let queued: { type: string; payload: unknown }[] = []
  const loop = new TickLoop({
    store,
    state,
    rng: new RngStreams('telling'),
    config,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  const handler = bridge.wrapTickHandler(({ emit: put }) => {
    for (const q of queued) put(q.type, q.payload)
    queued = []
  })
  const dbs = new Map<string, Database.Database>()
  const remembered: { agentId: string; text: string; importance: number }[] = []
  const minds = new Map<string, SceneMind>()
  for (const w of who) {
    const db = openAgentDb(':memory:')
    dbs.set(w.id, db)
    const store2 = new TieStore(db, w.id)
    store2.apply(ties[w.id] ?? [], 0)
    minds.set(w.id, {
      llm: new Silent(),
      ties: store2,
      remember: async (m) => {
        remembered.push({ agentId: w.id, text: m.text, importance: m.importance })
      },
      warmth: () => 0,
    })
  }
  const build = (): SceneCoordinator =>
    new SceneCoordinator({
      bridge,
      mindFor: (id) => minds.get(id) ?? null,
      everyone: () => who.map((w) => w.id),
    })
  return {
    bridge,
    build,
    coordinator: build(),
    remembered,
    engineDb,
    emitNext: (type: string, payload: unknown) => queued.push({ type, payload }),
    step: () => {
      loop.step()
    },
    opened: (): SimEvent[] =>
      store.readTypeFrom(0, 'scene_opened').map((e) => ({ ...e, payload: e.payload })),
  }
}

describe('★ the first talk a stranger stands in', () => {
  const who: Who[] = [
    { id: NADIA, name: 'Nadia', x: 3 },
    { id: MIRA, name: 'Mira', x: 4, road: true },
  ]

  it('knows who the town has not met, off the log alone', () => {
    expect(town(who).coordinator.strangers()).toEqual([MIRA])
  })

  it('opens as a telling, with the stranger named and the stakes raised', () => {
    const t = town(who)
    const scene = t.coordinator.noteSpoken(NADIA, 'Who are you, then?', NOON)!
    expect(scene.kind).toBe('telling')
    expect(scene.stranger).toBe(MIRA)
    expect(scene.stakes).toBeGreaterThanOrEqual(6)
    t.step()
    const announced = t.opened().at(-1)!.payload as { kind: string }
    expect(announced.kind).toBe('telling')
  })

  it('is the only one: once the town has met them, an ordinary talk is ordinary', async () => {
    const t = town(who)
    const first = t.coordinator.noteSpoken(NADIA, 'Who are you, then?', NOON)!
    expect(first.kind).toBe('telling')
    t.coordinator.leave(MIRA, NOON + 60)
    await Promise.resolve()
    expect(t.coordinator.strangers()).toEqual([])
    const second = t.coordinator.noteSpoken(NADIA, 'Fine morning.', NOON + 120)!
    expect(second.kind).toBe('talk')
    expect(second.stranger).toBeUndefined()
  })

  it('is rebuilt from the log by a coordinator that has just booted', () => {
    const t = town(who)
    const scene = t.coordinator.noteSpoken(NADIA, 'Who are you, then?', NOON)!
    expect(scene.kind).toBe('telling')
    t.step()
    // A restart over the same log: the talk is in it, so the stranger is nobody's news now.
    expect(t.build().strangers()).toEqual([])
  })

  it('says the thing to both sides, and never in the same words', () => {
    const t = town(who)
    const scene = t.coordinator.noteSpoken(NADIA, 'Who are you, then?', NOON)!
    const ask = (agentId: string): SceneAsk => ({
      scene,
      agentId,
      cast: [
        { id: NADIA, name: 'Nadia' },
        { id: MIRA, name: 'Mira' },
      ],
      audience: [],
      ties: [],
      thread: scene.thread,
      recent: [],
      wrapUp: false,
      tick: NOON,
      energy: 90,
    })
    const voice = { livingCast: () => [], words: 30, usual: 15 }
    expect(sceneBlock(ask(MIRA), voice)).toContain('Nobody here knows you yet')
    const theirs = sceneBlock(ask(NADIA), voice)
    expect(theirs).toContain('Mira just came up the valley road and nobody here knows them')
    expect(theirs).not.toContain('Nobody here knows you yet')
  })
})

describe('★ somebody walks out of the valley', () => {
  const who: Who[] = [
    { id: NADIA, name: 'Nadia', x: 3 },
    { id: OMAR, name: 'Omar', x: 4 },
    { id: MIRA, name: 'Mira', x: 5, road: true },
  ]

  it('is carried away by everyone who held a tie to them, and by nobody else', () => {
    const t = town(who, {
      [NADIA]: [{ agentId: NADIA, personId: MIRA, kind: 'kin', text: 'your partner' }],
      [OMAR]: [{ agentId: OMAR, personId: MIRA, kind: 'debt', text: 'owes you a loaf' }],
    })
    t.emitNext('agent_departed', { agentId: MIRA })
    t.step()
    t.coordinator.onTick(NOON)
    expect(t.remembered).toEqual([
      { agentId: NADIA, text: 'Mira has gone down the valley road.', importance: 9 },
      { agentId: OMAR, text: 'Mira has gone down the valley road.', importance: 6 },
    ])
  })

  it('reaches nobody who never had anything to do with them', () => {
    const t = town(who)
    t.emitNext('agent_departed', { agentId: MIRA })
    t.step()
    t.coordinator.onTick(NOON)
    expect(t.remembered).toEqual([])
  })

  it('takes them off the list of people the town has yet to meet', () => {
    const t = town(who)
    expect(t.coordinator.strangers()).toEqual([MIRA])
    t.emitNext('agent_departed', { agentId: MIRA })
    t.step()
    t.coordinator.onTick(NOON)
    expect(t.coordinator.strangers()).toEqual([])
  })
})
