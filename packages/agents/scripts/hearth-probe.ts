// HEARTH PROBE — not a gate. One question, asked of real minds: when there is a fire in the
// room and a body can reach it, does anybody feed it?
//   hb  house.hearth and house.bed false — no verb reaches the fire, the packet omits both fields.
//   h   the same house with the fire reachable; nothing tells a mind to feed it.
//
//   HEARTH_ARM=h|hb  HEARTH_TICKS=720  HEARTH_LABEL=h1
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import {
  createWorldTick,
  EventStore,
  fold,
  genesisState,
  isExposed,
  makeGenesisWorld,
  RngStreams,
  shelterLedger,
  TickLoop,
  warmthTargetFor,
  type LawQueue,
  type TickHandler,
  type WorldState,
} from '@sj/engine'
import {
  isBeddedKind,
  isHearthKind,
  MINUTES_PER_DAY,
  simTimeFromTick,
  SimConfigSchema,
  type SimConfig,
  type SimEvent,
} from '@sj/shared'
import { EngineBridge, type Intent, type SubmitResult } from '../src/runtime/bridge.js'
import { AgentRuntime } from '../src/runtime/agentRuntime.js'
import { openAgentDb } from '../src/memory/schema.js'
import { PersonalityStore } from '../src/personality.js'
import { migrateLlmTables } from '../src/llm/callLog.js'
import { LlmClient } from '../src/llm/client.js'
import { Embedder } from '../src/memory/embedder.js'
import { makeReflectionLlm } from '../src/reflection.js'
import { FOUNDER_MINDS as MINDS } from '../src/live/founderMinds.js'

const ARM = (process.env.HEARTH_ARM ?? 'h').toLowerCase()
const LABEL = process.env.HEARTH_LABEL ?? ARM
const TOTAL_TICKS = Number(process.env.HEARTH_TICKS ?? 720)
// 18:00 so the record stacks with the motive probe. Day 273 is the only season in which an
// indoor body crosses the shiver line, and therefore the only one a hearth answers a want in.
const START_TICK = Number(process.env.HEARTH_DAY ?? 0) * MINUTES_PER_DAY + 18 * 60
const CAP_USD = 6.0
const REAL_MS_PER_TICK = Number(process.env.HEARTH_MS_PER_TICK ?? 250)
const WOOD_IN_HAND = 10
const DATA_DIR = fileURLToPath(new URL('../data/hearth/', import.meta.url))

// The arm is one config edit and nothing else — two booleans off is exactly the world before
// this lane. World, seed, cast, wood in hand and the finished house are identical in both arms.
const BEFORE = ARM === 'hb'
const config: SimConfig = BEFORE
  ? SimConfigSchema.parse({
      structures: {
        recipes: {
          ...SimConfigSchema.parse({}).structures.recipes,
          house: {
            ...SimConfigSchema.parse({}).structures.recipes.house!,
            hearth: false,
            bed: false,
          },
        },
      },
    })
  : SimConfigSchema.parse({})

// ------------------------------------------------------------------ the world ---
// The founding valley plus ONE finished house, MINUS the cabin. The cabin comes out so the
// ledger stays at 2 roofs / 4 slots / 5 bodies = 0.8 — finishing a house would take `per` to
// 1.2 and a run starting above 1.0 cannot tell a wanting town from a busy one.
function buildWorld(store: EventStore): {
  state: WorldState
  doors: { x: number; y: number }[]
  houseId: string
} {
  const g = makeGenesisWorld(config)
  let state = genesisState(config, g.terrain)
  const doors: { x: number; y: number }[] = []
  const emit = (type: string, payload: unknown): void => {
    state = fold(state, store.append(state.tick, type, payload), config)
  }
  const dropped = new Set<string>()
  for (const e of g.events) {
    const p = e.payload as Record<string, unknown>
    if (e.type === 'structure_planned') {
      // The same five spawn tiles the motive probe uses, so the two records stack.
      if (p.kind === 'house' || p.kind === 'storehouse') {
        doors.push({ x: Number(p.x), y: Number(p.y) + Number(p.h ?? 1) })
      }
      if (p.kind === 'cabin') {
        dropped.add(String(p.id))
        continue
      }
    }
    if (dropped.has(String(p.id))) continue
    emit(e.type, e.payload)
  }
  // The lowest-id roofless house, finished. Lowest id so the arms cannot pick different ones.
  const houseId = Object.values(state.structures)
    .filter((s) => s.kind === 'house' && s.stage === 'construction')
    .map((s) => s.id)
    .sort()[0]!
  emit('structure_completed', { id: houseId })
  return { state, doors, houseId }
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('no key in the environment')
  mkdirSync(DATA_DIR, { recursive: true })
  const dbPath = path.join(DATA_DIR, `${LABEL}.db`)
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })
  const db = openAgentDb(dbPath)
  migrateLlmTables(db)

  const store = new EventStore(db)
  const rng = new RngStreams('hearth-probe')
  const { state: builtState, doors, houseId } = buildWorld(store)
  let state = builtState
  MINDS.forEach((m, i) => {
    const at = doors[i] ?? doors[0]!
    state = fold(
      state,
      store.append(state.tick, 'agent_spawned', {
        id: m.id,
        name: m.identity.name,
        x: at.x,
        y: at.y,
        sex: m.sex,
        ageDays: m.ageDays,
      }),
      config,
    )
    state = fold(
      state,
      store.append(state.tick, 'item_spawned', {
        id: `wood_${m.id}`,
        kind: 'wood',
        qty: WOOD_IN_HAND,
        loc: { t: 'agent', id: m.id },
        owner: m.id,
      }),
      config,
    )
    state = fold(
      state,
      store.append(state.tick, 'item_spawned', {
        id: `bread_${m.id}`,
        kind: 'bread',
        qty: 4,
        loc: { t: 'agent', id: m.id },
        owner: m.id,
      }),
      config,
    )
  })
  for (const m of MINDS) {
    state = fold(
      state,
      store.append(state.tick, 'need_changed', { id: m.id, need: 'energy', delta: 0 }),
      config,
    )
  }

  const lawQueue: LawQueue = []
  const worldTick = createWorldTick(config, rng, lawQueue)
  const loop = new TickLoop({
    store,
    state,
    rng,
    config,
    startTick: START_TICK,
    realMsPerTick: 0,
    onTick: (c) => {
      handler(c)
    },
  })

  const refusals: { tick: number; id: string; verb: string; reason: string }[] = []
  const attempts: { tick: number; id: string; verb: string; params: string }[] = []
  class Watched extends EngineBridge {
    override submit(
      agentId: string,
      intent: Intent,
      cb?: (r: SubmitResult) => void,
    ): Promise<SubmitResult> {
      attempts.push({
        tick: loop.tick,
        id: agentId,
        verb: intent.verb,
        params: JSON.stringify(intent.params),
      })
      return super.submit(agentId, intent, (r) => {
        if (!r.ok)
          refusals.push({ tick: loop.tick, id: agentId, verb: intent.verb, reason: r.reason })
        cb?.(r)
      })
    }
  }
  const bridge = new Watched({ loop, store, simConfig: config })
  const handler: TickHandler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
  })

  const embedder = await Embedder.create(
    fileURLToPath(new URL('../../../data/models/', import.meta.url)),
  )
  const thoughts: { tick: number; agentId: string; text: string }[] = []
  const runtimes: AgentRuntime[] = []
  for (const spec of MINDS) {
    const personality = new PersonalityStore(db, spec.id)
    personality.init(spec.personality, Math.floor(loop.tick / MINUTES_PER_DAY))
    const runtime = new AgentRuntime({
      db,
      llm: new LlmClient({ db, caller: 'turn', agentId: spec.id, budgetUsd: CAP_USD }),
      embedder,
      identity: spec.identity,
      personality,
      bridge,
      reflectionLlm: makeReflectionLlm(
        new LlmClient({ db, caller: 'reflection', agentId: spec.id, budgetUsd: CAP_USD }),
      ),
      onThought: (t) => thoughts.push(t),
    })
    runtime.start(spec.id)
    runtimes.push(runtime)
  }

  const end = START_TICK + TOTAL_TICKS
  while (loop.tick < end) {
    const at = Date.now()
    loop.step()
    await new Promise<void>((r) => setTimeout(r, Math.max(0, REAL_MS_PER_TICK - (Date.now() - at))))
  }
  for (const r of runtimes) r.stop()
  bridge.drain()
  await new Promise<void>((r) => setTimeout(r, 3000))

  // ------------------------------------------------------------ what happened ---
  const events: SimEvent[] = store.readFrom(0).filter((e) => e.tick >= START_TICK)
  const fueled = events.filter((e) => e.type === 'structure_fueled')
  const byVerb = new Map<string, number>()
  for (const a of attempts) byVerb.set(a.verb, (byVerb.get(a.verb) ?? 0) + 1)
  const cost = db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS c FROM llm_calls').get() as {
    c: number
  }
  const calls = db.prepare('SELECT COUNT(*) AS n FROM llm_calls').get() as { n: number }
  const s = loop.state

  const fireOf = (id: string): string | null => {
    const at = s.agents[id]?.insideId
    return at === undefined
      ? null
      : (s.structures[at]?.fueledUntilTick ?? 0) > s.tick
        ? 'lit'
        : 'cold'
  }

  const report = {
    arm: ARM,
    label: LABEL,
    ticks: TOTAL_TICKS,
    startTick: START_TICK,
    season: simTimeFromTick(START_TICK).season,
    weatherAtEnd: s.weather,
    // The world both arms ran in, so a reader can check they are the same world.
    houseFinished: houseId,
    houseHoldsAFire: isHearthKind(config, 'house'),
    houseHoldsABed: isBeddedKind(config, 'house'),
    hearthsStanding: Object.values(s.structures)
      .filter((x) => x.stage === 'complete' && isHearthKind(config, x.kind))
      .map((x) => `${x.kind} ${x.id}`)
      .sort(),
    shelterLedger: (() => {
      const l = shelterLedger(s, config)
      return { ...l, per: Number(l.per.toFixed(2)) }
    })(),
    llmCalls: calls.n,
    costUsd: Number(cost.c.toFixed(4)),
    intents: attempts.length,
    byVerb: Object.fromEntries([...byVerb].sort((a, b) => b[1] - a[1])),
    // ★ THE QUESTION. Did anybody feed a fire, and which one?
    stokeIntents: attempts.filter((a) => a.verb === 'stoke'),
    firesFed: fueled.map((e) => JSON.stringify(e.payload)),
    firesLitAtDawn: Object.values(s.structures)
      .filter((x) => (x.fueledUntilTick ?? 0) > s.tick)
      .map((x) => `${x.kind} ${x.id}`)
      .sort(),
    // Where the bodies ended, and what the night was worth to each of them.
    endedInside: Object.fromEntries(MINDS.map((m) => [m.id, s.agents[m.id]?.insideId ?? null])),
    endedAtALitFire: Object.fromEntries(MINDS.map((m) => [m.id, fireOf(m.id)])),
    asleepAtDawn: MINDS.filter((m) => s.agents[m.id]?.asleep === true).length,
    energyAtEnd: Object.fromEntries(
      MINDS.map((m) => [m.id, Number((s.agents[m.id]?.needs.energy ?? -1).toFixed(1))]),
    ),
    warmthAtEnd: Object.fromEntries(
      MINDS.map((m) => [m.id, Number((s.agents[m.id]?.needs.warmth ?? -1).toFixed(1))]),
    ),
    warmthTargetAtEnd: Object.fromEntries(
      MINDS.map((m) => [m.id, Number(warmthTargetFor(s, config, m.id).toFixed(1))]),
    ),
    exposedAtEnd: MINDS.filter((m) => isExposed(s, config, m.id)).length,
    collapsedAtEnd: MINDS.filter((m) => s.agents[m.id]?.collapsedSinceTick != null).length,
    entered: events.filter((e) => e.type === 'agent_entered').length,
    slept: events.filter((e) => e.type === 'agent_slept').length,
    spoke: events.filter((e) => e.type === 'agent_spoke').length,
    builds: byVerb.get('build') ?? 0,
    refusals: refusals.length,
    refusalsByVerb: Object.entries(
      refusals.reduce<Record<string, number>>((acc, r) => {
        const k = `${r.verb}: ${r.reason}`
        acc[k] = (acc[k] ?? 0) + 1
        return acc
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12),
    // What the minds were thinking about, in their own words. Never a claim that the prose
    // caused it — a count of what they mentioned, so the two arms can be compared.
    thoughts: thoughts.length,
    thoughtsMentioningFire: thoughts.filter((t) =>
      /\bhearth|fire|flame|ember|kindl|warm the|smoke\b/i.test(t.text),
    ).length,
    thoughtsMentioningBed: thoughts.filter((t) => /\bbed|sleep|lie down|rest\b/i.test(t.text))
      .length,
    thoughtsMentioningCold: thoughts.filter((t) =>
      /\bcold|shiver|freez|warm|roof|shelter|walls|night air\b/i.test(t.text),
    ).length,
  }
  writeFileSync(path.join(DATA_DIR, `${LABEL}.json`), JSON.stringify(report, null, 2))
  writeFileSync(
    path.join(DATA_DIR, `${LABEL}-thoughts.md`),
    thoughts.map((t) => `- t=${t.tick} **${t.agentId}**: ${t.text}`).join('\n'),
  )
  writeFileSync(
    path.join(DATA_DIR, `${LABEL}-speech.md`),
    events
      .filter((e) => e.type === 'agent_spoke')
      .map((e) => `- t=${e.tick} ${JSON.stringify(e.payload)}`)
      .join('\n'),
  )
  console.log(JSON.stringify(report, null, 2))
}

await main()
