// GATE G11b — the live half of the deep-world gate (addendum §18).
// Five minds on the 128x128 genesis town, two sim-days, a real arbiter with a real materials
// table, a real construct pass, a real chronicle and a real nightly semantic pass. Everything
// the report claims is read back out of the run's own tables and event log.
//
// The ops plane is WIRED HERE OR THE GATE RUNS DARK (batch-7 concern 1, batch-8 concern 1):
// runConstructPass, narrateDay's world and semantic seams, the arbiter's `vocabulary` table
// and reportDeadCalls each have exactly one live caller, and it is this file.
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import {
  applyLaw, buildFootprint, BRIDGE_KIND, createWorldTick, doorTile, EventStore, findPath, fold,
  genesisState, GENESIS_FORD, isPassable, makeGenesisWorld, replayFromGenesis, RngStreams,
  submitIntent, TickLoop, TOGGLABLE_PATHS, thirstOf, WATER_TILES,
  type LawQueue, type TickHandler, type TileId, type WorldState,
} from '@sj/engine'
import {
  chronicleLine, DEFAULT_CONFIG, MINUTES_PER_DAY, stateHash,
  type SimConfig, type SimEvent,
} from '@sj/shared'
// Cross-package by relative path on purpose: @sj/arbiter and @sj/narrator both depend on
// @sj/agents, so a package-level dependency here would close a cycle.
import { makeArbiter } from '../../arbiter/src/adjudicate.js'
import { CodexStore } from '../../arbiter/src/codex.js'
import { ConstructStore } from '../../arbiter/src/constructStore.js'
import { runConstructPass } from '../../arbiter/src/constructs.js'
import { migrateArbiterTables } from '../../arbiter/src/schema.js'
import type { Recipe } from '../../arbiter/src/verdict.js'
import { UNNAMED_CONSTRUCT_COPY } from '../../narrator/src/glass.js'
import { makeNarratorLlm } from '../../narrator/src/llm/narratorLlm.js'
import { narrateDay } from '../../narrator/src/narrate.js'
import { migrateNarratorTables } from '../../narrator/src/schema.js'
import { NarratorStore } from '../../narrator/src/store.js'
import type { TranscriptRecord } from '../../narrator/src/semanticFirsts.js'
import { EngineBridge, type Intent, type SubmitResult } from '../src/runtime/bridge.js'
import { AgentRuntime } from '../src/runtime/agentRuntime.js'
import { buildAgentCtx, wireArbiter, type Adjudicator, type Codifier } from '../src/runtime/arbiterSeam.js'
import { openAgentDb } from '../src/memory/schema.js'
import { PersonalityStore, type PersonalityDoc } from '../src/personality.js'
import { insertAlert, migrateLlmTables } from '../src/llm/callLog.js'
import { LlmClient } from '../src/llm/client.js'
import { checkSpend, reportDeadCalls, reportProviders } from '../src/llm/spendMonitor.js'
import { Embedder } from '../src/memory/embedder.js'
import { makeReflectionLlm } from '../src/reflection.js'
import { MIND_MODEL } from '../src/llm/pins.js'
import type { IdentityCore } from '../src/prompt/assemble.js'
import {
  G11ReportSchema, checkG11Report, chronicleViolations, classifyVerb, median, survivalTax,
  type G11Discretion, type G11Report,
} from '../src/live/g11report.js'

// The user has ratified Baidu Qianfan as the v1 provider (cleanup/c8-cost-plan.md L1).
// OpenRouter's `provider.order` is a PREFERENCE, not an allow-list: `defaultExtraBody` sends
// allow_fallbacks:true and the client exposes no way to turn it off. Recorded as a C8 item in
// the report rather than assumed away.
// `G11_PROVIDER` lets the gate be run twice against the same world with only the routing
// changed, which is the only way to tell a provider's answer rate from a town's behaviour.
const PROVIDER_ORDER = (process.env.G11_PROVIDER ?? 'Baidu').split(',').filter((x) => x.length > 0)
// C11 R20 made this real: false leaves OpenRouter free to fall through to whatever answers,
// true turns `G11_PROVIDER` into an allow-list. Default stays false so this run is routed
// exactly as the last one was, and the A/B is a flag away rather than a code change.
const HARD_PROVIDER_ALLOW_LIST = process.env.G11_HARD_PROVIDER === '1'

// The dry run (plan step 3): every client is a script, and `llm_calls` must be empty at the
// end. It proves the wiring end to end — the tick loop, the seams, the nightly passes and the
// report — for nothing, before a single paid token is spent.
const DRY_RUN = process.env.G11_DRY_RUN === '1'

const TOTAL_TICKS = Number(process.env.G11_TICKS ?? 2 * MINUTES_PER_DAY)
const REAL_MS_PER_TICK = Number(process.env.G11_MS_PER_TICK ?? 250)
// The town wakes at seven: a world that opens at midnight spends its first hours in the dark.
const START_TICK = 7 * 60
// The tick the operator drops the wear threshold. A trail forms inside a two-day window only
// if the number it has to cross is a two-day number — the flip is criterion 6 and 7 at once.
const FLIP_TICK = START_TICK + 120
// The dial the operator drops mid-run. A two-day town walks 80 tiles and retraces none of
// them, so anything above one is unreachable inside the window; §18 asks for a DIALLED-DOWN
// threshold and this is how far down it has to go. What the threshold means exactly — worn at
// it, not one footfall before — is G11a-W5's row, offline and on real walking.
const WEAR_THRESHOLD = Number(process.env.G11_WEAR ?? 1)
// STOP-and-report tripwire, not a cap (controller: no per-task cap on this batch).
const TRIPWIRE_USD_PER_MIND_SIM_HOUR = 20
const TICK_BUDGET_MS = 50

const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url))
const DB_PATH = path.join(DATA_DIR, 'g11.db')
const REPORT_PATH = path.join(DATA_DIR, 'g11-report.json')
const TRANSCRIPT_PATH = path.join(DATA_DIR, 'g11-transcript.md')
const MODELS_DIR = fileURLToPath(new URL('../../../data/models/', import.meta.url))

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// The per-tick bookkeeping a day produces tens of thousands of, and which no scene, heat score
// or milestone reads. `narrateDay` segments and digests whatever it is handed, so a caller that
// hands it the raw stream builds a prompt out of every need a body felt all day. This is the
// caller's filter and it is deliberately NOT `NOT_CHRONICLED` — that set says which events get
// a chronicle LINE, and it drops half of what the milestone detectors match on.
const SEMANTIC_RECORD_CAP = 300
const NARRATOR_NOISE: ReadonlySet<string> = new Set([
  'tick_advanced', 'need_changed', 'thirst_changed', 'hp_changed', 'agent_moved', 'agent_aged',
  'action_progressed', 'structure_progressed', 'fauna_moved', 'traffic_decayed', 'skill_gained',
])

const NO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }

// A model that never leaves the process. It answers each schema with the smallest value that
// parses, which is all the wiring needs to be exercised; nothing it returns is evidence.
class DryLlm {
  constructor(private readonly db: Database.Database, private readonly agentId: string | null) {}

  async object<T>(opts: { schema: { safeParse(v: unknown): { success: boolean; data?: T } } }): Promise<{ value: T; usage: typeof NO_USAGE }> {
    for (const candidate of dryAnswers()) {
      const parsed = opts.schema.safeParse(candidate)
      if (parsed.success) return { value: parsed.data as T, usage: NO_USAGE }
    }
    throw new Error('dry run: no canned answer fits this schema')
  }

  async text(): Promise<{ text: string; usage: typeof NO_USAGE }> {
    return { text: 'the day passes', usage: NO_USAGE }
  }

  totalCostUsd(): number { return 0 }
  alert(kind: string, detail: string): void { insertAlert(this.db, { agentId: this.agentId, kind, detail }) }
}

// The canned answers, in the order they are tried. Each is the smallest object that satisfies
// one of the schemas this run assembles; the turn cycles its act so the buckets, the trail and
// the water line are all exercised for nothing.
let dryTurn = 0
const DRY_ACTS: Array<{ verb: string; params: Record<string, unknown> }> = [
  { verb: 'speak', params: { text: 'morning' } },
  { verb: 'walk', params: { x: 62, y: 70 } },
  { verb: 'walk', params: { x: 62, y: 62 } },
  { verb: 'drink', params: {} },
]
const dryAnswers = (): unknown[] => {
  const act = DRY_ACTS[dryTurn++ % DRY_ACTS.length]!
  return [
    { thought: 'the day is here', importance: 3, speech: 'morning', action: act },
    { title: 'A day', text: 'The day passed.', citations: [] },
    { hits: [] },
    { rulings: [] },
    { word: 'hum', sense: 'sound', durationTicks: 5, energyCost: 1, targeted: false, emote: 'hums a little' },
    { kind: 'impossible', reason: 'not in a dry run', class: 'physically_impossible' },
    {},
  ]
}

function makeClient(db: Database.Database, caller: string, agentId?: string): LlmClient {
  if (DRY_RUN) return new DryLlm(db, agentId ?? null) as unknown as LlmClient
  return new LlmClient({
    db, caller, ...(agentId === undefined ? {} : { agentId }),
    providerOrder: PROVIDER_ORDER, allowProviderFallbacks: !HARD_PROVIDER_ALLOW_LIST,
  })
}

// ---------------------------------------------------------------- the minds ---

type Mind = { id: string; identity: IdentityCore; personality: PersonalityDoc; ageDays: number; sex: 'f' | 'm' }

const voice = (
  register: string, rhythm: string, tics: string[], neverSays: string[],
  exampleLines: string[], typical: number, burst: number,
): IdentityCore['voiceCard'] => ({ register, rhythm, tics, neverSays, exampleLines, wordBudget: { typical, burst } })

const MINDS: Mind[] = [
  {
    id: 'amara', sex: 'f', ageDays: 34 * 364,
    identity: {
      name: 'Amara', age: 34,
      backstory: 'Keeps the storehouse tally in her head and has never once been wrong about it. Came to this valley first and put the well where the well is.',
      temperament: 'steady, exacting, slow to warm',
      voiceCard: voice('plain and precise, names the thing', 'short, then done', ['counts aloud'], ['flattery'],
        ['The store holds four days.', 'Put it back where it was.'], 12, 22),
    },
    personality: {
      temperament: 'steady, exacting, slow to warm',
      values: ['a full store', 'water within reach'],
      beliefs: ['what is counted keeps'],
      current: { mood: 'dry-mouthed and watchful', worries: ['your throat is parched and there is a well in the middle of town'], goals: ['drink — the well is a short walk and you can drink straight from it', 'see what is in the storehouse'] },
    },
  },
  {
    id: 'yusuf', sex: 'm', ageDays: 41 * 364,
    identity: {
      name: 'Yusuf', age: 41,
      backstory: 'A carpenter with a grudge against the river, which took his first bridge. He has been eyeing the narrows north of town since the spring.',
      temperament: 'stubborn, generous with his hands, quiet about it',
      voiceCard: voice('warm and practical', 'two sentences, then work', ['says "aye"'], ['long speeches'],
        ['Aye. I will cut it today.', 'The narrows will take a deck.'], 14, 26),
    },
    personality: {
      temperament: 'stubborn, generous with his hands, quiet about it',
      values: ['good joinery', 'a crossing'],
      beliefs: ['a river you cannot cross is a wall'],
      current: { mood: 'set on it', worries: ['the far bank is a day away'], goals: ['walk north and look at the narrows', 'cut timber for a deck'] },
    },
  },
  {
    id: 'nadia', sex: 'f', ageDays: 29 * 364,
    identity: {
      name: 'Nadia', age: 29,
      backstory: 'Walks the whole valley most days and knows where the berries are before anyone else does. Hates a muddy track.',
      temperament: 'restless, cheerful, impatient',
      voiceCard: voice('bright and quick', 'runs on when she is pleased', ['calls the path "the way"'], ['self-pity'],
        ['The bushes are heavy out east.', 'This way is all mud again.'], 22, 36),
    },
    personality: {
      temperament: 'restless, cheerful, impatient',
      values: ['nothing wasted', 'a dry way home'],
      beliefs: ['feet make the road'],
      current: { mood: 'in a hurry and hungry', worries: ['the berries will go over and there is nothing in your hands'], goals: ['walk to the berry bushes out at (62, 44) — you have known them for years — and gather from them', 'eat what you gather, and take a handful back'] },
    },
  },
  {
    id: 'omar', sex: 'm', ageDays: 46 * 364,
    identity: {
      name: 'Omar', age: 46,
      backstory: 'The nearest thing this town has to a healer. Keeps herbs in his hut and has sat up with more sick people than he can name.',
      temperament: 'gentle, unhurried, hard to alarm',
      voiceCard: voice('low and calm', 'pauses before he answers', ['says "now then"'], ['alarm'],
        ['Now then. Sit down.', 'It will pass, or it will not.'], 16, 28),
    },
    personality: {
      temperament: 'gentle, unhurried, hard to alarm',
      values: ['sitting with the sick', 'a herb within reach'],
      beliefs: ['a fever answers to a hand more than to a remedy'],
      current: { mood: 'attentive', worries: ['somebody is ill and nobody has said so'], goals: ['look in on the others and tend anyone who is unwell', 'at dusk you bow your head over the sick, the way you were taught — it costs nothing and changes nothing'] },
    },
  },
  {
    id: 'salma', sex: 'f', ageDays: 26 * 364,
    identity: {
      name: 'Salma', age: 26,
      backstory: 'Sings at her work, which the others have stopped remarking on. She woke this morning with a fever she has told nobody about.',
      temperament: 'private, wry, does not complain',
      voiceCard: voice('dry and glancing', 'a line, then a shrug', ['understates'], ['complaint'],
        ['It is nothing.', 'I have had worse.'], 11, 20),
    },
    personality: {
      temperament: 'private, wry, does not complain',
      values: ['carrying your own weight'],
      beliefs: ['a thing named is a thing made worse'],
      current: { mood: 'hot and shivering', worries: ['you are ill and you do not want to be a burden'], goals: ['sing over your work — not talking, singing, the way you always have', 'keep at your work'] },
    },
  },
]
const SICK_ONE = 'salma'
const PARCHED_ONE = 'amara'

function seedCodex(db: Database.Database): void {
  const codex = new CodexStore(db)
  const known: Array<[string, string]> = [
    ['fire', 'Fire'], ['pottery', 'Pottery'], ['cordage', 'Cordage'], ['weaving', 'Weaving'],
    ['woodworking', 'Woodworking'], ['stone_knapping', 'Stone knapping'], ['farming', 'Farming'],
    ['hearth_cooking', 'Hearth cooking'], ['fishing', 'Fishing'], ['foraging', 'Foraging'],
  ]
  for (const [id, name] of known) codex.insert({ id, era: 'agriculture', name, prerequisiteId: null })
  for (const [id, name, prerequisiteId] of [
    ['bridging', 'Bridging', 'woodworking'],
    ['tanning', 'Tanning', 'cordage'],
    ['smoking_food', 'Smoking food', 'fire'],
  ] as Array<[string, string, string]>) {
    codex.insert({ id, era: 'crafts', name, prerequisiteId, known: false })
  }
}

// ------------------------------------------------------------ instrumentation ---

type Rejection = { tick: number; agentId: string; verb: string; reason: string }

class WatchedBridge extends EngineBridge {
  readonly rejections: Rejection[] = []
  readonly accepted: Array<{ tick: number; agentId: string; verb: string }> = []
  #tick: () => number = () => 0

  watchTicks(tick: () => number): void { this.#tick = tick }

  override submit(agentId: string, intent: Intent, onResult?: (r: SubmitResult) => void): Promise<SubmitResult> {
    return super.submit(agentId, intent, (r) => {
      if (r.ok) this.accepted.push({ tick: this.#tick(), agentId, verb: intent.verb })
      else this.rejections.push({ tick: this.#tick(), agentId, verb: intent.verb, reason: r.reason })
      onResult?.(r)
    })
  }
}

const qInt = (db: Database.Database, sql: string, ...p: unknown[]): number =>
  Number(db.prepare(sql).pluck().get(...p))
const qRows = <T>(db: Database.Database, sql: string, ...p: unknown[]): T[] =>
  db.prepare(sql).all(...p) as T[]

const payloadOf = (e: SimEvent): Record<string, unknown> => (e.payload ?? {}) as Record<string, unknown>

// ------------------------------------------------------------------- the run ---

async function main(): Promise<void> {
  if (!DRY_RUN && !process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set (run with node --env-file=<repo>/.env)')
    process.exit(2)
  }
  mkdirSync(DATA_DIR, { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })

  const config: SimConfig = DEFAULT_CONFIG
  const db = openAgentDb(DB_PATH)
  migrateLlmTables(db)
  migrateArbiterTables(db)
  migrateNarratorTables(db)
  seedCodex(db)

  const { terrain, events: genesisEvents } = makeGenesisWorld(config)
  const store = new EventStore(db)
  const rng = new RngStreams('g11-deep-world')
  let state = genesisState(config, terrain)
  const emit = (type: string, payload: unknown): void => {
    state = fold(state, store.append(state.tick, type, payload), config)
  }
  for (const e of genesisEvents) emit(e.type, e.payload)

  // The five founders, each at their own doorway.
  for (const m of MINDS) {
    const hut = Object.values(state.structures).find((s) => s.kind === 'hut' && s.owner === m.id)
    if (hut === undefined) throw new Error(`genesis: no hut owned by ${m.id}`)
    const door = doorTile(state, hut)
    if (door === null) throw new Error(`genesis: no doorway on ${m.id}'s hut`)
    emit('agent_spawned', { id: m.id, name: m.identity.name, x: door.x, y: door.y, sex: m.sex, ageDays: m.ageDays })
  }
  // The staged affliction: one founder wakes on day zero with a fever nobody has been told
  // about. Recovery or death both pass the criterion; silence does not.
  emit('agent_afflicted', { agentId: SICK_ONE, kind: 'illness', severity: 1 })
  // A staged thirst, the same device: the clock runs at 0.021 a tick, so a body that starts
  // full does not reach the debuff line until day three and a two-sim-day window can never
  // show the criterion. One founder wakes already dry, and crosses it before noon on day one.
  emit('thirst_changed', { id: PARCHED_ONE, delta: -65 })

  // --- the loop, the bridge, the law channel ---
  const lawQueue: LawQueue = []
  const worldTick = createWorldTick(config, rng, lawQueue)
  const tickMs: number[] = []
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store, state, rng, config, startTick: START_TICK, realMsPerTick: REAL_MS_PER_TICK,
    onTick: (ctx) => handler(ctx),
  })
  const bridge = new WatchedBridge({ loop, store, simConfig: config })
  bridge.watchTicks(() => loop.tick)
  handler = bridge.wrapTickHandler(({ emit: e }) => {
    const at = performance.now()
    for (const ev of worldTick(loop.state).events) e(ev.type, ev.payload)
    tickMs.push(performance.now() - at)
  })

  // --- the minds ---
  const embedder = await Embedder.create(MODELS_DIR)
  const thoughts: Array<{ tick: number; agentId: string; text: string }> = []
  const runtimes = new Map<string, AgentRuntime>()
  let seam: { adjudicate: Adjudicator; codify: Codifier } | null = null

  function boot(spec: Mind): void {
    const personality = new PersonalityStore(db, spec.id)
    personality.init(spec.personality, Math.floor(loop.tick / MINUTES_PER_DAY))
    const turnLlm = makeClient(db, 'turn', spec.id)
    const reflectionLlm = makeReflectionLlm(makeClient(db, 'reflection', spec.id))
    const runtime = new AgentRuntime({
      db, llm: turnLlm, embedder, identity: spec.identity, personality, bridge, reflectionLlm,
      onThought: (t) => thoughts.push(t),
    })
    runtime.start(spec.id)
    if (seam !== null) wireArbiter(runtime, seam)
    runtimes.set(spec.id, runtime)
  }
  for (const m of MINDS) boot(m)

  // --- the arbiter, WITH the materials table it has never had a caller for ---
  // batch-8 concern 2: the item and structure halves of the sanity gate only bite when a
  // caller passes `deps.vocabulary`, and only this runner can.
  const VOCABULARY = {
    itemKinds: [
      'wood', 'stone', 'rope', 'cloth', 'fiber', 'hide', 'clay', 'axe', 'hoe', 'knife',
      'seed_pouch', 'waterskin', 'bucket', 'torch', 'garment', 'plank', 'bread', 'wheat',
      'fish', 'venison', 'rabbit_meat', 'berries', 'mushroom', 'herb', 'stew',
    ],
    structureKinds: ['hut', 'storehouse', 'shed', 'wagon', 'well', 'fire_pit', 'bridge', 'grave'],
  }
  const arbiterLlm = makeClient(db, 'arbiter')
  const arbiter = makeArbiter({
    db, llm: arbiterLlm, embedder, tick: () => loop.tick, vocabulary: VOCABULARY,
  })
  const adjudications: Array<{ tick: number; agentId: string; intent: string; kind: string; verb: string | null }> = []
  const watched = {
    adjudicate: async (intent: string, ctx: Parameters<typeof arbiter.adjudicate>[1]) => {
      const verdict = await arbiter.adjudicate(intent, ctx)
      adjudications.push({
        tick: loop.tick, agentId: ctx.agentId, intent, kind: verdict.kind,
        verb: verdict.kind === 'map' ? verdict.verb : null,
      })
      return verdict
    },
    codify: (recipe: { id: string }) => arbiter.codify(recipe as Recipe),
  }
  seam = watched
  for (const runtime of runtimes.values()) wireArbiter(runtime, watched)

  // --- the narrator, the recognizer and the dead-call report: one caller each ---
  const narratorStore = new NarratorStore(db)
  const constructStore = new ConstructStore(db)
  const narratorLlm = makeNarratorLlm(makeClient(db, 'narrator'))
  const semanticLlm = makeClient(db, 'semantic')
  const constructLlm = makeClient(db, 'constructs')

  let narrateErrors = 0
  let constructErrors = 0
  let semanticRan = false
  let semanticErrors = 0
  const semanticHits: string[] = []
  const nightsRun: number[] = []

  // What a mind said and what it thought, for the tier-2.5 pass. Speech is a public event;
  // thoughts come off the runtime's own callback, which is the only place they exist.
  function transcriptFor(day: number, allEvents: SimEvent[]): TranscriptRecord[] {
    const spoken: TranscriptRecord[] = allEvents
      .filter((e) => e.type === 'agent_spoke' && Math.floor(e.tick / MINUTES_PER_DAY) === day)
      .map((e) => ({
        sourceKind: 'speech' as const, agentId: String(payloadOf(e).agentId), day, tick: e.tick,
        text: String(payloadOf(e).text), eventSeq: e.seq,
      }))
    const thought: TranscriptRecord[] = thoughts
      .filter((t) => Math.floor(t.tick / MINUTES_PER_DAY) === day)
      .map((t, i) => ({
        sourceKind: 'thought' as const, agentId: t.agentId, day, tick: t.tick,
        text: t.text, memoryRef: `thought:${day}:${i}`,
      }))
    // Bounded, so one very loud day cannot build an unbounded prompt: the most recent words
    // are the ones a first is most likely to be in, and the cap is never reached live.
    const all = [...spoken, ...thought].sort((a, b) => a.tick - b.tick)
    return all.slice(-SEMANTIC_RECORD_CAP)
  }

  async function closeTheDay(day: number): Promise<void> {
    nightsRun.push(day)
    const allEvents = store.readFrom(0)
    const dayEvents = allEvents
      .filter((e) => Math.floor(e.tick / MINUTES_PER_DAY) === day)
      .filter((e) => !NARRATOR_NOISE.has(e.type))

    // 1 — the recognizer's daily pass (batch-7 ruling 1).
    try {
      await runConstructPass({
        events: allEvents, baseConfig: config, store: constructStore, llm: constructLlm,
        laws: loop.state.laws,
      })
    } catch (err) { constructErrors += 1; console.error(`[g11] construct pass day ${day}:`, err) }

    // 2 — the chronicle, with BOTH seams: the world (so tier 2 can read relationships) and
    // the nightly semantic pass (so tier 2.5 runs at all).
    if (dayEvents.length > 0) {
      const records = transcriptFor(day, allEvents)
      console.log(`[g11] closing day ${day}: ${dayEvents.length} events to narrate, ${records.length} records to read`)
      try {
        const out = await narrateDay({
          store: narratorStore, llm: narratorLlm, events: dayEvents,
          rulebookCount: qInt(db, 'SELECT COUNT(*) FROM rulebook'),
          privateCounts: { thoughts: thoughts.filter((t) => Math.floor(t.tick / MINUTES_PER_DAY) === day).length, journals: 0 },
          world: { config, state: loop.state },
          ...(records.length === 0 ? {} : {
            semantic: { db, llm: semanticLlm, records, spentUsdToday: 0 },
          }),
        })
        if (records.length > 0) semanticRan = true
        for (const m of out.milestones) if (m.tier === 2.5) semanticHits.push(m.kind)
      } catch (err) {
        narrateErrors += 1
        if (records.length > 0) semanticErrors += 1
        console.error(`[g11] narrateDay day ${day}:`, err)
      }
    }

    // 3 — the dead-call report (batch-8 concern 1). Silent on a clean day, by design.
    reportDeadCalls(db)
  }

  // --- the run ---
  const spendProjections: Array<{ tick: number; usdPerSimDay: number }> = []
  const fullNeedSamples = new Map<string, number>()
  let lastDayClosed = Math.floor(START_TICK / MINUTES_PER_DAY)
  let tripwireHit = false
  const totalSpend = (): number => qInt(db, 'SELECT COALESCE(SUM(cost_usd), 0) FROM llm_calls')

  console.log(`[g11] model=${MIND_MODEL} provider=${PROVIDER_ORDER.join(',')}`
    + ` allowList=${HARD_PROVIDER_ALLOW_LIST} ticks=${TOTAL_TICKS}`
    + ` pace=${REAL_MS_PER_TICK}ms minds=${MINDS.length} (no cap; tripwire $${TRIPWIRE_USD_PER_MIND_SIM_HOUR}/mind/sim-hour)`)
  const startWall = Date.now()

  for (let i = 0; i < TOTAL_TICKS; i += 1) {
    const stepStart = Date.now()
    loop.step()

    if (loop.tick === FLIP_TICK) {
      // The one operator flip: the wear threshold, dropped so a trail can form inside a
      // two-day window. It is a whitelisted law, it lands as `config_changed`, and it replays.
      applyLaw(lawQueue, 'desirePaths.wearThreshold', WEAR_THRESHOLD)
      console.log(`[g11] tick ${loop.tick}: operator sets desirePaths.wearThreshold = ${WEAR_THRESHOLD}`)
    }

    if (loop.tick % 10 === 0) {
      for (const id of Object.keys(loop.state.agents)) {
        const a = loop.state.agents[id]!
        if (!a.alive) continue
        const floor = config.needs.debuffThreshold
        const full = a.needs.hunger >= floor && a.needs.energy >= floor
          && a.needs.warmth >= floor && a.needs.social >= floor && thirstOf(a) >= floor
          && (a.afflictions?.length ?? 0) === 0
        if (full) fullNeedSamples.set(id, (fullNeedSamples.get(id) ?? 0) + 1)
      }
    }

    if (loop.tick % 60 === 0) {
      const p = checkSpend(db, { windowRealMinutes: 15 })
      spendProjections.push({ tick: loop.tick, usdPerSimDay: p.usdPerSimDay })
      // The tripwire: $/mind/sim-hour, read off the same projection.
      const perMindSimHour = p.usdPerSimDay / MINDS.length / 24
      if (perMindSimHour > TRIPWIRE_USD_PER_MIND_SIM_HOUR) {
        tripwireHit = true
        console.error(`STOP: $${perMindSimHour.toFixed(2)}/mind/sim-hour past the $${TRIPWIRE_USD_PER_MIND_SIM_HOUR} tripwire`)
        break
      }
    }

    const day = Math.floor(loop.tick / MINUTES_PER_DAY)
    if (day > lastDayClosed) {
      await closeTheDay(lastDayClosed)
      lastDayClosed = day
    }

    if (loop.tick % 240 === 0) {
      const mins = ((Date.now() - startWall) / 60_000).toFixed(1)
      const turns = [...runtimes.values()].reduce((s, r) => s + r.stats().turns, 0)
      console.log(`[g11] tick ${loop.tick}/${START_TICK + TOTAL_TICKS} (${mins} min, turns=${turns}, $${totalSpend().toFixed(4)})`)
    }
    await sleep(Math.max(0, REAL_MS_PER_TICK - (Date.now() - stepStart)))
  }

  // Let a reflection begun near the end finish, then let everything settle.
  const reflectionDeadline = Date.now() + 300_000
  while ([...runtimes.values()].some((r) => r.reflectionInFlight()) && Date.now() < reflectionDeadline) await sleep(2000)
  let lastLlmId = qInt(db, 'SELECT COALESCE(MAX(id), 0) FROM llm_calls')
  const settleDeadline = Date.now() + 60_000
  while (Date.now() < settleDeadline) {
    await sleep(2000)
    const nowId = qInt(db, 'SELECT COALESCE(MAX(id), 0) FROM llm_calls')
    if (nowId === lastLlmId) break
    lastLlmId = nowId
  }
  await closeTheDay(lastDayClosed)

  for (const runtime of runtimes.values()) runtime.stop()
  const drainedIntents = bridge.drain('the moment passes')
  const drainedAgainCount = bridge.drain()

  if (tripwireHit) {
    console.error(`TRIPWIRE: stopped at tick ${loop.tick} with $${totalSpend().toFixed(4)} spent`)
    process.exit(1)
  }

  // --------------------------------------------------------------- evidence ---
  const allEvents = store.readFrom(0)
  const finalState: WorldState = loop.state
  const simDays = TOTAL_TICKS / MINUTES_PER_DAY

  // --- the cheap word, and a SECOND body using it for nothing ---
  const expressiveVerbs = [...new Set(adjudications
    .filter((a) => a.verb !== null && a.verb.startsWith('express:'))
    .map((a) => a.verb!))]
  const firstExpressive = adjudications.find((a) => a.verb !== null && a.verb.startsWith('express:')) ?? null
  let reusedBy: string | null = null
  let reuseArbiterCalls = 0
  if (firstExpressive !== null) {
    const other = MINDS.map((m) => m.id)
      .find((id) => id !== firstExpressive.agentId && finalState.agents[id]?.alive === true)
    if (other !== undefined) {
      const before = qInt(db, `SELECT COUNT(*) FROM llm_calls WHERE caller = 'arbiter'`)
      try {
        const again = await arbiter.adjudicate(firstExpressive.intent, buildAgentCtx(bridge, other))
        if (again.kind === 'map' && again.verb === firstExpressive.verb) reusedBy = other
      } catch (err) { console.error('[g11] the reuse adjudication threw:', err) }
      reuseArbiterCalls = qInt(db, `SELECT COUNT(*) FROM llm_calls WHERE caller = 'arbiter'`) - before
    }
  }

  // --- the chronicle, over every C11 event that fired ---
  const C11_TYPES = new Set([
    'agent_afflicted', 'affliction_worsened', 'affliction_recovered', 'agent_tended', 'agent_died',
    'grave_placed', 'thirst_changed', 'agent_drank', 'hp_changed', 'tile_changed', 'world_grown',
    'fauna_spawned', 'fauna_moved', 'fauna_killed', 'fauna_stock_changed', 'forageable_spawned',
    'forageable_stock_changed', 'forageable_depleted', 'forageable_regrown', 'traffic_decayed',
    'item_lit', 'item_snuffed', 'item_burned_out', 'structure_fueled', 'item_equipped',
    'item_unequipped', 'item_filled', 'agent_expressed', 'fire_extinguished',
  ])
  const look = {
    agentName: (id: string) => finalState.agents[id]?.name ?? id,
    structureKind: (id: string) => finalState.structures[id]?.kind ?? 'building',
    mysteryProse: () => null,
  }
  const c11Events = allEvents.filter((e) => C11_TYPES.has(e.type))
  const lines = c11Events.map((e) => chronicleLine(e, look)).filter((l): l is string => l !== null)
  const violations = chronicleViolations(lines)

  // --- feet, and the trail they wore ---
  const trafficValues = Object.values(finalState.traffic ?? {})
  const tilesWorn = allEvents.filter((e) => e.type === 'tile_changed'
    && payloadOf(e).reason === 'worn').length

  // --- the three named world assertions ---
  // Each is asked of a FRESH body dropped into a copy of the town the run left standing: a
  // founder who has been on her feet for two days answers about her own legs, not the river.
  const PROBE = 'probe_walker'
  const probeWorld = (at: { x: number; y: number }, extra: Array<[string, unknown]> = []): WorldState => {
    let s: WorldState = { ...finalState }
    const put = (type: string, payload: unknown): void => {
      s = fold(s, { seq: -1, tick: s.tick, type, payload }, config)
    }
    put('agent_spawned', { id: PROBE, name: 'probe', x: at.x, y: at.y, ageDays: 7300 })
    for (const [type, payload] of extra) put(type, payload)
    return s
  }

  // The spit narrows the channel to two tiles: at a ford row the water is x 48 and 49 and the
  // spit at x 50 is the bank on the town's side. The deck spans the water, not the sand.
  //
  // A run in which the map grew has moved every coordinate the genesis constants name — the
  // fold shifts the world when it widens north or west — so the ford is wherever the growths
  // put it. Run 4 of this gate failed C and D for exactly this and nothing else.
  const shift = allEvents.filter((e) => e.type === 'world_grown').reduce((acc, e) => {
    const p = payloadOf(e) as { edge?: string; depth?: number }
    return {
      dx: acc.dx + (p.edge === 'w' ? p.depth ?? 0 : 0),
      dy: acc.dy + (p.edge === 'n' ? p.depth ?? 0 : 0),
    }
  }, { dx: 0, dy: 0 })
  const spit = { x: GENESIS_FORD.x + shift.dx, y: GENESIS_FORD.y0 + shift.dy }
  const fordAt = { x: spit.x - 2, y: spit.y }
  if (shift.dx !== 0 || shift.dy !== 0) {
    console.log(`[g11] the world grew: the ford has moved by (${shift.dx}, ${shift.dy}) to (${fordAt.x}, ${fordAt.y})`)
  }
  const fordProbe = (() => {
    const stood = probeWorld({ x: spit.x, y: fordAt.y }, [
      ['item_spawned', { id: 'probe_wood', kind: 'wood', qty: 20, loc: { t: 'agent', id: PROBE } }],
    ])
    const foot = buildFootprint(stood, config, PROBE, { kind: BRIDGE_KIND, ...fordAt })
    return { ...fordAt, buildable: foot.refusal === null, refusal: foot.refusal }
  })()

  const farBank = (() => {
    // The town stands east of the river, so the far bank is the west one — a bridge away, and
    // the legs are asked for it anyway (batch-6 ruling 1: stopping at the shore is correct
    // physics, not a path bug).
    const y = fordAt.y
    const s = probeWorld({ x: spit.x, y })
    const asked = submitIntent(s, config, PROBE, 'walk', { x: fordAt.x - 6, y })
    let edge: { x: number; y: number } | null = null
    for (let x = spit.x; x >= fordAt.x - 6; x--) {
      if (!isPassable(s, x, y)) break
      if (findPath(s, s.agents[PROBE]!, { x, y }, config) === null) break
      edge = { x, y }
    }
    const nextIsWater = edge !== null && WATER_TILES.has(s.terrain[edge.y]?.[edge.x - 1] ?? 0)
    return { refused: !asked.ok, reason: asked.ok ? null : asked.reason, stoppedAtWaterEdge: nextIsWater }
  })()

  // The winter ladder, probed on the town the run actually left standing (batch-5 ruling 1):
  // three fresh bodies, one deep-winter night, and the cold ticks each of them was billed.
  const clothedSurvive = (() => {
    const NIGHT = 3 * 91 * MINUTES_PER_DAY + 22 * 60
    const hut = Object.values(finalState.structures).find((x) => x.kind === 'hut')
    const fire = Object.values(finalState.structures).find((x) => x.kind === 'fire_pit')
    if (hut === undefined || fire === undefined) return false
    const door = doorTile(finalState, hut)
    if (door === null) return false
    let s: WorldState = { ...finalState, tick: NIGHT - 1 }
    const put = (type: string, payload: unknown): void => {
      s = fold(s, { seq: -1, tick: NIGHT - 1, type, payload }, config)
    }
    put('agent_spawned', { id: 'probe_bare', name: 'probe_bare', x: door.x + 3, y: door.y + 3, ageDays: 7300 })
    put('agent_spawned', { id: 'probe_inside', name: 'probe_inside', x: door.x, y: door.y, ageDays: 7300 })
    put('agent_spawned', { id: 'probe_hearth', name: 'probe_hearth', x: fire.x + 1, y: fire.y, ageDays: 7300 })
    put('agent_entered', { agentId: 'probe_inside', structureId: hut.id })
    put('structure_fueled', { structureId: fire.id, burnsUntilTick: NIGHT + 8 * 60 + 1 })
    for (const id of ['probe_bare', 'probe_inside', 'probe_hearth']) {
      put('item_spawned', { id: `probe_coat_${id}`, kind: 'garment', qty: 1, loc: { t: 'agent', id } })
      put('item_equipped', { agentId: id, itemId: `probe_coat_${id}`, slot: 'body' })
      put('agent_slept', { agentId: id })
    }
    const probeTick = createWorldTick(config, new RngStreams('g11-ladder'))
    for (let t = NIGHT; t < NIGHT + 8 * 60; t++) {
      s = probeTick(fold({ ...s, tick: t - 1 }, { seq: -1, tick: t, type: 'tick_advanced', payload: {} }, config)).state
    }
    const cold = (id: string): number => s.agents[id]?.coldTicksSinceRecovery ?? 0
    const alive = (id: string): boolean => s.agents[id]?.alive === true
    console.log(`[g11] winter ladder: bare cold=${cold('probe_bare')} warmth=${s.agents.probe_bare!.needs.warmth.toFixed(1)};`
      + ` inside cold=${cold('probe_inside')} warmth=${s.agents.probe_inside!.needs.warmth.toFixed(1)};`
      + ` hearth cold=${cold('probe_hearth')} warmth=${s.agents.probe_hearth!.needs.warmth.toFixed(1)}`)
    // Four walls and a fed fire are each an answer to the cold; bare ground is not.
    return alive('probe_inside') && alive('probe_hearth') && alive('probe_bare')
      && cold('probe_inside') === 0 && cold('probe_hearth') === 0
      && s.agents.probe_bare!.needs.warmth < s.agents.probe_inside!.needs.warmth
  })()

  // --- the measurements (batch-3 r5, batch-4 r5), taken on a GROWN map ---
  const grown = (() => {
    const w = finalState.terrain[0]!.length
    const strip = Array.from({ length: config.mapGrowth.step }, () =>
      Array.from({ length: w }, (): TileId => 0))
    return fold(finalState, {
      seq: -1, tick: finalState.tick, type: 'world_grown',
      payload: { edge: 'n', depth: config.mapGrowth.step, tiles: strip },
    }, config)
  })()
  const snapshotBytes = JSON.stringify(grown).length
  const foldStart = performance.now()
  const replayed = replayFromGenesis(store, config, terrain)
  const foldMs = performance.now() - foldStart
  const replayHashMatches = stateHash(replayed) === stateHash(finalState)

  // --- discretionary time, per mind per sim-day (controller ruling 2026-08-17) ---
  const started = allEvents.filter((e) => e.type === 'action_started')
  const completed = allEvents.filter((e) => e.type === 'action_completed')
  const discretion: G11Discretion[] = []
  const days = [...new Set(allEvents.map((e) => Math.floor(e.tick / MINUTES_PER_DAY)))].sort((a, b) => a - b)
  for (const m of MINDS) {
    for (const day of days) {
      const mine = started.filter((e) => payloadOf(e).agentId === m.id && Math.floor(e.tick / MINUTES_PER_DAY) === day)
      if (mine.length === 0) continue
      const bucket = { survival: 0, production: 0, social: 0, other: 0 }
      for (const e of mine) bucket[classifyVerb(String(payloadOf(e).verb))] += 1
      discretion.push({
        agentId: m.id, day, turns: mine.length, ...bucket,
        mealsEaten: completed.filter((e) => payloadOf(e).agentId === m.id
          && payloadOf(e).verb === 'eat' && Math.floor(e.tick / MINUTES_PER_DAY) === day).length,
        fullNeedTicks: (fullNeedSamples.get(m.id) ?? 0) * 10,
      })
    }
  }
  // What a body actually has to eat in a day to stay level, from the world's own numbers.
  const mealsNeeded = (config.needs.hungerDecayPerTick * MINUTES_PER_DAY) / config.needs.eatRestoreHunger

  // --- what a gather produced, and whether any of it was ever eaten ---
  // §18 asks for a forage, hunt or fish "yielding food that gets eaten", which is one fact
  // and not two counts: the item a gather spawned has to be the item somebody swallowed.
  const gathered = (() => {
    const GATHER_VERBS = new Set(['forage', 'fish', 'hunt', 'harvest'])
    const fromGathering = new Set<string>()
    let acts = 0
    for (let i = 0; i < allEvents.length; i++) {
      const e = allEvents[i]!
      if (e.type !== 'action_completed' || !GATHER_VERBS.has(String(payloadOf(e).verb))) continue
      acts += 1
      // The spawns a gather emits land straight after its own completion, on the same tick.
      for (let j = i + 1; j < allEvents.length && allEvents[j]!.tick === e.tick; j++) {
        if (allEvents[j]!.type === 'item_spawned') fromGathering.add(String(payloadOf(allEvents[j]!).id))
      }
    }
    const eaten = allEvents.filter((e) => e.type === 'action_completed' && payloadOf(e).verb === 'eat')
      .filter((e) => {
        const before = allEvents.filter((x) => x.type === 'item_qty_changed' && x.tick === e.tick)
        return before.some((x) => fromGathering.has(String(payloadOf(x).id)))
      }).length
    return { acts, eaten }
  })()

  // --- the response to the sick founder ---
  // A visible response is a hand, a thing put into her hands, or her name in somebody's
  // mouth (plan §18: tend, herb, or witnessed avoidance — recovery and death both pass,
  // silence does not). The window is the stretch she was actually ill for.
  const illFrom = 0
  const illTo = allEvents.find((e) => e.type === 'affliction_recovered' && payloadOf(e).agentId === SICK_ONE)?.tick
    ?? allEvents.find((e) => e.type === 'agent_died' && payloadOf(e).agentId === SICK_ONE)?.tick
    ?? Infinity
  const sickName = MINDS.find((m) => m.id === SICK_ONE)!.identity.name
  const stagedResponses = allEvents
    .filter((e) => e.tick >= illFrom && e.tick <= illTo)
    .filter((e) => {
      const p = payloadOf(e)
      if (e.type === 'agent_tended' && p.agentId === SICK_ONE) return true
      if (e.type === 'item_moved') {
        const loc = p.loc as { t?: string; id?: string } | undefined
        return loc?.t === 'agent' && loc.id === SICK_ONE
      }
      if (e.type === 'agent_spoke' && p.agentId !== SICK_ONE) {
        return typeof p.text === 'string' && p.text.includes(sickName)
      }
      return false
    })
    .map((e) => `${e.type} at tick ${e.tick}`)
  const sick = finalState.agents[SICK_ONE]
  const stagedResolved = sick === undefined || !sick.alive
    ? 'died' as const
    : (sick.afflictions?.some((x) => x.kind === 'illness') ?? false) ? 'standing' as const : 'recovered' as const

  // --- perception in the dark, read out of the run's own memory rows ---
  // The sentence `perceptionToProse` writes when `packet.light` reads 'dark' — the words a
  // mind actually saw, not the band name, which never reaches a prompt (G10).
  const DARK_LINE = 'The night is close around you'
  const darkPerceptions = qInt(
    db, `SELECT COUNT(*) FROM memories WHERE kind = 'perception' AND text LIKE ?`, `%${DARK_LINE}%`)
  const darkExcerpt = qRows<{ text: string }>(
    db, `SELECT text FROM memories WHERE kind = 'perception' AND text LIKE ? LIMIT 1`, `%${DARK_LINE}%`)[0]?.text ?? null

  // --- the recognizer's own rows, and the naming law over them ---
  const constructRows = constructStore.all()
  const namingLawHolds = constructRows.every((c) =>
    c.name === null || (c.nameProvenance !== null && c.nameProvenance.quote.includes(c.name)))
  const viewerCopy = constructRows.map((c) =>
    c.name === null ? UNNAMED_CONSTRUCT_COPY : `they call it ${c.name}`)

  const deadRows = reportDeadCalls(db)
  const providerRows = reportProviders(db)
  const deadCalls = deadRows.reduce((acc, r) => ({
    calls: acc.calls + r.calls, emptyOutput: acc.emptyOutput + r.emptyOutput,
    unparseable: acc.unparseable + r.unparseable, otherFailures: acc.otherFailures + r.otherFailures,
  }), { calls: 0, emptyOutput: 0, unparseable: 0, otherFailures: 0 })

  const tokens = qRows<{ i: number; o: number; c: number }>(
    db, 'SELECT COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o, COALESCE(SUM(cache_read_tokens),0) c FROM llm_calls')[0]
    ?? { i: 0, o: 0, c: 0 }

  const spent = totalSpend()
  const report: G11Report = {
    generatedAt: new Date().toISOString(),
    model: MIND_MODEL,
    totalTicks: TOTAL_TICKS,
    realMsPerTick: REAL_MS_PER_TICK,
    startTick: START_TICK,
    opsPlane: {
      runConstructPass: 'wired',
      narrateDayWorldSeam: 'wired',
      narrateDaySemanticSeam: semanticRan ? 'wired' : 'refused',
      arbiterVocabulary: 'wired',
      reportDeadCalls: 'wired',
    },
    measurements: {
      mapWidth: grown.terrain[0]!.length,
      mapHeight: grown.terrain.length,
      growths: grown.growths ?? 0,
      trafficKeys: Object.keys(grown.traffic ?? {}).length,
      faunaCount: Object.keys(grown.fauna ?? {}).length,
      forageableCount: Object.keys(grown.forageables ?? {}).length,
      snapshotBytes,
      foldMsFromGenesis: Number(foldMs.toFixed(2)),
      foldEvents: allEvents.length,
      medianTickMs: Number(median(tickMs).toFixed(4)),
      p99TickMs: Number(([...tickMs].sort((a, b) => a - b)[Math.floor(tickMs.length * 0.99)] ?? 0).toFixed(4)),
    },
    spend: {
      totalCostUsd: spent,
      llmCallCount: qInt(db, 'SELECT COUNT(*) FROM llm_calls'),
      costByCaller: Object.fromEntries(qRows<{ caller: string; total: number }>(
        db, 'SELECT caller, COALESCE(SUM(cost_usd),0) AS total FROM llm_calls GROUP BY caller')
        .map((r) => [r.caller, r.total])),
      inputTokens: tokens.i,
      outputTokens: tokens.o,
      cacheReadTokens: tokens.c,
      cacheReadShare: tokens.i === 0 ? 0 : tokens.c / tokens.i,
      costPerMindPerSimDay: spent / MINDS.length / simDays,
      requestedProviderOrder: PROVIDER_ORDER,
      hardProviderAllowList: HARD_PROVIDER_ALLOW_LIST,
      providerMix: providerRows,
    },
    excerpts: {
      darkPerception: darkExcerpt,
      chronicleLine: lines[0] ?? null,
      constructName: constructRows.find((c) => c.name !== null)?.name ?? null,
      tendedProse: lines.find((l) => / cared for /.test(l)) ?? null,
    },
    evidence: {
      ticksRun: loop.tick - START_TICK,
      crashAlerts: qInt(db, `SELECT COUNT(*) FROM alerts WHERE kind IN ('turn_crash', 'reflection_failed')`),
      drainedIntents,
      drainedAgainCount,
      minds: [...runtimes.entries()].map(([agentId, r]) => ({
        agentId, turns: r.stats().turns, reflections: r.stats().reflections,
      })),
      overBudgetTicks: tickMs.filter((ms) => ms > TICK_BUDGET_MS).length,
      unpromptedDrinks: allEvents.filter((e) => e.type === 'agent_drank').length,
      foodGathered: gathered.acts,
      gatheredFoodEaten: gathered.eaten,
      stagedAfflictionAgentId: SICK_ONE,
      stagedAfflictionResponses: stagedResponses,
      stagedAfflictionResolved: stagedResolved,
      c11EventTypes: [...new Set(c11Events.map((e) => e.type))].sort(),
      chronicleLines: lines.length,
      chronicleViolations: violations,
      wearThreshold: WEAR_THRESHOLD,
      maxTileTraffic: trafficValues.length === 0 ? 0 : Math.max(...trafficValues),
      tilesWorn,
      worldLawPaths: Object.keys(TOGGLABLE_PATHS).filter((p) => p.endsWith('.enabled')),
      lawFlips: allEvents.filter((e) => e.type === 'config_changed')
        .map((e) => ({ tick: e.tick, path: String(payloadOf(e).path), value: payloadOf(e).value })),
      lawHistoryEntries: allEvents.filter((e) => e.type === 'config_changed').length,
      replayHashMatches,
      reflectionsStarted: [...runtimes.values()].reduce((s, r) => s + r.stats().reflections, 0),
      reflectionsResolved: qInt(
        db, `SELECT COUNT(*) FROM (SELECT DISTINCT agent_id, day FROM summary_nodes WHERE level = 'day')`),
      deadCalls,
      deadCallAlertRows: qInt(db, `SELECT COUNT(*) FROM alerts WHERE kind = 'llm_dead_calls'`),
      constructs: {
        expressiveVerbs,
        firstExpressiveBy: firstExpressive?.agentId ?? null,
        reusedBy,
        reuseArbiterCalls,
        passRan: nightsRun.length >= 1,
        passErrors: constructErrors,
        recognized: constructRows.length,
        named: constructRows.filter((c) => c.name !== null).length,
        namingLawHolds,
        viewerCopy,
      },
      tier1Milestones: narratorStore.milestones().filter((m) => m.tier === 1).map((m) => m.kind),
      darkPerceptions,
      semanticPassRan: semanticRan,
      semanticHits,
      semanticPassErrors: semanticErrors + narrateErrors,
      semanticUnreadableNights: qInt(db, `SELECT COUNT(*) FROM alerts WHERE kind = 'semantic_firsts_unreadable'`),
      fordBridge: fordProbe,
      farBankWalk: farBank,
      clothedSurviveLadder: clothedSurvive,
      discretion,
      mealsNeededPerMindPerDay: Number(mealsNeeded.toFixed(3)),
      fullNeedMoments: [...fullNeedSamples.values()].reduce((a, b) => a + b, 0) * 10,
      socialSurvivalActs: {
        tends: allEvents.filter((e) => e.type === 'agent_tended' && payloadOf(e).tenderId !== undefined).length,
        gives: completed.filter((e) => payloadOf(e).verb === 'give').length,
        jointBuilds: (() => {
          const byStructure = new Map<string, Set<string>>()
          for (const e of allEvents.filter((x) => x.type === 'structure_progressed')) {
            const id = String(payloadOf(e).id)
            byStructure.set(id, byStructure.get(id) ?? new Set())
          }
          for (const e of started.filter((x) => payloadOf(x).verb === 'build')) {
            const p = payloadOf(e).params as { x?: number; y?: number } | undefined
            const at = Object.values(finalState.structures).find((s) => s.x === p?.x && s.y === p?.y)
            if (at !== undefined) byStructure.get(at.id)?.add(String(payloadOf(e).agentId))
          }
          return [...byStructure.values()].filter((who) => who.size > 1).length
        })(),
        sharedFireMeals: completed.filter((e) => {
          if (payloadOf(e).verb !== 'eat') return false
          const who = String(payloadOf(e).agentId)
          const me = finalState.agents[who]
          if (me === undefined) return false
          return completed.some((o) => o !== e && payloadOf(o).verb === 'eat'
            && Math.abs(o.tick - e.tick) <= 30 && payloadOf(o).agentId !== who)
        }).length,
      },
    },
  }

  G11ReportSchema.parse(report)
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  writeFileSync(TRANSCRIPT_PATH, transcript(report, thoughts, allEvents, adjudications, bridge.rejections))

  console.log('\n=== GATE G11b report ===')
  console.log(JSON.stringify(report, null, 2))
  console.log(`\n  TOTAL: $${report.spend.totalCostUsd.toFixed(6)} over ${report.spend.llmCallCount} calls`
    + ` = $${report.spend.costPerMindPerSimDay.toFixed(4)}/mind/sim-day,`
    + ` cache-read share ${(report.spend.cacheReadShare * 100).toFixed(1)}%`)
  console.log(`  survival tax: ${(survivalTax(report.evidence.discretion) * 100).toFixed(1)}% of turns`)

  if (DRY_RUN) {
    const paid = qInt(db, 'SELECT COUNT(*) FROM llm_calls')
    console.log(`\n[g11] DRY RUN: ${paid} live calls were made (must be 0)`)
    if (paid !== 0) { console.error('DRY RUN SPENT MONEY'); process.exit(1) }
    console.log('[g11] dry run complete: the wiring runs end to end for nothing.')
    return
  }

  const failed = Object.entries(checkG11Report(report)).filter(([, d]) => d !== null)
  if (failed.length > 0) {
    console.error('\nGATE G11b FAILED:')
    for (const [name, detail] of failed) console.error(`  - ${name}: ${detail}`)
    console.error(`Report: ${REPORT_PATH}`)
    process.exit(1)
  }
  console.log(`\nGATE G11b PASSED. Report: ${REPORT_PATH}`)
}

function transcript(
  report: G11Report,
  thoughts: Array<{ tick: number; agentId: string; text: string }>,
  events: SimEvent[],
  adjudications: Array<{ tick: number; agentId: string; intent: string; kind: string }>,
  rejections: Rejection[],
): string {
  const spoke = events.filter((e) => e.type === 'agent_spoke')
  return [
    `# GATE G11b — the deep world, ${(report.totalTicks / MINUTES_PER_DAY).toFixed(0)} sim-days`,
    '',
    `Model ${report.model}; ${report.totalTicks} ticks at ${report.realMsPerTick} ms;`
    + ` $${report.spend.totalCostUsd.toFixed(6)} over ${report.spend.llmCallCount} calls.`,
    '',
    '## Thoughts',
    '',
    ...thoughts.map((t) => `- t${t.tick} **${t.agentId}**: ${t.text}`),
    '',
    '## Said aloud',
    '',
    ...spoke.map((e) => {
      const p = (e.payload ?? {}) as { agentId?: string; text?: string }
      return `- t${e.tick} **${p.agentId}**: "${p.text}"`
    }),
    '',
    '## Put to the arbiter',
    '',
    ...adjudications.map((a) => `- t${a.tick} ${a.agentId} ${a.kind}: ${a.intent}`),
    '',
    '## Refused by the world',
    '',
    ...rejections.slice(0, 300).map((r) => `- t${r.tick} ${r.agentId} ${r.verb}: ${r.reason}`),
    '',
  ].join('\n')
}

main().catch((err) => {
  console.error('g11-deepworld crashed:', err)
  process.exit(1)
})
