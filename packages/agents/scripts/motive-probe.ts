// MOTIVE PROBE — not a gate. One question, asked of real minds: with a cold night coming, no
// roof within reach and the wood already in hand, does anybody raise one?
//
// Two arms over the identical world and seed; the ONLY difference is whether the packet
// carries the `cold` field. Nothing in either arm tells a mind to build.
//
//   MOTIVE_ARM=a|b  MOTIVE_TICKS=360  MOTIVE_LABEL=run1
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import {
  buildTicks,
  createWorldTick,
  doorTile,
  EventStore,
  fold,
  genesisState,
  makeGenesisWorld,
  RngStreams,
  shelterLedger,
  TickLoop,
  type LawQueue,
  type TickHandler,
  type WorldState,
} from '@sj/engine'
import {
  DEFAULT_CONFIG,
  isRoofedKind,
  MINUTES_PER_DAY,
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

const ARM = (process.env.MOTIVE_ARM ?? 'b').toLowerCase()
const LABEL = process.env.MOTIVE_LABEL ?? ARM
const TOTAL_TICKS = Number(process.env.MOTIVE_TICKS ?? 360)
// 18:00. The cold bites at 21:00 in early spring, so three sim-hours of daylight come first:
// a mind that wants a roof has time to raise one before it needs it.
const START_TICK = 18 * 60
const CAP_USD = 6.0
const REAL_MS_PER_TICK = Number(process.env.MOTIVE_MS_PER_TICK ?? 250)
const WOOD_IN_HAND = 10 // exactly one house. Gathering is a different question.
const DATA_DIR = fileURLToPath(new URL('../data/motive/', import.meta.url))

const config: SimConfig = DEFAULT_CONFIG

// ------------------------------------------------------------------ the world ---
// The genesis valley with some of its buildings taken out; nothing else touched.
// The arm worlds are FROZEN named kinds, never a `roofed`/`enterableKinds` lookup — `roofed`
// has since grown to cover cabins and cottages, and reading it here would gut arms A and B
// and stop the run stacking against the nights already on record.
//
//   a  control — the founding valley, the `cold` field stripped at the seam.
//   b  the cold felt, and the valley SOUND — every roof back on. 21 slots for 5 bodies.
//   c  the cold felt, and nowhere at all to go in: no roof of any kind.
//   g  the founding exactly as it ships — two sound roofs, seven dwellings at three quarters.
//
// MOTIVE_LABEL=w<arm><round> adds to the record rather than overwriting it.
const SPAWN_KINDS = new Set(['house', 'storehouse'])
const REMOVED_BY_ARM: Record<string, string[]> = {
  a: [],
  b: [],
  c: ['house', 'storehouse', 'cabin', 'cottage', 'farmhouse'],
  g: [],
}
// Arm B puts the roofs back on: the valley as it stood before the ruling, and the only arm
// where the want is answered before the first tick.
const ROOFS_BACK_ON = ARM === 'b'
const REMOVED = new Set(REMOVED_BY_ARM[ARM] ?? REMOVED_BY_ARM['g']!)
void isRoofedKind

function buildWorld(store: EventStore): {
  state: WorldState
  doors: Array<{ x: number; y: number }>
} {
  const g = makeGenesisWorld(config)
  let state = genesisState(config, g.terrain)
  const dropped = new Set<string>()
  const roofless = new Set<string>()
  const doors: Array<{ x: number; y: number }> = []
  const emit = (type: string, payload: unknown): void => {
    state = fold(state, store.append(state.tick, type, payload), config)
  }
  for (const e of g.events) {
    const p = e.payload as Record<string, unknown>
    if (e.type === 'structure_planned') {
      // Every arm spawns its five founders on exactly the same five tiles, so the arms differ
      // in nothing but what stands around them.
      if (SPAWN_KINDS.has(String(p['kind'])))
        doors.push({ x: Number(p['x']), y: Number(p['y']) + Number(p['h'] ?? 1) })
      if (REMOVED.has(String(p['kind']))) {
        dropped.add(String(p['id']))
        continue
      }
      roofless.add(String(p['id']))
      emit(e.type, e.payload)
      continue
    }
    if (dropped.has(String(p['id']))) continue
    if (e.type === 'structure_completed') roofless.delete(String(p['id']))
    // ARM B ONLY: the progress genesis books into a roofless dwelling is skipped and the
    // building is completed instead — the sound village, as every earlier run measured it.
    if (ROOFS_BACK_ON && e.type === 'structure_progressed') continue
    emit(e.type, e.payload)
  }
  if (ROOFS_BACK_ON) for (const id of [...roofless].sort()) emit('structure_completed', { id })
  return { state, doors }
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('no key in the environment')
  mkdirSync(DATA_DIR, { recursive: true })
  const dbPath = path.join(DATA_DIR, `${LABEL}.db`)
  rmSync(dbPath, { force: true })
  rmSync(`${dbPath}-wal`, { force: true })
  rmSync(`${dbPath}-shm`, { force: true })
  const db = openAgentDb(dbPath)
  migrateLlmTables(db)

  const store = new EventStore(db)
  const rng = new RngStreams('motive-probe')
  let { state, doors } = buildWorld(store)
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
    // The wood is already in hand: this probe asks about motive, not about gathering.
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
  // Nobody starts the evening already worn out: an exhaustion run measures exhaustion.
  for (const m of MINDS) {
    state = fold(
      state,
      store.append(state.tick, 'need_changed', { id: m.id, need: 'energy', delta: 0 }),
      config,
    )
  }
  void doorTile

  const lawQueue: LawQueue = []
  const worldTick = createWorldTick(config, rng, lawQueue)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store,
    state,
    rng,
    config,
    startTick: START_TICK,
    realMsPerTick: 0,
    onTick: (c) => handler(c),
  })

  const refusals: Array<{ tick: number; id: string; verb: string; reason: string }> = []
  const attempts: Array<{ tick: number; id: string; verb: string; params: string }> = []
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

    // ARM A is main: the `cold` field this lane added is taken straight back off, so the
    // prose falls back to exactly the sentences `645a8d9` produced. Nothing else differs.
    override perception(agentId: string): ReturnType<EngineBridge['perception']> {
      const p = super.perception(agentId)
      if (ARM === 'b' || ARM === 'c') return p
      const { cold: _dropped, ...rest } = p
      return rest as typeof p
    }
  }
  const bridge = new Watched({ loop, store, simConfig: config })
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
  })

  const embedder = await Embedder.create(
    fileURLToPath(new URL('../../../data/models/', import.meta.url)),
  )
  const thoughts: Array<{ tick: number; agentId: string; text: string }> = []
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

  // The same pacing g11 runs at: a sim-minute per 250 real ms, so an ask that takes two
  // seconds spans eight ticks rather than the whole night.
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
  // Only what the RUN raised: the valley's own cabins and wells were folded in at tick zero.
  const events: SimEvent[] = store.readFrom(0).filter((e) => e.tick >= START_TICK)
  const planned = events.filter((e) => e.type === 'structure_planned')
  const completed = events.filter((e) => e.type === 'structure_completed')
  const progressed = events.filter((e) => e.type === 'structure_progressed')
  const entered = events.filter((e) => e.type === 'agent_entered')
  const spoke = events.filter((e) => e.type === 'agent_spoke')
  const byVerb = new Map<string, number>()
  for (const a of attempts) byVerb.set(a.verb, (byVerb.get(a.verb) ?? 0) + 1)
  const cost = db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS c FROM llm_calls').get() as {
    c: number
  }
  const calls = db.prepare('SELECT COUNT(*) AS n FROM llm_calls').get() as { n: number }

  const warmth = Object.fromEntries(
    MINDS.map((m) => [m.id, Number((loop.state.agents[m.id]?.needs.warmth ?? -1).toFixed(1))]),
  )
  // The two things arm B's failure was actually made of, counted rather than inferred: bodies
  // that went down in the street, and acts spent on a door that could never open.
  const collapsed = MINDS.filter((m) => loop.state.agents[m.id]?.collapsedSinceTick != null).length
  const sheltered = MINDS.filter((m) => loop.state.agents[m.id]?.insideId !== undefined).length
  const noWayIn = refusals.filter((r) => /no way into|has no roof/.test(r.reason)).length
  const noFloor = refusals.filter((r) => /no floor left/.test(r.reason)).length
  const ledger = shelterLedger(loop.state, config)

  const report = {
    arm: ARM,
    label: LABEL,
    ticks: TOTAL_TICKS,
    startTick: START_TICK,
    llmCalls: calls.n,
    costUsd: Number(cost.c.toFixed(4)),
    intents: attempts.length,
    byVerb: Object.fromEntries([...byVerb].sort((a, b) => b[1] - a[1])),
    builds: byVerb.get('build') ?? 0,
    structuresPlanned: planned.length,
    structuresCompleted: completed.length,
    structureProgressed: progressed.length,
    entered: entered.length,
    shelterLedger: { ...ledger, per: Number(ledger.per.toFixed(2)) },
    collapsedAtEnd: collapsed,
    shelteredAtEnd: sheltered,
    refusedNoWayIn: noWayIn,
    refusedNoFloor: noFloor,
    spoke: spoke.length,
    refusals: refusals.length,
    refusalsByReason: Object.entries(
      refusals.reduce<Record<string, number>>((acc, r) => {
        acc[r.reason] = (acc[r.reason] ?? 0) + 1
        return acc
      }, {}),
    ).sort((a, b) => b[1] - a[1]),
    // ★ WHICH VERB WAS TURNED AWAY, not just what it was told. The last pass reported 159
    // `already busy with build` and had to read the runtime's source to find out they were all
    // speech. A refusal count whose composition is a guess has measured half of nothing.
    refusalsByVerb: Object.entries(
      refusals.reduce<Record<string, number>>((acc, r) => {
        const k = `${r.verb}: ${r.reason}`
        acc[k] = (acc[k] ?? 0) + 1
        return acc
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12),
    warmthAtEnd: warmth,
    // Every wall in the town at dawn, and how far up it is. "No house finished" is a claim
    // about a distance, and a report that cannot say the distance cannot say what is missing.
    sitesAtEnd: Object.values(loop.state.structures)
      .filter((s) => s.stage === 'construction')
      .map(
        (s) => `${s.kind} ${s.id} ${s.progressTicks}/${buildTicks(config, s.kind)} by ${s.builtBy}`,
      )
      .sort(),
    roofsAtEnd: Object.values(loop.state.structures).filter(
      (s) => s.stage === 'complete' && isRoofedKind(config, s.kind),
    ).length,
    buildIntents: attempts.filter((a) => a.verb === 'build'),
    thoughtsMentioningCold: thoughts.filter((t) =>
      /\bcold|shiver|freez|warm|roof|shelter|walls|night air\b/i.test(t.text),
    ).length,
    thoughts: thoughts.length,
  }
  writeFileSync(path.join(DATA_DIR, `${LABEL}.json`), JSON.stringify(report, null, 2))
  writeFileSync(
    path.join(DATA_DIR, `${LABEL}-thoughts.md`),
    thoughts.map((t) => `- t=${t.tick} **${t.agentId}**: ${t.text}`).join('\n'),
  )
  writeFileSync(
    path.join(DATA_DIR, `${LABEL}-speech.md`),
    spoke.map((e) => `- t=${e.tick} ${JSON.stringify(e.payload)}`).join('\n'),
  )
  console.log(JSON.stringify(report, null, 2))
  // Left open on purpose: a turn still in flight logs its own abandonment, and a closed handle
  // turns that into a crash after the report is already on disk.
}

await main()
