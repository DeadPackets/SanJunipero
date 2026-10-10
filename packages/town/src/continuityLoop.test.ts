import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AgentRuntime,
  EngineBridge,
  MemoryStore,
  openAgentDb,
  PersonalityStore,
  type RuntimeSnapshot,
  retrieveAmbient,
  SceneCoordinator,
  type SceneMind,
  TieStore,
} from '@sj/agents'
import {
  createWorldTick,
  fold,
  genesisState,
  RngStreams,
  replayFromGenesis,
  type TickHandler,
  TickLoop,
} from '@sj/engine'
import { EventStore, openDb } from '@sj/engine/store'
import { LlmClient, migrateLlmTables } from '@sj/llm'
import { FakeEmbedder, mockModel } from '@sj/llm/testutil'
import { ADULT_AGE_DAYS, MINUTES_PER_DAY, NO_PARAMS, SimConfigSchema, stateHash } from '@sj/shared'
import { describe, expect, it } from 'vitest'
import { makeSceneRelay, scenesAt } from '../../gateway/src/scenes.js'

const TAGS = { people: [], place: null, objects: [], topics: [] }
const IDENTITY = {
  name: 'Tamar',
  age: 30,
  temperament: 'patient',
  backstory: 'A baker from the river.',
  voiceCard: { register: 'plain', rhythm: 'short', tics: [], neverSays: [], exampleLines: [] },
}
const DOC = {
  temperament: 'patient',
  values: ['keep agreements'],
  beliefs: [],
  current: { mood: 'steady', worries: [], goals: ['bring Yusuf the bread'] },
}
const CFG = SimConfigSchema.parse({
  needs: { hungerDecayPerTick: 0, energyDecayAwakePerTick: 0 },
  warmth: { enabled: false },
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  aging: { deathOfOldAgeEnabled: false },
})
const TERRAIN = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => 0 as const))
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

async function until(loop: TickLoop, predicate: () => boolean, limit = 200) {
  for (let i = 0; !predicate() && i < limit; i++) {
    loop.step()
    await flush()
  }
  expect(predicate()).toBe(true)
}

describe('one local intention-to-consequence loop', () => {
  it('keeps one chosen obligation through interruption, midnight, reconnect and restart', async () => {
    const config = CFG
    const dir = mkdtempSync(join(tmpdir(), 'sj-continuity-'))
    let db = openDb(join(dir, 'world.db'))
    let store = new EventStore(db)
    let mindDb = openAgentDb(join(dir, 'tamar.db'))
    const otherDb = openAgentDb(':memory:')
    const embedder = await FakeEmbedder.create()
    migrateLlmTables(mindDb)
    let state = genesisState(config, TERRAIN)
    const seed = (type: string, payload: unknown, tick = 1438) => {
      state = fold(state, store.append(tick, type, payload), config)
    }
    seed('tick_advanced', {})
    seed('agent_spawned', { id: 'tamar', name: 'Tamar', x: 3, y: 3, ageDays: ADULT_AGE_DAYS })
    seed('agent_spawned', { id: 'yusuf', name: 'Yusuf', x: 4, y: 3, ageDays: ADULT_AGE_DAYS })
    seed('item_spawned', {
      id: 'loaf',
      kind: 'bread',
      qty: 1,
      owner: 'tamar',
      loc: { t: 'agent', id: 'tamar' },
    })
    seed('needs_changed', { id: 'tamar', changes: [{ need: 'hunger', delta: -50 }] })
    seed('item_spawned', {
      id: 'breakfast',
      kind: 'bread',
      qty: 1,
      owner: 'tamar',
      loc: { t: 'agent', id: 'tamar' },
    })
    seed('item_spawned', {
      id: 'wood',
      kind: 'wood',
      qty: 2,
      owner: 'tamar',
      loc: { t: 'agent', id: 'tamar' },
    })
    const personality = new PersonalityStore(mindDb, 'tamar')
    personality.init(DOC, 0)
    const response = {
      json: {
        thought: 'I pause to consider what happened.',
        importance: 4,
        speech: null,
        mood: null,
        journal: null,
        recall: null,
        reconsider_at: null,
        action: { verb: 'wait', params: NO_PARAMS, freeform: null },
        plan: null,
      },
    }
    const prompts: string[] = []
    let changedPriority = false
    const model = mockModel([])
    model.doGenerate = async (options) => {
      const prompt = JSON.stringify(options.prompt)
      prompts.push(prompt)
      const interrupted = !changedPriority && prompt.includes('Last turn: you stopped')
      if (interrupted) changedPriority = true
      const json = interrupted
        ? {
            ...response.json,
            thought:
              'The unfinished plank can wait. I need breakfast before delivering Yusuf’s loaf.',
            action: {
              verb: 'eat',
              params: { ...NO_PARAMS, itemId: 'breakfast' },
              freeform: null,
            },
            plan: [
              { verb: 'walk', params: { ...NO_PARAMS, x: 8, y: 3 } },
              { verb: 'give', params: { ...NO_PARAMS, itemId: 'loaf', targetId: 'yusuf' } },
            ],
          }
        : response.json
      return {
        content: [{ type: 'text', text: JSON.stringify(json) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: undefined },
          outputTokens: { total: 0, text: 0, reasoning: 0 },
        },
        warnings: [],
      }
    }
    let runtime: AgentRuntime
    let loop: TickLoop
    let bridge: EngineBridge
    let memory: MemoryStore
    let ties: TieStore
    let coordinator: SceneCoordinator
    const SECRET = 'I privately fear being forgotten.'
    const closeInputs: string[] = []
    const boot = (saved?: RuntimeSnapshot) => {
      let handler: TickHandler = () => {}
      const rng = new RngStreams('continuity')
      loop = new TickLoop({
        store,
        state,
        rng,
        config,
        onTick: (ctx) => {
          handler(ctx)
        },
      })
      bridge = new EngineBridge({ loop, store, simConfig: config })
      const worldTick = createWorldTick(config, rng)
      handler = bridge.wrapTickHandler(({ emit }) => {
        for (const ev of worldTick(loop.state).events) emit(ev.type, ev.payload)
      })
      ties = new TieStore(mindDb, 'tamar')
      memory = new MemoryStore(mindDb, 'tamar', embedder)
      const minds = new Map<string, SceneMind>()
      for (const id of ['tamar', 'yusuf'])
        minds.set(id, {
          ties: id === 'tamar' ? ties : new TieStore(otherDb, id),
          warmth: () => 0,
          remember: async (m) => {
            const mem = id === 'tamar' ? memory : new MemoryStore(otherDb, id, embedder)
            await mem.insertMemory({ ...m, kind: 'speech_heard', tags: TAGS })
          },
          commitSceneExit: (choice, tick) => {
            if (id === 'tamar') runtime.commitSceneExit(choice, tick)
          },
          llm: {
            line: async () => ({
              thought: SECRET,
              speech:
                id === 'yusuf'
                  ? 'Yes, bring the loaf. We can mend the bench another day.'
                  : 'I will bring it now.',
              to: null,
              gesture: null,
              move: 'none',
              stance: null,
              answer: null,
              ask: null,
              reconvene: null,
              leave: id === 'tamar',
              importance: 5,
              mood: null,
              reconsider_at: null,
              plan:
                id === 'tamar'
                  ? [
                      { verb: 'craft', params: { recipe: 'plank' } },
                      { verb: 'walk', params: { x: 8, y: 3 } },
                      { verb: 'give', params: { itemId: 'loaf', targetId: 'yusuf' } },
                    ]
                  : null,
            }),
            close: async (ask) => {
              closeInputs.push(JSON.stringify(ask))
              return {
                summary: 'Tamar agreed to bring Yusuf a loaf; the bench can wait.',
                deltas: [
                  {
                    agentId: 'tamar',
                    personId: 'yusuf',
                    kind: 'promise',
                    text: 'Bring Yusuf the loaf.',
                  },
                  {
                    agentId: 'tamar',
                    personId: 'yusuf',
                    kind: 'promise',
                    text: 'Mend the bench with Yusuf another day.',
                  },
                ],
              }
            },
          },
        })
      coordinator = new SceneCoordinator({ bridge, mindFor: (id) => minds.get(id) ?? null })
      runtime = new AgentRuntime({
        db: mindDb,
        llm: new LlmClient({ model, db: mindDb, caller: 'turn', agentId: 'tamar', maxRetries: 0 }),
        embedder,
        identity: IDENTITY,
        personality: new PersonalityStore(mindDb, 'tamar'),
        bridge,
        scenes: coordinator,
        ties: { store: ties, cast: () => [{ id: 'yusuf', name: 'Yusuf' }] },
        config: {
          idleGapTicks: 100,
          boredomTicks: 100,
          bodyAlarm: { hunger: 40, energy: 0, warmth: 0, thirst: 0, affliction: Infinity },
        },
      })
      runtime.start('tamar')
      if (saved) runtime.restore(saved)
    }
    try {
      boot()
      const scene = coordinator!.noteSpoken(
        'tamar',
        'Yusuf, shall I bring the loaf and help mend your bench?',
        loop!.tick,
      )!
      expect(scene).not.toBeNull()
      bridge!.flushAnnouncements()
      await coordinator!.takeFloor('yusuf', loop!.tick)
      bridge!.flushAnnouncements()
      const connected = makeSceneRelay()
      connected.fold(store.readFrom(0))
      const reconnect = scenesAt(db, loop!.tick)
      expect(reconnect.snapshot()).toEqual(connected.snapshot())
      expect(reconnect.transcripts(loop!.tick)).toEqual(connected.transcripts(loop!.tick))
      expect(JSON.stringify(reconnect.transcripts(loop!.tick))).not.toContain(SECRET)
      await coordinator!.takeFloor('tamar', loop!.tick)
      await flush()
      bridge!.flushAnnouncements()
      expect(closeInputs).toHaveLength(1)
      expect(closeInputs[0]).not.toContain(SECRET)
      expect(ties!.open()).toHaveLength(2)
      loop!.commitEvents([{ type: 'agent_moved', payload: { id: 'yusuf', x: 9, y: 3 } }])
      await until(loop!, () => loop!.state.agents.tamar!.activity?.verb === 'craft')
      loop!.commitEvents([
        {
          type: 'needs_changed',
          payload: { id: 'tamar', changes: [{ need: 'hunger', delta: -15 }] },
        },
      ])
      await until(loop!, () => loop!.state.agents.tamar!.activity?.verb === 'walk')
      loop!.commitEvents([{ type: 'agent_moved', payload: { id: 'yusuf', x: 11, y: 3 } }])
      const saved = runtime!.snapshot()
      const before = stateHash(loop!.state)
      runtime!.stop()
      state = replayFromGenesis(store, config, TERRAIN)
      expect(stateHash(state)).toBe(before)
      store.close()
      db.close()
      mindDb.close()
      db = openDb(join(dir, 'world.db'))
      store = new EventStore(db)
      mindDb = openAgentDb(join(dir, 'tamar.db'))
      boot(saved)
      expect(loop!.state.agents.yusuf!.x).toBe(11)
      expect(scenesAt(db, loop!.tick).snapshot()).toEqual([])
      await until(loop!, () => loop!.state.items.loaf!.owner === 'yusuf')
      await until(loop!, () => prompts.some((text) => text.includes('You have given')))
      expect(loop!.tick).toBeGreaterThan(MINUTES_PER_DAY)
      expect(loop!.state.agents.yusuf!.x).toBe(11)
      expect(mindDb.prepare("SELECT text FROM memories WHERE kind = 'action'").all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: 'You have arrived within reach of yusuf.' }),
        ]),
      )
      expect(prompts.at(-1)).toContain('You have given')
      expect(changedPriority).toBe(true)
      expect(store.readTypeFrom(0, 'action_interrupted')).toHaveLength(1)
      expect(
        store
          .readTypeFrom(0, 'action_completed')
          .filter((event) => (event.payload as { verb: string }).verb === 'craft'),
      ).toHaveLength(0)
      expect(
        store
          .readTypeFrom(0, 'action_completed')
          .filter((event) => (event.payload as { verb: string }).verb === 'eat'),
      ).toHaveLength(1)
      expect(loop!.state.items.breakfast).toBeUndefined()
      const moved = store.readFrom(0).filter((ev) => ev.type === 'item_moved')
      expect(moved).toHaveLength(1)
      const starts = store.readFrom(0).filter((ev) => ev.type === 'action_started')
      expect(starts.filter((ev) => (ev.payload as { verb: string }).verb === 'walk')).toHaveLength(
        2,
      )
      expect(starts.filter((ev) => (ev.payload as { verb: string }).verb === 'give')).toHaveLength(
        1,
      )
      const loafPromise = ties!.open().find((tie) => tie.text.includes('loaf'))!
      ties!.apply(
        [
          {
            agentId: 'tamar',
            personId: 'yusuf',
            kind: 'promise',
            text: loafPromise.text,
            tieId: loafPromise.id,
            resolution: 'fulfilled',
            evidenceSeqs: [moved[0]!.seq],
          },
        ],
        loop!.tick,
        'reflection',
      )
      expect(ties!.open().map((tie) => tie.text)).toEqual([
        'Mend the bench with Yusuf another day.',
      ])
      expect(
        db.prepare('SELECT COUNT(*) n FROM events WHERE type = ?').get('scene_closed'),
      ).toEqual({ n: 1 })
      expect(closeInputs).toHaveLength(1)
      expect(mindDb.prepare('SELECT COUNT(*) n FROM llm_calls').get()).toEqual({
        n: prompts.length,
      })
    } finally {
      runtime!.stop()
      store.close()
      db.close()
      mindDb.close()
      otherDb.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('crosses eight simulated days without losing a durable obligation or formative source', async () => {
    const db = openDb(':memory:')
    const store = new EventStore(db)
    const mindDb = openAgentDb(':memory:')
    const embedder = await FakeEmbedder.create()
    const memory = new MemoryStore(mindDb, 'tamar', embedder)
    const ties = new TieStore(mindDb, 'tamar')
    let state = genesisState(CFG, TERRAIN)
    state = fold(
      state,
      store.append(0, 'crop_planted', { id: 'wheat', kind: 'wheat', x: 4, y: 4, plantedDay: 0 }),
      CFG,
    )
    const source = store.append(0, 'agent_spoke', {
      agentId: 'yusuf',
      text: 'My father died beside the river.',
      x: 3,
      y: 3,
    })
    const formativeId = await memory.insertMemory({
      tick: 0,
      kind: 'speech_heard',
      importance: 9,
      text: 'Yusuf said his father died beside the river.',
      tags: { ...TAGS, people: ['Yusuf'], topics: [`event:${source.seq}`] },
    })
    ties.apply(
      [
        {
          agentId: 'tamar',
          personId: 'yusuf',
          kind: 'promise',
          text: 'Mend the bench together.',
          remindAtTick: 9 * MINUTES_PER_DAY,
        },
        { agentId: 'tamar', personId: 'yusuf', kind: 'grudge', text: 'He was late.' },
      ],
      0,
    )
    const promise = ties.open().find((tie) => tie.kind === 'promise')!
    const rng = new RngStreams('eight-day-boundary')
    const tickWorld = createWorldTick(CFG, rng)
    const loop = new TickLoop({
      store,
      state,
      rng,
      config: CFG,
      onTick: ({ emit }) => {
        for (const ev of tickWorld(loop.state).events) emit(ev.type, ev.payload)
      },
    })
    try {
      const through = 8 * MINUTES_PER_DAY + 6 * 60
      while (loop.tick < through) loop.step()
      expect(loop.state.crops.wheat).toMatchObject({
        stage: CFG.crops.wheat!.stages - 1,
        withered: false,
      })
      const faded = ties.letGo(loop.tick)
      expect(faded.map((tie) => tie.kind)).toEqual(['grudge'])
      expect(ties.open()).toEqual([promise])
      expect(ties.nextReminderAfter(loop.tick)).toBe(9 * MINUTES_PER_DAY)
      for (let i = 0; i < 70; i++)
        await memory.insertMemory({
          tick: loop.tick - 80 + i,
          kind: 'speech_heard',
          importance: 3,
          text: `Yusuf spoke about the weather, occasion ${i}.`,
          tags: { ...TAGS, people: ['Yusuf'] },
        })
      const recalled = await retrieveAmbient(
        memory,
        { people: ['Yusuf'], place: null, topics: [] },
        loop.tick,
        8,
      )
      expect(recalled).toHaveLength(8)
      expect(recalled.find((m) => m.id === formativeId)?.text).toContain('his father died')
      expect(
        store.readTypeFrom(0, 'crop_grew').map((ev) => (ev.payload as { stage: number }).stage),
      ).toEqual([1, 2, 3])
      expect(store.readTypeFrom(0, 'promise_broken')).toEqual([])
    } finally {
      store.close()
      db.close()
      mindDb.close()
    }
  })
})
