import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { EventStore, openDb } from '@sj/engine/store'
import { fold, genesisState, replayFromGenesis, RngStreams, TickLoop } from '@sj/engine'
import { SimConfigSchema, stateHash, type SimConfig, type SimEvent, type TileId } from '@sj/shared'
import { SCENE_CORPUS, SCENE_CORPUS_LINES } from '@sj/shared/testutil'
import { EngineBridge } from '../runtime/bridge.js'
import { openAgentDb } from '../memory/schema.js'
import { TieStore } from '../memory/ties.js'
import { SceneCoordinator, type SceneMind } from './coordinator.js'
import {
  FLOOR_TIMEOUT_MS,
  lineCapFor,
  type SceneAsk,
  type SceneClose,
  type SceneLlm,
  type SceneTurn,
  type TieDelta,
} from './scene.js'

const NADIA = 'nadia'
const OMAR = 'omar'
const SALMA = 'salma'
const YUSUF = 'yusuf'
const NOON = 12 * 60
const NIGHT = 22 * 60
const LINE_CAP = lineCapFor(2)

// A recorded answer, dressed in the fields no recording carries.
function fromCorpus(i: number, over: Partial<SceneTurn> = {}): SceneTurn {
  const line = SCENE_CORPUS_LINES[i % SCENE_CORPUS_LINES.length]!
  return {
    thought: line.thought,
    speech: line.speech,
    to: null,
    gesture: null,
    move: line.move,
    stance: null,
    answer: null,
    leave: line.leave,
    importance: line.importance,
    ...over,
  }
}

/** Replays recorded answers and counts who was asked. A scripted entry overrides the replay
 *  where a test needs a silence, a leaving or a stall no recording has. */
class FakeSceneLlm implements SceneLlm {
  readonly asks: SceneAsk[] = []
  closes = 0
  constructor(
    readonly agentId: string,
    readonly calls: Map<string, number>,
    private readonly script: (ask: SceneAsk, nth: number) => SceneTurn | 'stall',
    private readonly closer: () => SceneClose = () => ({ summary: '', deltas: [] }),
  ) {}

  async line(ask: SceneAsk): Promise<SceneTurn> {
    this.calls.set(this.agentId, (this.calls.get(this.agentId) ?? 0) + 1)
    this.asks.push(structuredClone(ask))
    const answer = this.script(ask, this.asks.length - 1)
    if (answer === 'stall') return new Promise<SceneTurn>(() => {})
    return answer
  }

  async close(): Promise<SceneClose> {
    this.closes += 1
    return this.closer()
  }
}

function simConfig(): SimConfig {
  return SimConfigSchema.parse({
    needs: { hungerDecayPerTick: 0 },
    structures: { sleepIndoorsOnly: false },
    warmth: { enabled: false },
  })
}

function buildWorld(who: readonly { id: string; name: string; x: number }[]) {
  const config = simConfig()
  const terrain: TileId[][] = Array.from({ length: 24 }, () =>
    Array.from({ length: 24 }, (): TileId => 0),
  )
  const engineDb = openDb(':memory:')
  const store = new EventStore(engineDb)
  const rng = new RngStreams('scene-test')
  let state = genesisState(config, terrain)
  const emit = (type: string, payload: unknown): void => {
    state = fold(state, store.append(state.tick, type, payload), config)
  }
  for (const w of who) emit('agent_spawned', { id: w.id, name: w.name, x: w.x, y: 3, ageDays: 30 })
  const loop = new TickLoop({
    store,
    state,
    rng,
    config,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  let queued: { type: string; payload: unknown }[] = []
  const handler = bridge.wrapTickHandler(({ emit }) => {
    for (const q of queued) emit(q.type, q.payload)
    queued = []
  })
  const emitNext = (type: string, payload: unknown): void => {
    queued.push({ type, payload })
  }
  return { config, engineDb, store, loop, bridge, terrain, emitNext }
}

type Harness = ReturnType<typeof harness>

function harness(opts: {
  who?: readonly { id: string; name: string; x: number }[]
  script?: (agentId: string) => (ask: SceneAsk, nth: number) => SceneTurn | 'stall'
  closer?: () => SceneClose
  now?: () => number
  ties?: Record<string, TieDelta[]>
}) {
  const who = opts.who ?? [
    { id: NADIA, name: 'Nadia', x: 3 },
    { id: OMAR, name: 'Omar', x: 4 },
  ]
  const world = buildWorld(who)
  const calls = new Map<string, number>()
  const remembered: { agentId: string; text: string; importance: number }[] = []
  const dbs = new Map<string, Database.Database>()
  const llms = new Map<string, FakeSceneLlm>()
  const minds = new Map<string, SceneMind>()
  for (const w of who) {
    const db = openAgentDb(':memory:')
    dbs.set(w.id, db)
    const ties = new TieStore(db, w.id)
    ties.apply(opts.ties?.[w.id] ?? [], 0)
    const llm = new FakeSceneLlm(
      w.id,
      calls,
      opts.script?.(w.id) ?? ((_ask, nth) => fromCorpus(nth, { leave: false })),
      opts.closer,
    )
    llms.set(w.id, llm)
    minds.set(w.id, {
      llm,
      ties,
      remember: async (m) => {
        remembered.push({ agentId: w.id, text: m.text, importance: m.importance })
      },
      warmth: () => 0,
    })
  }
  const coordinator = new SceneCoordinator({
    bridge: world.bridge,
    mindFor: (id) => minds.get(id) ?? null,
    ...(opts.now === undefined ? {} : { now: opts.now }),
  })
  return { ...world, coordinator, calls, remembered, llms, minds, dbs }
}

/** Drive the scene the way the runtimes do: whoever holds the floor asks for a line. */
async function play(h: Harness, tick: number, rounds = LINE_CAP + 4): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    const floor = h.coordinator.open()[0]?.floor
    if (floor === undefined || floor === null) return
    await h.coordinator.takeFloor(floor, tick)
  }
}

const sceneEvents = (db: Database.Database): SimEvent[] =>
  (
    db
      .prepare("SELECT seq, tick, type, payload FROM events WHERE type LIKE 'scene%' ORDER BY seq")
      .all() as { seq: number; tick: number; type: string; payload: string }[]
  ).map((r) => ({
    seq: r.seq,
    tick: r.tick,
    type: r.type,
    payload: JSON.parse(r.payload) as unknown,
  }))

describe('a scene opens on a word somebody heard', () => {
  it('opens on the two who engaged and nobody out of earshot', () => {
    const h = harness({
      who: [
        { id: NADIA, name: 'Nadia', x: 3 },
        { id: OMAR, name: 'Omar', x: 4 },
        { id: SALMA, name: 'Salma', x: 21 },
      ],
    })
    const scene = h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    expect(scene?.participants).toEqual([NADIA, OMAR])
    expect(scene?.audience, 'Salma is a valley away').toEqual([])
    expect(scene?.floor, 'the line addressed Omar').toBe(OMAR)
    expect(scene?.anchor, 'and Nadia opened it').toBe(NADIA)
  })

  it('answers the nearest mind when the word addressed nobody', () => {
    const h = harness({
      who: [
        { id: NADIA, name: 'Nadia', x: 3 },
        { id: OMAR, name: 'Omar', x: 10 },
        { id: SALMA, name: 'Salma', x: 4 },
      ],
    })
    const scene = h.coordinator.noteSpoken(NADIA, 'Is anyone about?', NOON)
    expect(scene?.participants, 'Salma is one pace off and Omar seven').toEqual([NADIA, SALMA])
    expect(scene?.audience).toEqual([OMAR])
  })

  it('does not open a second scene for a mind already in one', () => {
    const h = harness({})
    const scene = h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    expect(h.coordinator.noteSpoken(NADIA, 'Still waiting.', NOON + 1)?.id).toBe(scene?.id)
    expect(h.coordinator.open()).toHaveLength(1)
  })

  it('opens nothing when nobody is near enough to hear', () => {
    const h = harness({
      who: [
        { id: NADIA, name: 'Nadia', x: 3 },
        { id: OMAR, name: 'Omar', x: 21 },
      ],
    })
    expect(h.coordinator.noteSpoken(NADIA, 'Anyone?', NOON)).toBeNull()
  })
})

describe('a scene is who engaged, not who stood nearby', () => {
  const LAYLA = 'layla'
  const TAREK = 'tarek'
  const SQUARE = [
    { id: NADIA, name: 'Nadia', x: 3 },
    { id: OMAR, name: 'Omar', x: 4 },
    { id: SALMA, name: 'Salma', x: 5 },
    { id: YUSUF, name: 'Yusuf', x: 6 },
    { id: LAYLA, name: 'Layla', x: 7 },
    { id: TAREK, name: 'Tarek', x: 8 },
  ]
  // Nothing in these lines addresses anybody, so nobody is pulled off the audience by accident.
  const plain = () => (_a: SceneAsk, n: number) =>
    fromCorpus(0, { speech: `Line number ${n}.`, leave: false })

  it('opens two out of six and leaves four listening', () => {
    const h = harness({ who: SQUARE, script: plain })
    const scene = h.coordinator.noteSpoken(NADIA, 'Good morning.', NOON)!
    expect(scene.participants, 'a good morning is not a summons').toHaveLength(2)
    expect(scene.audience).toEqual([LAYLA, SALMA, TAREK, YUSUF])
  })

  it('never grows one scene of six out of a full square', async () => {
    const h = harness({ who: SQUARE, script: plain })
    h.coordinator.noteSpoken(NADIA, 'Good morning.', NOON)
    let widest = 0
    for (let i = 0; i < LINE_CAP + 4; i++) {
      const scene = h.coordinator.open()[0]
      if (scene?.floor === undefined || scene.floor === null) break
      widest = Math.max(widest, scene.participants.length)
      await h.coordinator.takeFloor(scene.floor, NOON + i)
    }
    expect(widest, 'two to four, never the whole square').toBeLessThanOrEqual(4)
  })

  it('leaves an audience member taking ordinary turns, and pays them a memory at close', async () => {
    const h = harness({
      who: SQUARE,
      script: () => () => fromCorpus(0, { speech: null }),
      closer: () => ({ summary: 'Nadia and Omar counted the planks.', deltas: [] }),
    })
    h.coordinator.noteSpoken(NADIA, 'Good morning.', NOON)
    for (const id of [SALMA, YUSUF, LAYLA, TAREK]) {
      expect(h.coordinator.sceneFor(id), `${id} is free to take its own turn`).toBeNull()
    }
    await play(h, NOON)
    expect(h.remembered.map((r) => r.agentId).sort(), 'the town can gossip about it').toEqual(
      [LAYLA, NADIA, OMAR, SALMA, TAREK, YUSUF].sort(),
    )
    expect(
      h.minds.get(SALMA)!.ties.open(),
      'overhearing makes no promise and owes no debt',
    ).toHaveLength(0)
  })

  it('makes a word said inside an open scene a line of that scene', () => {
    const h = harness({ who: SQUARE, script: plain })
    const scene = h.coordinator.noteSpoken(NADIA, 'Good morning.', NOON)!
    const joined = h.coordinator.noteSpoken(SALMA, 'The well is dry again.', NOON + 1)
    expect(joined?.id, 'no second scene opened over the top of it').toBe(scene.id)
    expect(h.coordinator.open(), 'still one talk on this square').toHaveLength(1)
    expect(scene.participants).toContain(SALMA)
    expect(scene.audience).not.toContain(SALMA)
    expect(scene.thread.map((l) => l.presence)).toEqual([undefined, 'joined', undefined])
  })

  it('draws a bystander in when the floor-holder names one', async () => {
    const h = harness({
      who: SQUARE,
      script: () => (_a, n) =>
        fromCorpus(0, { speech: `Salma, you saw it.`, to: null, leave: n > 0 }),
    })
    const scene = h.coordinator.noteSpoken(NADIA, 'Good morning.', NOON)!
    await h.coordinator.takeFloor(scene.floor!, NOON)
    expect(scene.participants, 'named, so she is in it').toContain(SALMA)
    expect(scene.floor, 'and the floor is hers').toBe(SALMA)
  })
})

describe('only the floor-holder pays', () => {
  it('never asks a listener for a line', async () => {
    const h = harness({
      who: [
        { id: NADIA, name: 'Nadia', x: 3 },
        { id: OMAR, name: 'Omar', x: 4 },
        { id: SALMA, name: 'Salma', x: 5 },
      ],
    })
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    let listenersAsked = 0
    for (let i = 0; i < 6; i++) {
      const holder = h.coordinator.open()[0]?.floor
      if (holder === undefined || holder === null) break
      const before = new Map(h.calls)
      await h.coordinator.takeFloor(holder, NOON + i)
      for (const id of [NADIA, OMAR, SALMA]) {
        if (id === holder) continue
        if ((h.calls.get(id) ?? 0) !== (before.get(id) ?? 0)) listenersAsked += 1
      }
    }
    expect(listenersAsked, 'a listener hears for free').toBe(0)
    expect([...h.calls.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
  })

  it('refuses a mind that does not hold the floor', async () => {
    const h = harness({})
    const scene = h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)!
    const notTheFloor = scene.participants.find((id) => id !== scene.floor)!
    await h.coordinator.takeFloor(notTheFloor, NOON)
    expect(h.calls.get(notTheFloor) ?? 0).toBe(0)
  })
})

describe('every way a scene ends', () => {
  const silent = (): SceneTurn => fromCorpus(0, { speech: null, leave: false })

  it('a pass hands the floor back to the anchor, and the anchor’s own pass ends it', async () => {
    const h = harness({ script: () => () => silent() })
    const scene = h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)!
    await h.coordinator.takeFloor(scene.floor!, NOON)
    expect(h.coordinator.open()[0]?.passes, 'one silence is not an ending').toBe(1)
    expect(h.coordinator.open()[0]?.floor, 'it goes back to whoever opened it').toBe(NADIA)
    await h.coordinator.takeFloor(NADIA, NOON + 1)
    expect(h.coordinator.open()).toHaveLength(0)
    expect(closeReasonOf(h)).toBe('ended')
  })

  it('closes rather than loops when the anchor is already holding the floor', async () => {
    const h = harness({ script: () => () => silent() })
    const scene = h.coordinator.noteSpoken(NADIA, 'Anyone about?', NOON)!
    scene.floor = scene.anchor
    await h.coordinator.takeFloor(NADIA, NOON)
    expect(h.coordinator.open()).toHaveLength(0)
    expect(closeReasonOf(h)).toBe('ended')
  })

  it('a leaving ends it', async () => {
    const h = harness({ script: () => (_a, n) => fromCorpus(n, { leave: true }) })
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    await play(h, NOON)
    expect(closeReasonOf(h)).toBe('left')
  })

  it('walking out of earshot ends it once nobody is left', async () => {
    const h = harness({})
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    expect(h.coordinator.open()).toHaveLength(1)
    h.emitNext('agent_moved', { id: OMAR, x: 21, y: 3 })
    h.loop.step()
    h.coordinator.onTick(NOON)
    await flush()
    expect(h.coordinator.open()).toHaveLength(0)
    expect(closeReasonOf(h)).toBe('left')
  })

  it('somebody going to bed ends it', async () => {
    const h = harness({})
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NIGHT)
    h.emitNext('agent_slept', { agentId: OMAR })
    h.loop.step()
    h.coordinator.onTick(NIGHT + 1)
    await flush()
    expect(h.coordinator.open()).toHaveLength(0)
    expect(closeReasonOf(h)).toBe('left')
  })

  it('the body walking a mind out of the talk ends it when two were talking', async () => {
    const h = harness({})
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NIGHT)
    h.coordinator.leave(OMAR, NIGHT + 1)
    await flush()
    expect(h.coordinator.open()).toHaveLength(0)
    expect(closeReasonOf(h)).toBe('left')
  })

  // One body's alarm is that body's business. Above two it drops the one and the rest talk on.
  it('drops one mind rather than closing a talk that still has enough mouths', async () => {
    const h = harness({
      who: [
        { id: NADIA, name: 'Nadia', x: 3 },
        { id: OMAR, name: 'Omar', x: 4 },
        { id: SALMA, name: 'Salma', x: 5 },
      ],
      script: () => (_a, n) => fromCorpus(0, { speech: `Line ${n}.`, leave: false }),
    })
    const scene = h.coordinator.noteSpoken(NADIA, 'Good morning.', NOON)!
    h.coordinator.noteSpoken(SALMA, 'The well is dry.', NOON + 1)
    expect(scene.participants).toEqual([NADIA, OMAR, SALMA])
    h.coordinator.leave(OMAR, NOON + 2)
    await flush()
    expect(h.coordinator.open(), 'two are left, so the talk goes on').toHaveLength(1)
    expect(scene.participants).toEqual([NADIA, SALMA])
    expect(scene.thread.at(-1)?.presence).toBe('left')
  })

  it('twelve lines cap it, and the tenth is told to wrap up', async () => {
    const h = harness({ script: () => (_a, n) => fromCorpus(n, { leave: false }) })
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    await play(h, NOON)
    expect(closeReasonOf(h)).toBe('capped')
    h.loop.step()
    const said = sceneEvents(h.engineDb).filter((e) => e.type === 'scene_line')
    expect(said, 'the opening word is a line too').toHaveLength(LINE_CAP)
    const asks = [...h.llms.values()]
      .flatMap((l) => l.asks)
      .sort((a, b) => a.scene.thread.length - b.scene.thread.length)
    expect(asks.find((a) => a.scene.thread.length === 8)?.wrapUp, 'the ninth line').toBe(false)
    expect(asks.find((a) => a.scene.thread.length === 9)?.wrapUp, 'the tenth line').toBe(true)
  })

  // An ordinary turn whose provider was still thinking when the scene opened around it comes
  // back with a word, and the world takes it. Only the thread makes it a line anybody reads.
  it('takes a word from a mouth already in a talk as a line of that talk', () => {
    const h = harness({})
    const scene = h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)!
    const again = h.coordinator.noteSpoken(NADIA, 'And a bench for the door.', NOON + 1)

    expect(again?.id, 'the same talk, not a second one').toBe(scene.id)
    expect(scene.thread.map((l) => l.text)).toEqual([
      'Omar. Six planks.',
      'And a bench for the door.',
    ])
  })

  // The floor-holder's runtime may be dozing off a failed provider: it never calls `takeFloor`,
  // so nothing was ever asked and the talk used to stand still for the whole doze.
  it('moves the floor off a mouth that never asks at all', () => {
    let clock = 0
    const h = harness({ now: () => clock })
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    expect(h.coordinator.open()[0]?.floor).toBe(OMAR)

    clock += FLOOR_TIMEOUT_MS
    h.coordinator.onTick(NOON + 1)
    const scene = h.coordinator.open()[0]
    expect(scene?.timeouts).toBe(1)
    expect(scene?.floor, 'the floor went back to the anchor').toBe(NADIA)
    expect(h.calls.get(OMAR) ?? 0, 'and nobody was billed for the silence').toBe(0)
  })

  it('a stall is not a pass, and two of them close it as a timeout', async () => {
    let clock = 0
    const h = harness({ script: () => () => 'stall', now: () => clock })
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    const first = h.coordinator.open()[0]!.floor!
    void h.coordinator.takeFloor(first, NOON)
    clock += FLOOR_TIMEOUT_MS
    h.coordinator.onTick(NOON + 1)
    const scene = h.coordinator.open()[0]
    expect(scene?.passes, 'nobody chose that silence').toBe(0)
    expect(scene?.timeouts).toBe(1)
    expect(scene?.floor, 'the floor went back to the anchor').toBe(NADIA)
    void h.coordinator.takeFloor(scene!.floor!, NOON + 1)
    clock += FLOOR_TIMEOUT_MS
    h.coordinator.onTick(NOON + 2)
    await flush()
    expect(h.coordinator.open()).toHaveLength(0)
    expect(closeReasonOf(h)).toBe('timeout')
    expect(h.calls.get(NADIA), 'and nobody was asked twice for one line').toBe(1)
  })
})

const flush = (): Promise<void> => new Promise((r) => setImmediate(r))

/** Announcements reach the log on the next tick, so a reader steps the loop first. */
function closeReasonOf(h: Harness): string | undefined {
  h.loop.step()
  const ev = sceneEvents(h.engineDb).find((e) => e.type === 'scene_closed')
  return (ev?.payload as { closeReason?: string } | undefined)?.closeReason
}

describe('what a close leaves behind', () => {
  const CLOSE: SceneClose = {
    summary: 'Nadia pressed Omar for the planks. He named a day and she took it.',
    deltas: [
      { agentId: NADIA, personId: OMAR, kind: 'promise', text: 'Planks tomorrow, before noon.' },
      { agentId: OMAR, personId: NADIA, kind: 'debt', text: 'Six planks owed to Nadia.' },
    ],
  }

  it('gives every participant one memory at the scene’s stakes, and each their own tie', async () => {
    const h = harness({
      script: () => () => fromCorpus(0, { speech: null }),
      closer: () => CLOSE,
    })
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    const stakes = h.coordinator.open()[0]!.stakes
    await play(h, NOON)
    expect(h.remembered.map((r) => r.agentId).sort()).toEqual([NADIA, OMAR])
    expect(h.remembered.every((r) => r.text === CLOSE.summary)).toBe(true)
    expect(h.remembered.every((r) => r.importance === stakes)).toBe(true)
    expect(
      h.minds
        .get(NADIA)!
        .ties.open()
        .map((t) => t.kind),
    ).toEqual(['promise'])
    expect(
      h.minds
        .get(OMAR)!
        .ties.open()
        .map((t) => t.kind),
    ).toEqual(['debt'])
  })

  it('writes no tie for a body that only overheard it, and announces none either', async () => {
    const eavesdropper: TieDelta = {
      agentId: SALMA,
      personId: NADIA,
      kind: 'slight',
      text: 'They talked over her.',
    }
    const h = harness({
      who: [
        { id: NADIA, name: 'Nadia', x: 3 },
        { id: OMAR, name: 'Omar', x: 4 },
        { id: SALMA, name: 'Salma', x: 6 },
      ],
      script: () => () => fromCorpus(0, { speech: null }),
      closer: () => ({ ...CLOSE, deltas: [...CLOSE.deltas, eavesdropper] }),
    })
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    expect(h.coordinator.open()[0]!.audience, 'Salma is in earshot and not in it').toContain(SALMA)
    await play(h, NOON)
    h.loop.step()

    expect(h.minds.get(SALMA)!.ties.all(), 'she owes nothing for standing there').toEqual([])
    expect(
      h.remembered.map((r) => r.agentId),
      'she still carries the summary',
    ).toContain(SALMA)
    const announced = sceneEvents(h.engineDb).find((e) => e.type === 'scene_closed')
    expect((announced!.payload as { deltas: TieDelta[] }).deltas.map((d) => d.agentId)).toEqual([
      NADIA,
      OMAR,
    ])
  })

  it('asks for one close and no more, however the scene ended', async () => {
    const h = harness({ script: () => () => fromCorpus(0, { speech: null }), closer: () => CLOSE })
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    await play(h, NOON)
    h.coordinator.onTick(NIGHT)
    expect([...h.llms.values()].reduce((n, l) => n + l.closes, 0)).toBe(1)
  })
})

// A fresh town starts at 00:00. The curfew closed 22 scenes in one rehearsal's first 131 ticks,
// every one of them a line long: the opener opened what the same tick's sweep killed.
describe('the night is a time of day, not an ending', () => {
  it('leaves a scene open through nightfall, and the lines keep coming', async () => {
    const h = harness({ script: () => (_a, n) => fromCorpus(n, { leave: false }) })
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    h.coordinator.onTick(NIGHT)
    await flush()
    expect(h.coordinator.open(), 'the hour closes nothing').toHaveLength(1)
    const before = h.coordinator.open()[0]!.thread.length
    await h.coordinator.takeFloor(h.coordinator.open()[0]!.floor!, NIGHT + 1)
    expect(h.coordinator.open()[0]!.thread.length).toBeGreaterThan(before)
  })

  it('opens a scene after dark, because that is what a late night is', () => {
    const h = harness({})
    expect(h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NIGHT)).not.toBeNull()
  })

  it('opens nothing for a mind whose only listener is in bed', () => {
    const h = harness({})
    h.emitNext('agent_slept', { agentId: OMAR })
    h.loop.step()
    expect(h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NIGHT)).toBeNull()
  })

  it('drops the line of a mouth that went to bed while the provider was thinking', async () => {
    const h = harness({
      who: [
        { id: NADIA, name: 'Nadia', x: 3 },
        { id: OMAR, name: 'Omar', x: 4 },
        { id: SALMA, name: 'Salma', x: 5 },
      ],
    })
    const scene = h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NIGHT)!
    h.coordinator.noteSpoken(SALMA, 'I am here too.', NIGHT)
    const asking = h.coordinator.takeFloor(OMAR, NIGHT)
    h.emitNext('agent_slept', { agentId: OMAR })
    h.loop.step()
    h.coordinator.onTick(NIGHT + 1)
    await asking
    expect(scene.participants, 'a sleeper is nobody in the talk').toEqual([NADIA, SALMA])
    expect(
      scene.thread.filter((l) => l.presence === undefined).map((l) => l.agentId),
      'and said nothing in it',
    ).toEqual([NADIA, SALMA])
  })

  it('tells the floor-holder the hour and what its body has left', async () => {
    const h = harness({})
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NIGHT)
    await h.coordinator.takeFloor(OMAR, NIGHT)
    const ask = h.llms.get(OMAR)!.asks[0]
    expect(ask?.tick).toBe(NIGHT)
    expect(ask?.energy, 'read off the body, not guessed').toBe(
      h.loop.state.agents[OMAR]!.needs.energy,
    )
  })

  it('lets a mind told it is late and tired take the exit it always had', async () => {
    const h = harness({
      // Nobody made them go; they read the hour and the weariness and answered it.
      script: () => (a, n) => fromCorpus(n, { leave: a.tick >= NIGHT && a.energy < 45 }),
    })
    h.emitNext('needs_changed', { id: OMAR, changes: [{ need: 'energy', delta: -80 }] })
    h.emitNext('needs_changed', { id: NADIA, changes: [{ need: 'energy', delta: -80 }] })
    h.loop.step()
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NIGHT)
    await play(h, NIGHT)
    expect(h.coordinator.open()).toHaveLength(0)
    expect(closeReasonOf(h)).toBe('left')
  })

  it('does not push out a tired mind that wants to keep talking', async () => {
    const h = harness({ script: () => (_a, n) => fromCorpus(n, { leave: false }) })
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NIGHT)
    for (let i = 0; i < 4; i++) {
      h.coordinator.onTick(NIGHT + i)
      await flush()
      const floor = h.coordinator.open()[0]?.floor
      expect(floor, `still talking at hour ${22 + i}`).toBeTruthy()
      await h.coordinator.takeFloor(floor!, NIGHT + i)
    }
    expect(h.coordinator.open(), 'the night owls are still at it').toHaveLength(1)
  })
})

describe('a quarrel needs a tie', () => {
  const GRUDGE: TieDelta[] = [
    { agentId: NADIA, personId: OMAR, kind: 'grudge', text: 'He never brought the planks.' },
  ]

  it('stays a talk while no tie exists', () => {
    const h = harness({})
    expect(h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)?.kind).toBe('talk')
  })

  it('is a quarrel once the grudge is in the book', () => {
    const h = harness({ ties: { [NADIA]: GRUDGE } })
    expect(h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)?.kind).toBe('quarrel')
  })

  it('is named by talking ABOUT the person, which the floor would not have counted', () => {
    const slight: TieDelta[] = [
      { agentId: OMAR, personId: NADIA, kind: 'slight', text: 'She counted his work aloud.' },
    ]
    const h = harness({ ties: { [OMAR]: slight } })
    const scene = h.coordinator.noteSpoken(OMAR, 'Nadia said it would be six.', NOON)
    expect(scene?.kind).toBe('quarrel')
    expect(scene?.floor, 'a remark about her is not a question put to her').toBe(NADIA)
  })

  it('stays a talk on the same line once the slight is squared', () => {
    const h = harness({ ties: {} })
    expect(h.coordinator.noteSpoken(OMAR, 'Nadia said it would be six.', NOON)?.kind).toBe('talk')
  })

  it('carries the proposal a council opened on', () => {
    const h = harness({})
    const scene = h.coordinator.noteSpoken(NADIA, 'From now on we draw at dawn.', NOON)
    expect(scene?.kind).toBe('council')
    expect(scene?.proposal).toEqual({
      lawText: 'From now on we draw at dawn.',
      predicate: { kind: 'none' },
    })
  })
})

describe('the log', () => {
  it('replays to the same world, because a scene folds to nothing', async () => {
    const h = harness({ script: () => (_a, n) => fromCorpus(n, { leave: false }) })
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    await play(h, NOON)
    h.loop.step()
    h.loop.step()
    const events = sceneEvents(h.engineDb)
    expect(events.filter((e) => e.type === 'scene_opened')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'scene_line').length).toBeGreaterThan(1)
    expect(events.filter((e) => e.type === 'scene_closed')).toHaveLength(1)
    const replayed = replayFromGenesis(h.store, h.config, h.terrain)
    expect(stateHash(replayed)).toBe(stateHash(h.loop.state))
  })
})

describe('an open scene survives a restore', () => {
  it('comes back once, with its floor and its thread', async () => {
    const h = harness({ script: () => (_a, n) => fromCorpus(n, { leave: false }) })
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    await h.coordinator.takeFloor(h.coordinator.open()[0]!.floor!, NOON)
    const saved = structuredClone(h.coordinator.open()[0]!)
    expect(saved.thread.length).toBe(2)

    const fresh = new SceneCoordinator({
      bridge: h.bridge,
      mindFor: (id) => h.minds.get(id) ?? null,
    })
    // Every participant saved the same scene; the id is derived, so it is adopted once.
    fresh.adopt(structuredClone(saved))
    fresh.adopt(structuredClone(saved))
    expect(fresh.open()).toHaveLength(1)
    const back = fresh.open()[0]!
    expect(back.id).toBe(saved.id)
    expect(back.floor).toBe(saved.floor)
    expect(back.thread).toEqual(saved.thread)
    expect(back.kind).toBe(saved.kind)
    await fresh.takeFloor(back.floor!, NOON + 1)
    expect(fresh.open()[0]?.thread.length ?? 0).toBe(3)
  })

  it('adopts nothing from a scene that had already closed', () => {
    const h = harness({})
    const scene = h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)!
    const fresh = new SceneCoordinator({ bridge: h.bridge, mindFor: () => null })
    fresh.adopt({ ...structuredClone(scene), closedTick: NOON + 5, closeReason: 'ended' })
    expect(fresh.open()).toHaveLength(0)
  })
})

describe('the corpus', () => {
  it('is what the fake replays — not answers an author wrote', () => {
    expect(SCENE_CORPUS.length).toBeGreaterThan(0)
    expect(SCENE_CORPUS_LINES.some((l) => l.leave)).toBe(true)
    expect(new Set(SCENE_CORPUS_LINES.map((l) => l.move)).size).toBeGreaterThan(1)
  })
})
