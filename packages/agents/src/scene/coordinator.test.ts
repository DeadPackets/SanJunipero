import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { EventStore, openDb } from '@sj/engine/store'
import {
  fold,
  genesisState,
  LAW_TEXT_MAX,
  replayFromGenesis,
  RngStreams,
  TickLoop,
} from '@sj/engine'
import {
  ADULT_AGE_DAYS,
  INVITATION_STANDS_TICKS,
  SimConfigSchema,
  stateHash,
  type SimConfig,
  type SimEvent,
  type TileId,
  MINUTES_PER_DAY,
} from '@sj/shared'
import { SCENE_CORPUS, SCENE_CORPUS_LINES } from '@sj/shared/testutil'
import { EngineBridge } from '../runtime/bridge.js'
import { openAgentDb } from '../memory/schema.js'
import { TieStore } from '../memory/ties.js'
import {
  EARSHOT_GRACE_TICKS,
  WALK_OFF_WINDOW_TICKS,
  TALK_BUDGET_TICKS,
  MAX_COMPILES_PER_DAY,
  SceneCoordinator,
  type SceneMind,
} from './coordinator.js'
import { INVITATION_STAKES } from './invitations.js'
import {
  FLOOR_TIMEOUT_MS,
  lineCapFor,
  type SceneAsk,
  type SceneClose,
  type SceneLlm,
  type SceneTurn,
  type Stance,
  type TieDelta,
} from './scene.js'
import type { LawSeam } from '../runtime/arbiterSeam.js'

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
    ask: null,
    leave: line.leave,
    importance: line.importance,
    ...over,
  }
}

/** Replays recorded answers and counts who was asked. A scripted entry overrides the replay
 *  where a test needs a silence, a leaving or a stall no recording has. */
class FakeSceneLlm implements SceneLlm {
  readonly asks: SceneAsk[] = []
  /** Lines the test hands back by hand, so one can land after the floor has moved off it. */
  readonly held: ((turn: SceneTurn) => void)[] = []
  closes = 0
  constructor(
    readonly agentId: string,
    readonly calls: Map<string, number>,
    private readonly script: (ask: SceneAsk, nth: number) => SceneTurn | 'stall' | 'hold',
    private readonly closer: () => SceneClose = () => ({ summary: '', deltas: [] }),
  ) {}

  async line(ask: SceneAsk): Promise<SceneTurn> {
    this.calls.set(this.agentId, (this.calls.get(this.agentId) ?? 0) + 1)
    this.asks.push(structuredClone(ask))
    const answer = this.script(ask, this.asks.length - 1)
    if (answer === 'stall') return new Promise<SceneTurn>(() => {})
    if (answer === 'hold') return new Promise<SceneTurn>((resolve) => this.held.push(resolve))
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

const HOUSE = 'structure_1'

type Who = { id: string; name: string; x: number; ageDays?: number; inside?: boolean }

function buildWorld(who: readonly Who[], wooed = false) {
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
  emit('structure_planned', {
    id: HOUSE,
    kind: 'house',
    x: 2,
    y: 2,
    w: 4,
    h: 4,
    maxHp: 50,
    flammable: true,
    builderId: NADIA,
    owner: NADIA,
  })
  emit('structure_completed', { id: HOUSE })
  for (const w of who) {
    emit('agent_spawned', { id: w.id, name: w.name, x: w.x, y: 3, ageDays: w.ageDays ?? 30 })
    if (w.inside === true) emit('agent_entered', { agentId: w.id, structureId: HOUSE })
  }
  // Every pair has walked out enough for a proposal where a test asks one: the pace of a
  // courtship is the engine's own test, and these are about what the talk does with an answer.
  if (wooed)
    state = {
      ...state,
      agents: Object.fromEntries(
        Object.values(state.agents).map((a) => [
          a.id,
          {
            ...a,
            walkOuts: Object.fromEntries(who.filter((o) => o.id !== a.id).map((o) => [o.id, 8])),
          },
        ]),
      ),
    }
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
  wooed?: boolean
  who?: readonly Who[]
  script?: (agentId: string) => (ask: SceneAsk, nth: number) => SceneTurn | 'stall' | 'hold'
  closer?: () => SceneClose
  now?: () => number
  ties?: Record<string, TieDelta[]>
  laws?: LawSeam
  onError?: (kind: string, detail: string) => void
}) {
  const who = opts.who ?? [
    { id: NADIA, name: 'Nadia', x: 3 },
    { id: OMAR, name: 'Omar', x: 4 },
  ]
  const world = buildWorld(who, opts.wooed === true)
  const calls = new Map<string, number>()
  const remembered: { agentId: string; text: string; importance: number }[] = []
  const fed: { agentId: string; occasion: string }[] = []
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
      feed: (occasions) => {
        for (const o of occasions) fed.push({ agentId: w.id, occasion: o })
      },
    })
  }
  const coordinator = new SceneCoordinator({
    bridge: world.bridge,
    mindFor: (id) => minds.get(id) ?? null,
    ...(opts.now === undefined ? {} : { now: opts.now }),
    ...(opts.laws === undefined ? {} : { laws: opts.laws }),
    ...(opts.onError === undefined ? {} : { onError: opts.onError }),
  })
  return { ...world, coordinator, calls, remembered, fed, llms, minds, dbs }
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

  it('walking out of earshot ends it once nobody is left, after the length of a doorway', async () => {
    const h = harness({})
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    expect(h.coordinator.open()).toHaveLength(1)
    h.emitNext('agent_moved', { id: OMAR, x: 21, y: 3 })
    h.loop.step()
    for (let t = 0; t < EARSHOT_GRACE_TICKS; t++) h.coordinator.onTick(NOON + t)
    await flush()
    expect(h.coordinator.open(), 'a step through a door is not leaving').toHaveLength(1)
    h.coordinator.onTick(NOON + EARSHOT_GRACE_TICKS)
    await flush()
    expect(h.coordinator.open()).toHaveLength(0)
    expect(closeReasonOf(h)).toBe('left')
  })

  it('★ coming back within the doorway’s length is as if nobody left', async () => {
    const h = harness({})
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    h.emitNext('agent_moved', { id: OMAR, x: 21, y: 3 })
    h.loop.step()
    for (let t = 0; t < EARSHOT_GRACE_TICKS - 1; t++) h.coordinator.onTick(NOON + t)
    h.emitNext('agent_moved', { id: OMAR, x: 4, y: 3 })
    h.loop.step()
    for (let t = 0; t < 3 * EARSHOT_GRACE_TICKS; t++)
      h.coordinator.onTick(NOON + EARSHOT_GRACE_TICKS + t)
    await flush()
    expect(h.coordinator.open()).toHaveLength(1)
    expect(h.coordinator.open()[0]!.participants).toEqual([NADIA, OMAR].sort())
  })

  it('★ walking off on purpose is remembered on both sides once the body has gone', async () => {
    const h = harness({})
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    h.coordinator.walkingOff(OMAR, NOON + 1)
    h.coordinator.onTick(NOON + 1)
    await flush()
    expect(h.coordinator.open(), 'the choice alone moves nobody').toHaveLength(1)
    h.emitNext('agent_moved', { id: OMAR, x: 21, y: 3 })
    h.loop.step()
    for (let t = 2; t <= 2 + EARSHOT_GRACE_TICKS; t++) h.coordinator.onTick(NOON + t)
    await flush()
    expect(memoriesOf(h, NADIA)).toContain('Omar walked off while you were still talking.')
    expect(memoriesOf(h, OMAR)).toContain('You walked off from Nadia mid-talk.')
    expect(closeReasonOf(h)).toBe('left')
  })

  it('★ a walk that goes nowhere is not walking off, and the choice is forgotten in time', async () => {
    const h = harness({})
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    h.coordinator.walkingOff(OMAR, NOON + 1)
    for (let t = 1; t <= WALK_OFF_WINDOW_TICKS + 1; t++) h.coordinator.onTick(NOON + t)
    h.emitNext('agent_moved', { id: OMAR, x: 21, y: 3 })
    h.loop.step()
    const gone = NOON + WALK_OFF_WINDOW_TICKS + 2
    for (let t = 0; t <= EARSHOT_GRACE_TICKS; t++) h.coordinator.onTick(gone + t)
    await flush()
    expect(closeReasonOf(h)).toBe('left')
    expect(memoriesOf(h, NADIA)).not.toContain('Omar walked off while you were still talking.')
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

describe('a talk that turns says so, once', () => {
  const GRUDGE: TieDelta[] = [
    { agentId: NADIA, personId: OMAR, kind: 'grudge', text: 'He never brought the planks.' },
  ]

  it('opens a quarrel at what a quarrel is worth, with the open tie counted', () => {
    const h = harness({ ties: { [NADIA]: GRUDGE } })
    const scene = h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    expect(scene?.kind).toBe('quarrel')
    // 7 for the kind, one more for the grudge standing between the two of them
    expect(scene?.stakes).toBe(8)
    h.loop.step()
    const opened = sceneEvents(h.engineDb).find((e) => e.type === 'scene_opened')
    expect((opened!.payload as { stakes: number }).stakes).toBe(8)
    expect(sceneEvents(h.engineDb).filter((e) => e.type === 'scene_turned')).toHaveLength(0)
  })

  it('announces the turn when a talk becomes a council, and never twice for the same fact', async () => {
    const PROPOSAL = 'From now on nobody takes planks without asking.'
    const h = harness({
      who: THREE,
      script: (id) => (_ask, nth) =>
        fromCorpus(nth, { speech: id === OMAR && nth === 0 ? PROPOSAL : 'Mm.', leave: false }),
    })
    h.coordinator.noteSpoken(NADIA, 'The planks again.', NOON)
    await h.coordinator.takeFloor(OMAR, NOON)
    await h.coordinator.takeFloor(NADIA, NOON + 1)
    await h.coordinator.takeFloor(OMAR, NOON + 2)
    h.loop.step()

    const turns = sceneEvents(h.engineDb).filter((e) => e.type === 'scene_turned')
    expect(turns.length, 'one turn, however many lines follow it').toBe(1)
    expect(turns[0]!.payload).toMatchObject({ kind: 'council', stakes: 8 })
    expect(h.coordinator.open()[0]?.stakes).toBe(8)
  })

  it('announces the turn when a third voice joins the talk', async () => {
    const h = harness({
      who: [
        { id: NADIA, name: 'Nadia', x: 3 },
        { id: OMAR, name: 'Omar', x: 4 },
        { id: SALMA, name: 'Salma', x: 5 },
      ],
      script: (id) => (_ask, nth) =>
        fromCorpus(nth, { to: id === OMAR && nth === 0 ? 'Salma' : null, leave: false }),
    })
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    expect(h.coordinator.open()[0]!.audience).toContain(SALMA)
    await h.coordinator.takeFloor(OMAR, NOON)
    h.loop.step()
    const turns = sceneEvents(h.engineDb).filter((e) => e.type === 'scene_turned')
    expect(turns.length).toBeGreaterThan(0)
    expect((turns[turns.length - 1]!.payload as { participants: string[] }).participants).toContain(
      SALMA,
    )
  })

  it('carries the cast on the closing frame, so the paper knows who was in it', async () => {
    const h = harness({})
    h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)
    await play(h, NOON)
    h.loop.step()
    const closed = sceneEvents(h.engineDb).find((e) => e.type === 'scene_closed')
    expect((closed!.payload as { participants: string[] }).participants).toEqual([NADIA, OMAR])
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

  it('carries the proposal a council opened on, and who put it', () => {
    const h = harness({ who: THREE })
    const scene = h.coordinator.noteSpoken(NADIA, 'From now on we draw at dawn.', NOON)
    expect(scene?.kind).toBe('council')
    expect(scene?.proposal).toEqual({
      lawText: 'From now on we draw at dawn.',
      proposedBy: NADIA,
      stances: {},
      predicate: { kind: 'none' },
    })
  })
})

const lawEvents = (db: Database.Database): SimEvent[] =>
  (
    db
      .prepare("SELECT seq, tick, type, payload FROM events WHERE type LIKE 'law_%' ORDER BY seq")
      .all() as { seq: number; tick: number; type: string; payload: string }[]
  ).map((r) => ({
    seq: r.seq,
    tick: r.tick,
    type: r.type,
    payload: JSON.parse(r.payload) as unknown,
  }))

const NIGHT_TAKE = { kind: 'forbid', verb: 'take', when: 'night' } as const
const PROPOSAL = 'From now on nobody takes from the store after dark.'
const READING = {
  predicate: NIGHT_TAKE,
  repeals: null,
  why: 'the store is shut, and the dark is when',
}

/** A court that answers the same way every time, and keeps what it was asked. */
function court(answer: Awaited<ReturnType<LawSeam>> = READING): {
  seam: LawSeam
  asks: Parameters<LawSeam>[0][]
} {
  const asks: Parameters<LawSeam>[0][] = []
  return {
    asks,
    seam: (ask) => {
      asks.push(structuredClone(ask))
      return Promise.resolve(answer)
    },
  }
}

/** A whole council in one call: somebody puts a rule, and whoever answers says where they stand.
 *  The talk closes itself the moment the last of them has. */
async function council(h: Harness, tick: number, said = PROPOSAL): Promise<void> {
  h.coordinator.noteSpoken(NADIA, said, tick)
  for (let i = 0; i < 4; i++) {
    const floor = h.coordinator.open()[0]?.floor
    if (floor === undefined || floor === null) return
    await h.coordinator.takeFloor(floor, tick)
  }
}

/** The next day's first room of three: it votes on whatever the last council tabled. */
async function vote(h: Harness, tick: number): Promise<void> {
  await council(h, tick, 'Morning, all.')
}

/** A whole rule, start to finish: put and tabled one day, voted through the next. */
async function lawPassed(h: Harness, tick: number, said = PROPOSAL): Promise<void> {
  await council(h, tick, said)
  h.loop.step()
  await vote(h, tick + MINUTES_PER_DAY)
  h.loop.step()
}

/** Every mind answers with the stance the test gave it, and says something while it does. */
const stanced =
  (stances: Record<string, Stance | null>, to: Record<string, string> = {}) =>
  (agentId: string) =>
  (): SceneTurn =>
    fromCorpus(0, {
      speech: 'That is where I stand.',
      leave: false,
      stance: stances[agentId] ?? null,
      to: to[agentId] ?? null,
    })

/** A rule needs a room of three; Salma stands in earshot and says where she stands. */
const THREE: readonly Who[] = [
  { id: NADIA, name: 'Nadia', x: 3 },
  { id: OMAR, name: 'Omar', x: 4 },
  { id: SALMA, name: 'Salma', x: 5 },
]

// r13: six hours a day in talks, a fifth of an hour of work. A day has a talk budget; a name,
// an ask, a quarrel or a rule still opens a talk after it is spent.
describe('a day’s talk budget', () => {
  it('★ opens no casual talk for a mind that has talked its fill today, but an addressed one still opens', () => {
    const h = harness({ who: THREE })
    expect(h.coordinator.noteSpoken(NADIA, 'Morning, all.', NOON)).not.toBeNull()
    let t = NOON
    for (let i = 0; i < TALK_BUDGET_TICKS; i++) h.coordinator.onTick(++t)
    h.coordinator.leave(NADIA, t)
    h.coordinator.leave(OMAR, t)
    expect(h.coordinator.open()).toEqual([])

    expect(h.coordinator.noteSpoken(NADIA, 'Nice weather for it.', ++t)).toBeNull()
    // Salma has not talked today, but everyone near her has: nobody answers a remark to the air.
    expect(h.coordinator.noteSpoken(SALMA, 'Anyone seen the bucket?', ++t)).toBeNull()
    const named = h.coordinator.noteSpoken(NADIA, 'Salma, come and look at this.', ++t)
    expect(named?.participants).toEqual([NADIA, SALMA].sort())
  })

  it('starts the budget again with the day', () => {
    const h = harness({ who: THREE })
    h.coordinator.noteSpoken(NADIA, 'Morning, all.', NOON)
    let t = NOON
    for (let i = 0; i < TALK_BUDGET_TICKS; i++) h.coordinator.onTick(++t)
    h.coordinator.leave(NADIA, t)
    h.coordinator.leave(OMAR, t)
    expect(h.coordinator.noteSpoken(NADIA, 'Nice weather for it.', t + 1)).toBeNull()
    expect(h.coordinator.noteSpoken(NADIA, 'Morning again.', t + MINUTES_PER_DAY)).not.toBeNull()
  })
})

describe('a town writes its own rule', () => {
  it('tells the world a rule was put the moment somebody says it', async () => {
    const h = harness({
      who: THREE,
      script: stanced({ [SALMA]: 'unsure', [OMAR]: 'for' }),
      laws: court().seam,
    })
    await council(h, NOON)
    h.loop.step()
    const proposed = lawEvents(h.engineDb).filter((e) => e.type === 'law_proposed')
    expect(proposed).toHaveLength(1)
    expect(proposed[0]!.payload).toMatchObject({ agentId: NADIA, text: PROPOSAL })
    expect((proposed[0]!.payload as { lawId: string }).lawId.startsWith('law_')).toBe(true)
  })

  it('caps a rule at the length every prompt will carry it at', async () => {
    const long = `From now on ${'we all bring one back '.repeat(12)}`
    const h = harness({
      who: THREE,
      script: stanced({ [SALMA]: 'unsure', [OMAR]: 'for' }),
      laws: court().seam,
    })
    await council(h, NOON, long)
    h.loop.step()
    const text = (lawEvents(h.engineDb)[0]!.payload as { text: string }).text
    expect(text.length).toBe(LAW_TEXT_MAX)
  })

  it('keeps each mind’s word on it, and lets a later one override', async () => {
    let answered = 0
    const h = harness({
      who: THREE,
      script: () => () =>
        fromCorpus(0, {
          speech: 'Still thinking.',
          leave: false,
          stance: answered++ === 0 ? 'against' : 'for',
        }),
      laws: court().seam,
    })
    h.coordinator.noteSpoken(NADIA, PROPOSAL, NOON)
    const scene = h.coordinator.open()[0]!
    await h.coordinator.takeFloor(OMAR, NOON)
    expect(scene.proposal?.stances).toEqual({ [OMAR]: 'against' })
  })

  // The owner's ruling: a law is built over days. The room that hears a rule tables it; the
  // first room of three on a later day votes it in or out.
  it('★ closes the talk and tables the rule the room was for, asking the court nothing yet', async () => {
    const { seam, asks } = court()
    const h = harness({
      who: THREE,
      script: stanced({ [SALMA]: 'unsure', [OMAR]: 'for' }),
      laws: seam,
    })
    await council(h, NOON)
    expect(closeReasonOf(h)).toBe('ended')
    h.loop.step()
    const types = lawEvents(h.engineDb).map((e) => e.type)
    expect(types).toEqual(['law_proposed', 'law_tabled'])
    expect(lawEvents(h.engineDb)[1]!.payload).toMatchObject({
      agentId: NADIA,
      text: PROPOSAL,
      votes: { for: [NADIA, OMAR], against: [] },
    })
    expect(asks).toHaveLength(0)
    expect(h.bridge.socialLaws()).toHaveLength(0)
    expect(h.bridge.tabledLines()[0]).toContain(`"${PROPOSAL}"`)
  })

  it('★ the same day’s next room does not vote; the next day’s first room ratifies with the court’s reading', async () => {
    const { seam, asks } = court()
    const h = harness({
      who: THREE,
      script: stanced({ [SALMA]: 'unsure', [OMAR]: 'for' }),
      laws: seam,
    })
    await council(h, NOON)
    h.loop.step()
    await vote(h, NOON + MINUTES_PER_DAY)
    h.loop.step()
    const ratified = lawEvents(h.engineDb).filter((e) => e.type === 'law_ratified')
    expect(ratified).toHaveLength(1)
    const tabledId = (lawEvents(h.engineDb)[1]!.payload as { lawId: string }).lawId
    expect(ratified[0]!.payload).toMatchObject({
      lawId: tabledId,
      agentId: NADIA,
      text: PROPOSAL,
      why: READING.why,
      predicate: NIGHT_TAKE,
      votes: { for: [NADIA, OMAR], against: [] },
    })
    expect(asks, 'one call, and only for the vote that passed').toHaveLength(1)
    expect(asks[0]!.text).toBe(PROPOSAL)
    expect(h.bridge.tabledLaws()).toHaveLength(0)
  })

  it('★ a room that gathers the same day is only a talk: the vote waits for tomorrow', async () => {
    const h = harness({
      who: THREE,
      script: stanced({ [SALMA]: 'unsure', [OMAR]: 'for' }),
      laws: court().seam,
    })
    await council(h, NOON)
    h.loop.step()
    h.coordinator.noteSpoken(NADIA, 'Morning, all.', NOON + 60)
    expect(h.coordinator.open().map((s) => s.kind)).toEqual(['talk'])
    expect(h.bridge.tabledLaws()).toHaveLength(1)
  })

  it('★ a room against it on the vote drops it, and a rule nobody comes back to lapses', async () => {
    const h = harness({
      who: THREE,
      script: stanced({ [OMAR]: 'against', [SALMA]: 'against' }, { [OMAR]: 'Salma' }),
      laws: court().seam,
    })
    // The script answers 'against', so the tabling itself is written by hand.
    h.emitNext('law_tabled', {
      lawId: 'law_put',
      agentId: NADIA,
      text: PROPOSAL,
      votes: { for: [NADIA, OMAR], against: [] },
    })
    h.loop.step()
    await vote(h, NOON + MINUTES_PER_DAY)
    h.loop.step()
    expect(lawEvents(h.engineDb).map((e) => e.type)).toEqual(['law_tabled', 'law_dropped'])
    expect(lawEvents(h.engineDb)[1]!.payload).toMatchObject({ lawId: 'law_put', why: 'rejected' })

    h.emitNext('law_tabled', {
      lawId: 'law_forgotten',
      agentId: NADIA,
      text: 'From now on we sing at dusk.',
      votes: { for: [NADIA, OMAR], against: [] },
    })
    h.loop.step()
    await vote(h, NOON + 5 * MINUTES_PER_DAY)
    h.loop.step()
    expect(lawEvents(h.engineDb).at(-1)!.payload).toMatchObject({
      lawId: 'law_forgotten',
      why: 'lapsed',
    })
    expect(h.bridge.tabledLaws()).toHaveLength(0)
  })

  it('folds the rule into the world the town now lives under', async () => {
    const h = harness({
      who: THREE,
      script: stanced({ [SALMA]: 'unsure', [OMAR]: 'for' }),
      laws: court().seam,
    })
    await lawPassed(h, NOON)
    const standing = h.bridge.socialLaws()
    expect(standing).toHaveLength(1)
    expect(standing[0]).toMatchObject({ ordinal: 1, text: PROPOSAL, predicate: NIGHT_TAKE })
    expect(h.bridge.lawTexts()).toEqual([PROPOSAL])
  })
})

describe('a rule the room did not pass', () => {
  it('asks the court nothing when more stood against it than for it', async () => {
    const { seam, asks } = court()
    const h = harness({
      who: THREE,
      script: stanced({ [OMAR]: 'against', [SALMA]: 'against' }, { [OMAR]: 'Salma' }),
      laws: seam,
    })
    await council(h, NOON)
    h.loop.step()
    expect(lawEvents(h.engineDb).map((e) => e.type)).toEqual(['law_proposed'])
    expect(asks).toHaveLength(0)
  })

  it('passes nothing when the one who had to answer walked out first', async () => {
    const { seam, asks } = court()
    const h = harness({
      who: THREE,
      script: (agentId) => () =>
        fromCorpus(0, { speech: 'No.', leave: agentId === OMAR, stance: null }),
      laws: seam,
    })
    await council(h, NOON)
    h.loop.step()
    expect(lawEvents(h.engineDb).map((e) => e.type)).toEqual(['law_proposed'])
    expect(asks).toHaveLength(0)
  })
})

describe('a rule with no court behind it', () => {
  it('still passes, kept in words only', async () => {
    const h = harness({ who: THREE, script: stanced({ [SALMA]: 'unsure', [OMAR]: 'for' }) })
    await lawPassed(h, NOON)
    expect(lawEvents(h.engineDb).find((e) => e.type === 'law_ratified')?.payload).toMatchObject({
      predicate: { kind: 'none' },
      why: 'kept in words only',
    })
  })

  it('says so and passes anyway when the court throws', async () => {
    const errors: string[] = []
    const h = harness({
      who: THREE,
      script: stanced({ [SALMA]: 'unsure', [OMAR]: 'for' }),
      laws: () => Promise.reject(new Error('the court is out')),
      onError: (kind) => errors.push(kind),
    })
    await lawPassed(h, NOON)
    expect(lawEvents(h.engineDb).find((e) => e.type === 'law_ratified')?.payload).toMatchObject({
      predicate: { kind: 'none' },
      why: 'kept in words only',
    })
    expect(errors).toContain('law_compile')
  })

  it('stops asking after six rules in one day', async () => {
    const { seam, asks } = court()
    const h = harness({
      who: THREE,
      script: stanced({ [SALMA]: 'unsure', [OMAR]: 'for' }),
      laws: seam,
    })
    for (let i = 0; i < MAX_COMPILES_PER_DAY + 1; i++) await council(h, NOON + i)
    h.loop.step()
    for (let i = 0; i < MAX_COMPILES_PER_DAY + 1; i++) {
      await vote(h, NOON + MINUTES_PER_DAY + i)
      h.loop.step()
    }
    expect(asks).toHaveLength(MAX_COMPILES_PER_DAY)
    const ratified = lawEvents(h.engineDb).filter((e) => e.type === 'law_ratified')
    expect(ratified, 'the seventh still passed; it is only held to in words').toHaveLength(
      MAX_COMPILES_PER_DAY + 1,
    )
    expect(ratified.at(-1)!.payload).toMatchObject({ why: 'kept in words only' })
  })
})

describe('letting a rule go', () => {
  it('repeals the standing rule the court named, and ratifies nothing new', async () => {
    let answer: Awaited<ReturnType<LawSeam>> = READING
    const asks: Parameters<LawSeam>[0][] = []
    const h = harness({
      who: THREE,
      script: stanced({ [SALMA]: 'unsure', [OMAR]: 'for' }),
      laws: (ask) => {
        asks.push(structuredClone(ask))
        return Promise.resolve(answer)
      },
    })
    await lawPassed(h, NOON)
    const first = h.bridge.socialLaws()[0]!

    answer = { predicate: { kind: 'none' }, repeals: 1, why: 'the town has had enough of it' }
    await lawPassed(h, NOON + MINUTES_PER_DAY + 1, 'We let go of the rule about the store.')

    expect(asks[1]!.standing).toEqual([{ ordinal: 1, text: PROPOSAL }])
    const types = lawEvents(h.engineDb).map((e) => e.type)
    expect(types.filter((t) => t === 'law_ratified')).toHaveLength(1)
    expect(lawEvents(h.engineDb).find((e) => e.type === 'law_repealed')?.payload).toMatchObject({
      lawId: first.id,
      agentId: NADIA,
    })
    expect(h.bridge.socialLaws(), 'nothing stands any more').toHaveLength(0)
  })
})

describe('a scene written before a council could count', () => {
  it('comes back with nobody having voted and the anchor as the one who put it', () => {
    const h = harness({ who: THREE })
    const scene = structuredClone(h.coordinator.noteSpoken(NADIA, PROPOSAL, NOON)!)
    const stored = {
      ...scene,
      proposal: { lawText: scene.proposal!.lawText, predicate: { kind: 'none' as const } },
    }
    const fresh = new SceneCoordinator({
      bridge: h.bridge,
      mindFor: (id) => h.minds.get(id) ?? null,
    })
    fresh.adopt(stored)
    expect(fresh.open()[0]!.proposal).toEqual({
      lawText: PROPOSAL,
      proposedBy: NADIA,
      stances: {},
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

  it('replays a town that wrote rules to the same world it lives in', async () => {
    let answer: Awaited<ReturnType<LawSeam>> = READING
    const h = harness({
      who: THREE,
      script: stanced({ [SALMA]: 'unsure', [OMAR]: 'for' }),
      laws: () => Promise.resolve(answer),
    })
    await lawPassed(h, NOON)
    const lawId = h.bridge.socialLaws()[0]!.id
    h.emitNext('law_broken', { lawId, agentId: OMAR, verb: 'take', witnesses: [NADIA] })
    h.loop.step()
    answer = { predicate: { kind: 'none' }, repeals: 1, why: 'the town has had enough of it' }
    await lawPassed(h, NOON + MINUTES_PER_DAY + 1, 'We let go of the rule about the store.')

    expect(new Set(lawEvents(h.engineDb).map((e) => e.type))).toEqual(
      new Set(['law_proposed', 'law_tabled', 'law_ratified', 'law_broken', 'law_repealed']),
    )
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

// ── Relationships as chosen acts ──────────────────────────────────────────────────────────────
// Every row here drives the REAL court/propose/lie_with/leave_partner verbs through the bridge
// and the engine's own fold. Nothing hand-writes an event.

const ADULTS: Who[] = [
  { id: NADIA, name: 'Nadia', x: 3, ageDays: ADULT_AGE_DAYS },
  { id: OMAR, name: 'Omar', x: 4, ageDays: ADULT_AGE_DAYS },
]

const INDOORS: Who[] = ADULTS.map((w) => ({ ...w, inside: true }))

/** One tick of the real world, then the coordinator's own look at what the log now says. */
async function turnOfTheWorld(h: Harness): Promise<void> {
  h.loop.step()
  await flush()
  h.coordinator.onTick(h.loop.tick)
  await flush()
}

/** What a mind names in an ordinary turn, put through the engine exactly as a runtime puts it. */
async function act(h: Harness, agentId: string, verb: string, targetId: string): Promise<string> {
  const settled = h.bridge.submit(agentId, { verb, params: { targetId } })
  await turnOfTheWorld(h)
  const res = await settled
  return res.ok ? 'ok' : res.reason
}

const answering = (answer: 'accept' | 'refuse') => () => (_a: SceneAsk, n: number) =>
  fromCorpus(n, { leave: false, answer, speech: 'Yes, then.' })

const tiesOf = (h: Harness, id: string) =>
  h.minds
    .get(id)!
    .ties.all()
    .map((t) => ({
      personId: t.personId,
      kind: t.kind,
      source: t.source,
      settled: t.settledTick !== null,
    }))

const memoriesOf = (h: Harness, id: string): string[] =>
  h.remembered.filter((r) => r.agentId === id).map((r) => r.text)

describe('an ask opens a scene of its own', () => {
  it('hands the invitee the floor and writes the asker the memory of asking', async () => {
    const h = harness({ who: ADULTS })
    expect(await act(h, NADIA, 'court', OMAR)).toBe('ok')

    const scene = h.coordinator.open()[0]!
    expect(scene.kind).toBe('invitation')
    expect(scene.participants).toEqual([NADIA, OMAR])
    expect(scene.floor, 'the one who has to answer holds it').toBe(OMAR)
    expect(scene.invitation).toEqual({
      verb: 'court',
      from: NADIA,
      to: OMAR,
      askedTick: h.loop.tick,
    })
    expect(scene.stakes).toBe(INVITATION_STAKES)
    h.loop.step()
    const opened = sceneEvents(h.engineDb).find((e) => e.type === 'scene_opened')
    expect((opened?.payload as { kind?: string } | undefined)?.kind).toBe('invitation')
    expect(memoriesOf(h, NADIA)).toEqual(['You asked Omar to walk out together.'])
  })

  it('takes over the talk two people are already in rather than opening a second', async () => {
    const h = harness({
      wooed: true,
      who: ADULTS,
      script: (id) => (_a, n) =>
        fromCorpus(n, { leave: false, ask: id === NADIA ? 'propose' : null, to: 'Omar' }),
    })
    const talk = h.coordinator.noteSpoken(NADIA, 'Omar. Six planks.', NOON)!
    expect(talk.kind).toBe('talk')
    // Nadia has the floor back after Omar's line, and puts the question in that line.
    await h.coordinator.takeFloor(OMAR, NOON)
    await h.coordinator.takeFloor(NADIA, NOON)
    await turnOfTheWorld(h)

    expect(h.coordinator.open(), 'one scene, upgraded').toHaveLength(1)
    const scene = h.coordinator.open()[0]!
    expect(scene.id).toBe(talk.id)
    expect(scene.kind).toBe('invitation')
    expect(scene.invitation?.verb).toBe('propose')
    expect(scene.floor).toBe(OMAR)
  })

  // Risk 2: the scan re-aims the floor while the mouth that held it is still with a provider.
  it('drops a line still in flight when the scan re-aims the floor under it', async () => {
    const h = harness({
      who: ADULTS,
      script: (id) => (id === NADIA ? () => 'hold' : (_a, n) => fromCorpus(n, { leave: false })),
    })
    h.coordinator.noteSpoken(OMAR, 'Nadia. Six planks.', NOON)
    const inFlight = h.coordinator.takeFloor(NADIA, NOON)
    expect(h.coordinator.open()[0]?.floor).toBe(NADIA)

    await act(h, OMAR, 'court', NADIA)
    const scene = h.coordinator.open()[0]!
    expect(scene.invitation?.from, 'the ask took the floor over').toBe(OMAR)
    const said = scene.thread.length

    h.llms.get(NADIA)!.held[0]!(fromCorpus(0, { leave: false, speech: 'Six, then.' }))
    await inFlight
    expect(scene.thread.length, 'the line came back to a floor that had already moved').toBe(said)
    expect(scene.invitation, 'and it did not answer for her either').not.toBeUndefined()
  })

  it('lets the ask go stale where nobody is home to answer it', async () => {
    const h = harness({ who: ADULTS })
    const deaf = new SceneCoordinator({
      bridge: h.bridge,
      mindFor: (id) => (id === NADIA ? h.minds.get(id)! : null),
    })
    void h.bridge.submit(NADIA, { verb: 'court', params: { targetId: OMAR } })
    h.loop.step()
    await flush()
    deaf.onTick(h.loop.tick)
    await flush()
    expect(deaf.open(), 'no mind to hand the floor to').toHaveLength(0)
    expect(memoriesOf(h, NADIA)).toContain('Omar gave you no answer.')
  })
})

describe('a yes is the same verb aimed back', () => {
  it('courting: both hold an attraction the relationship wrote', async () => {
    const h = harness({ who: ADULTS, script: answering('accept') })
    await act(h, NADIA, 'court', OMAR)
    await h.coordinator.takeFloor(OMAR, h.loop.tick)
    await turnOfTheWorld(h)

    expect(tiesOf(h, NADIA)).toEqual([
      { personId: OMAR, kind: 'attraction', source: 'relationship', settled: false },
    ])
    expect(tiesOf(h, OMAR)).toEqual([
      { personId: NADIA, kind: 'attraction', source: 'relationship', settled: false },
    ])
    expect(h.coordinator.open()[0]?.invitation, 'answered and cleared').toBeUndefined()
    expect(h.coordinator.open(), 'and the talk goes on').toHaveLength(1)
  })

  it('proposing: the world holds the partnership and both books say so', async () => {
    const h = harness({ wooed: true, who: ADULTS, script: answering('accept') })
    await act(h, NADIA, 'propose', OMAR)
    await h.coordinator.takeFloor(OMAR, h.loop.tick)
    await turnOfTheWorld(h)

    expect(h.bridge.partnerOf(NADIA)).toBe(OMAR)
    expect(h.bridge.partnerOf(OMAR)).toBe(NADIA)
    for (const id of [NADIA, OMAR]) {
      expect(tiesOf(h, id).filter((t) => t.kind === 'kin')).toHaveLength(1)
      expect(
        h.minds
          .get(id)!
          .ties.open()
          .find((t) => t.kind === 'kin')?.text,
      ).toBe('your partner')
    }
    expect(memoriesOf(h, NADIA)).toContain('You and Omar are partners now.')
    expect(memoriesOf(h, OMAR)).toContain('You and Nadia are partners now.')
    expect(
      h.fed
        .filter((f) => f.occasion === 'partnered')
        .map((f) => f.agentId)
        .sort(),
    ).toEqual([NADIA, OMAR].sort())
  })

  it('lying together: the hour begins, the scene ends, and the secret is theirs alone', async () => {
    const h = harness({ who: INDOORS, script: answering('accept') })
    await act(h, NADIA, 'lie_with', OMAR)
    await h.coordinator.takeFloor(OMAR, h.loop.tick)
    await turnOfTheWorld(h)

    expect(h.loop.state.agents[NADIA]?.activity?.verb).toBe('lie_with')
    expect(h.loop.state.agents[OMAR]?.activity?.verb).toBe('lie_with')
    expect(h.coordinator.open(), 'two bodies busy for an hour hold no floor').toHaveLength(0)
    expect(closeReasonOf(h)).toBe('ended')
    for (const id of [NADIA, OMAR]) {
      const secret = h.minds
        .get(id)!
        .ties.open()
        .find((t) => t.kind === 'secret')
      expect(secret?.text, 'the place by its name, never its mark').toBe(
        'what happened between you under the house',
      )
    }
  })

  it('writes no secret between two who are already partners', async () => {
    const h = harness({ wooed: true, who: INDOORS, script: answering('accept') })
    await act(h, NADIA, 'propose', OMAR)
    await h.coordinator.takeFloor(OMAR, h.loop.tick)
    await turnOfTheWorld(h)
    await act(h, NADIA, 'lie_with', OMAR)
    await h.coordinator.takeFloor(OMAR, h.loop.tick)
    await turnOfTheWorld(h)

    expect(tiesOf(h, NADIA).filter((t) => t.kind === 'secret')).toEqual([])
  })

  it('tells them both the moment passed when the world refuses the yes', async () => {
    const h = harness({ who: ADULTS, script: answering('accept') })
    await act(h, NADIA, 'court', OMAR)
    // Nadia walks off between the ask and the answer.
    h.emitNext('agent_moved', { id: NADIA, x: 21, y: 3 })
    h.loop.step()
    await h.coordinator.takeFloor(OMAR, h.loop.tick)
    await turnOfTheWorld(h)

    for (const id of [NADIA, OMAR]) {
      expect(memoriesOf(h, id).some((m) => m.startsWith('The moment passed:'))).toBe(true)
    }
    expect(tiesOf(h, OMAR).filter((t) => t.kind === 'attraction')).toEqual([])
  })
})

describe('a no said in front of people', () => {
  it('is a slight the asker holds, and only where somebody heard it', async () => {
    const h = harness({
      who: [...ADULTS, { id: SALMA, name: 'Salma', x: 5, ageDays: ADULT_AGE_DAYS }],
      script: answering('refuse'),
    })
    await act(h, NADIA, 'court', OMAR)
    expect(h.coordinator.open()[0]?.audience).toEqual([SALMA])
    await h.coordinator.takeFloor(OMAR, h.loop.tick)
    await turnOfTheWorld(h)

    expect(tiesOf(h, NADIA)).toEqual([
      { personId: OMAR, kind: 'slight', source: 'relationship', settled: false },
    ])
    expect(tiesOf(h, OMAR), 'the one who said no holds nothing').toEqual([])
    expect(memoriesOf(h, NADIA)).toContain('Omar turned you down.')
    expect(h.loop.state.agents[OMAR]).not.toHaveProperty('asked')
  })

  it('leaves no tie at all where the two of them were alone', async () => {
    const h = harness({ who: ADULTS, script: answering('refuse') })
    await act(h, NADIA, 'court', OMAR)
    await h.coordinator.takeFloor(OMAR, h.loop.tick)
    await turnOfTheWorld(h)

    expect(tiesOf(h, NADIA)).toEqual([])
    expect(memoriesOf(h, NADIA)).toContain('Omar turned you down.')
  })

  it('counts an answer with nothing said as an answer and not as a pass', async () => {
    const h = harness({
      who: ADULTS,
      script: () => () => fromCorpus(0, { leave: false, answer: 'refuse', speech: null }),
    })
    await act(h, NADIA, 'court', OMAR)
    const scene = h.coordinator.open()[0]!
    await h.coordinator.takeFloor(OMAR, h.loop.tick)
    expect(scene.passes, 'a no is a thing said').toBe(0)
    expect(scene.closedTick).toBeNull()
  })
})

describe('an ask nobody ever answered', () => {
  it('leaves the asker a memory and the log nothing', async () => {
    let clock = 0
    const h = harness({ who: ADULTS, script: () => () => 'stall', now: () => clock })
    await act(h, NADIA, 'court', OMAR)
    for (let i = 0; i < 2; i += 1) {
      const floor = h.coordinator.open()[0]?.floor
      if (floor === undefined || floor === null) break
      void h.coordinator.takeFloor(floor, h.loop.tick)
      clock += FLOOR_TIMEOUT_MS
      h.coordinator.onTick(h.loop.tick + 1 + i)
      await flush()
    }
    expect(h.coordinator.open()).toHaveLength(0)
    expect(memoriesOf(h, NADIA)).toContain('Omar gave you no answer.')
    h.loop.step()
    const log = sceneEvents(h.engineDb).map((e) => e.type)
    expect(log).not.toContain('invitation_refused')
  })

  it('reads a reciprocal past the window as a fresh ask and not as a yes', async () => {
    const h = harness({ who: ADULTS })
    await act(h, NADIA, 'court', OMAR)
    for (let i = 0; i < INVITATION_STANDS_TICKS + 1; i += 1) h.loop.step()
    expect(await act(h, OMAR, 'court', NADIA)).toBe('ok')
    expect(h.loop.state.agents[NADIA]?.asked?.byId, 'an ask, not an acceptance').toBe(OMAR)
    expect(h.bridge.partnerOf(NADIA)).toBeNull()
  })
})

describe('a partner left', () => {
  it('settles the kin tie, opens a grudge, and tells them both, with no scene in it', async () => {
    const h = harness({ wooed: true, who: ADULTS, script: answering('accept') })
    await act(h, NADIA, 'propose', OMAR)
    await h.coordinator.takeFloor(OMAR, h.loop.tick)
    await turnOfTheWorld(h)
    for (const s of h.coordinator.open()) void s
    // No scene: an ordinary turn, and the scan is the only thing that hears of it.
    expect(await act(h, NADIA, 'leave_partner', OMAR)).toBe('ok')

    expect(h.bridge.partnerOf(NADIA)).toBeNull()
    expect(tiesOf(h, NADIA).find((t) => t.kind === 'kin')?.settled).toBe(true)
    expect(tiesOf(h, OMAR).find((t) => t.kind === 'kin')?.settled).toBe(true)
    expect(tiesOf(h, OMAR).find((t) => t.kind === 'grudge')).toEqual({
      personId: NADIA,
      kind: 'grudge',
      source: 'relationship',
      settled: false,
    })
    expect(memoriesOf(h, NADIA)).toContain('You left Omar.')
    expect(memoriesOf(h, OMAR)).toContain('Nadia has left you.')
  })

  it('makes the next talk that names the leaver a quarrel', async () => {
    const h = harness({ wooed: true, who: ADULTS, script: answering('accept') })
    await act(h, NADIA, 'propose', OMAR)
    await h.coordinator.takeFloor(OMAR, h.loop.tick)
    await turnOfTheWorld(h)
    await act(h, NADIA, 'leave_partner', OMAR)
    for (const scene of h.coordinator.open()) void scene
    h.coordinator.leave(NADIA, h.loop.tick)
    h.coordinator.leave(OMAR, h.loop.tick)
    await flush()

    expect(h.coordinator.noteSpoken(OMAR, 'Nadia said it would be for good.', NOON)?.kind).toBe(
      'quarrel',
    )
  })
})

describe('being spoken to stops your legs', () => {
  // Rehearsal 12: 37 of 145 talks were one line long because the person spoken to kept walking
  // and left earshot before their turn to answer arrived.
  it('★ stops the one spoken to mid-walk, and leaves the one already standing alone', async () => {
    // On open ground, well clear of the house the default cast stands on.
    const h = harness({
      who: [
        { id: NADIA, name: 'Nadia', x: 12 },
        { id: OMAR, name: 'Omar', x: 13 },
      ],
    })
    h.emitNext('action_started', {
      agentId: OMAR,
      verb: 'walk',
      params: { x: 20, y: 3 },
      duration: 40,
    })
    h.loop.step()
    expect(h.loop.state.agents[OMAR]!.activity?.verb).toBe('walk')
    expect(h.coordinator.noteSpoken(NADIA, 'Omar, hang on a second.', NOON)).not.toBeNull()
    h.loop.step()
    await flush()
    h.loop.step()
    expect(h.loop.state.agents[OMAR]!.activity).toBeNull()
    expect(h.coordinator.open()).toHaveLength(1)
  })
})
