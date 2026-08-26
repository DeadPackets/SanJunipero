// GATE G9b — the live half of the living-world gate (addendum §17).
// Five minds, one staged birth, a real arbiter, a real admin law channel, and
// at least two sim-days (G9_TICKS). Everything the report claims is read back
// out of the run's own tables and event log; nothing here asserts on a mock.
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type Database from 'better-sqlite3'
import {
  applyLaw, createWorldTick, EventStore, fold, genesisState, replayFromGenesis,
  RngStreams, TickLoop,
  type LawQueue, type TickHandler, type WorldState,
} from '@sj/engine'
import { DEFAULT_CONFIG, MINUTES_PER_DAY, stateHash, type SimConfig } from '@sj/shared'
// Cross-package by relative path on purpose: @sj/arbiter, @sj/gateway and @sj/web
// all depend on @sj/agents, so a package-level dependency here would close a cycle.
import { makeArbiter } from '../../arbiter/src/adjudicate.js'
import { GENESIS_CODEX } from '../../arbiter/src/canon.js'
import { CodexStore } from '../../arbiter/src/codex.js'
import { migrateArbiterTables } from '../../arbiter/src/schema.js'
import type { Recipe } from '../../arbiter/src/verdict.js'
import { ADMIN_LAWS_PATH, createLawsAdmin } from '../../gateway/src/adminLaws.js'
import { lawChangesFrom } from '../../web/src/panels/lawsModel.js'
import { EngineBridge, type Intent, type SubmitResult } from '../src/runtime/bridge.js'
import { AgentRuntime } from '../src/runtime/agentRuntime.js'
import {
  buildAgentCtx, humanizeIntent, wireArbiter, type Adjudicator, type Codifier,
} from '../src/runtime/arbiterSeam.js'
import { openAgentDb } from '../src/memory/schema.js'
import { MemoryStore } from '../src/memory/store.js'
import { PersonalityStore, type PersonalityDoc } from '../src/personality.js'
import { migrateLlmTables } from '../src/llm/callLog.js'
import { LlmClient, DEFAULT_EXPECTED_CALL_COST_USD } from '../src/llm/client.js'
import { checkSpend } from '../src/llm/spendMonitor.js'
import { Embedder } from '../src/memory/embedder.js'
import { makeReflectionLlm } from '../src/reflection.js'
import { MIND_MODEL } from '../src/llm/pins.js'
import type { IdentityCore } from '../src/prompt/assemble.js'
import { derivePersona, type ParentPersona } from '../src/family/derivePersona.js'
import { buildHouseholdSeed } from '../src/family/memorySeed.js'
import { watchBirths, type AgentBornPayload } from '../src/family/watchBirths.js'
import { captureSocialName, migrateFamilyTables, promptBirthLine } from '../src/family/socialName.js'
import { G9ReportSchema, checkG9Report, median, type G9Report } from '../src/live/g9report.js'
import {
  HEARTH, HOUSES, STOREHOUSE, houseDoor, makeTerrain, townGenesisEvents, type Box,
} from '../src/live/g9world.js'
import type { DiscoveryCredit } from '@sj/shared'

const CAP_USD = 8.0
const WARN_USD = 5.0
const TOTAL_TICKS = Number(process.env.G9_TICKS ?? 2 * MINUTES_PER_DAY)
const REAL_MS_PER_TICK = Number(process.env.G9_MS_PER_TICK ?? 250)
const ADMIN_PORT = Number(process.env.G9_ADMIN_PORT ?? 8791)
// The town wakes at seven, not at midnight: a world that opens in the dark
// spends its first hours deciding where to lie down.
const START_TICK = 7 * 60
// ★ A STAGED TICK IS A FRACTION OF THE RUN, MEASURED FROM WHERE THE RUN STARTS. These are
// compared against `loop.tick`, which begins at START_TICK — so without the offset they are a
// fraction of the run measured from midnight, and any run shorter than ~1 050 ticks skips both
// operator actions ENTIRELY. Found by running it: a 240-tick slice reported `adminStatus=null`
// and `forcedAlert=false`, which reads as a broken admin channel rather than one never called.
const stagedTick = (fraction: number, cap: number): number =>
  START_TICK + Math.min(cap, Math.floor(TOTAL_TICKS * fraction))
const FLIP_TICK = stagedTick(0.62, 1800)
const FORCED_ALERT_TICK = stagedTick(0.4, 1200)

const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url))
const DB_PATH = path.join(DATA_DIR, 'g9.db')
const REPORT_PATH = path.join(DATA_DIR, 'g9-report.json')
const TRANSCRIPT_PATH = path.join(DATA_DIR, 'g9-transcript.md')
const MODELS_DIR = fileURLToPath(new URL('../../../data/models/', import.meta.url))

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- the town ---

type Mind = {
  id: string
  identity: IdentityCore
  personality: PersonalityDoc
  sex: 'f' | 'm'
  ageDays: number
  house: Box
  x: number
  y: number
}

function voice(
  register: string, rhythm: string, tics: string[], neverSays: string[], exampleLines: string[],
  typical: number, burst: number,
): IdentityCore['voiceCard'] {
  return { register, rhythm, tics, neverSays, exampleLines, wordBudget: { typical, burst } }
}

const MINDS: Mind[] = [
  {
    id: 'ada', sex: 'f', ageDays: 30 * 364, house: HOUSES[1]!, ...houseDoor(HOUSES[1]!),
    identity: {
      name: 'Ada', age: 30,
      backstory: 'Grew up in this valley, learned bread from her mother, and has kept the same hut since the year the river rose. Heavy with child now, and near her time.',
      temperament: 'level, watchful, short with idle talk',
      voiceCard: voice(
        'flat and plain, a word where others use ten', 'clipped; long silences she does not fill',
        ['agrees in one word'], ['long speeches', 'endearments'],
        ['Later.', 'The bread holds.'], 9, 18,
      ),
    },
    personality: {
      temperament: 'level, watchful, short with idle talk',
      values: ['a full store', 'keeping your word'],
      beliefs: ['the river gives and takes', 'a warm hut outlasts a fine one'],
      current: {
        mood: 'heavy and slow',
        worries: ['the child is due any night now'],
        goals: ['rest inside the hut when the light goes', 'keep something to eat within reach'],
      },
    },
  },
  {
    id: 'bex', sex: 'm', ageDays: 32 * 364, house: HOUSES[0]!, ...houseDoor(HOUSES[0]!),
    identity: {
      name: 'Bex', age: 32,
      backstory: 'A joiner. Splits planks better than anyone here and knows it. Ada\'s man since two winters, and he keeps his mark on what he makes.',
      temperament: 'proud of his hands, easily nettled, generous with what he has',
      voiceCard: voice(
        'warm and practical, names the thing before the feeling', 'two or three sentences, then he is done',
        ['calls everything "the work"'], ['flattery'],
        ['That plank is mine — I marked it.', 'Give it here, I will fix it.'], 14, 26,
      ),
    },
    personality: {
      temperament: 'proud of his hands, easily nettled, generous with what he has',
      values: ['a fair trade', 'good joinery'],
      beliefs: ['a marked thing is a known thing', 'wood tells you where it wants to split'],
      current: {
        mood: 'restless',
        worries: ['someone will walk off with his planks'],
        goals: ['keep the plank pile his', 'sleep under his own roof'],
      },
    },
  },
  {
    id: 'cass', sex: 'f', ageDays: 41 * 364, house: HOUSES[2]!, ...houseDoor(HOUSES[2]!),
    identity: {
      name: 'Cass', age: 41,
      backstory: 'Came down the valley eight summers ago with nothing and has eaten well ever since. Notices who owns what, and remembers it.',
      temperament: 'shrewd, friendly on the surface, keeps her own counsel',
      voiceCard: voice(
        'easy and conversational, questions more than statements', 'runs on a little when she is interested',
        ['comes at a thing sideways, with a question'], ['blunt refusals'],
        ['Whose is that one, then?', 'You could spare a loaf, I think.'], 20, 34,
      ),
    },
    personality: {
      temperament: 'shrewd, friendly on the surface, keeps her own counsel',
      values: ['never going hungry', 'knowing what everyone has'],
      beliefs: ['what is left lying about is half given away'],
      current: {
        mood: 'curious',
        worries: ['the store will not last the season'],
        goals: ['find out what is in the storehouse and whose it is', 'eat before dark'],
      },
    },
  },
  {
    id: 'dov', sex: 'm', ageDays: 36 * 364, house: HOUSES[3]!, ...houseDoor(HOUSES[3]!),
    identity: {
      name: 'Dov', age: 36,
      backstory: 'Keeps the stove. Spends his evenings putting things into the fire to see what comes out, which the others find either useful or tiresome.',
      temperament: 'patient, tinkering, talks himself through his work',
      voiceCard: voice(
        'thinking aloud, half to himself', 'long threads that wander before they land',
        ['thinks in hypotheticals'], ['certainty'],
        ['If the water goes off, the salt stays behind. That is the thing.', 'It wants a slower fire, I think.'], 28, 44,
      ),
    },
    personality: {
      temperament: 'patient, tinkering, talks himself through his work',
      values: ['finding out', 'a fire that never goes out'],
      beliefs: ['everything leaves something behind when it boils away'],
      current: {
        mood: 'set on it',
        worries: ['the pan will boil dry before he learns anything'],
        goals: [
          'boil river water down in a pan on the stove until only salt is left — nobody here has ever done it',
          'keep the stove alight',
        ],
      },
    },
  },
  {
    id: 'esen', sex: 'f', ageDays: 27 * 364, house: HOUSES[4]!, ...houseDoor(HOUSES[4]!),
    identity: {
      name: 'Esen', age: 27,
      backstory: 'Fishes the river and hates waste. Has taken to hanging fish over the stove smoke and has started calling it smoking, though nobody taught her the word.',
      temperament: 'quick, talkative, impatient with things going bad',
      voiceCard: voice(
        'bright and fast, jumps between things', 'runs sentences together when she is excited',
        ['calls the river "her" '], ['self-pity'],
        ['She was full this morning, I tell you.', 'It will keep if I smoke it, I am sure of it.'], 26, 40,
      ),
    },
    personality: {
      temperament: 'quick, talkative, impatient with things going bad',
      values: ['nothing wasted', 'a full net'],
      beliefs: ['fish left in the sun is fish thrown away'],
      current: {
        mood: 'in a hurry',
        worries: ['the catch will turn before anyone eats it'],
        goals: [
          'smoke the fish over the stove so it keeps — you have started saying "smoke" for it, though it is your own word',
          'get to the water early',
        ],
      },
    },
  },
]

const MOTHER = MINDS[0]!
const FATHER = MINDS[1]!
const NAMES = MINDS.map((m) => m.identity.name)

// The rungs the town has actually earned, plus the ones one step beyond, so an
// adjudicated recipe has a canon to stand on (adjacency doctrine).
function seedCodex(db: Database.Database): void {
  const codex = new CodexStore(db)
  for (const entry of GENESIS_CODEX) codex.insert(entry)
}

// ------------------------------------------------------------ instrumentation ---

type Rejection = { tick: number; agentId: string; verb: string; params: Record<string, unknown>; reason: string }

// Every refusal the world hands back, so the report can tell an unknown verb
// that reached the arbiter from one that died as refusal prose.
class WatchedBridge extends EngineBridge {
  readonly rejections: Rejection[] = []
  #tick: () => number = () => 0

  watchTicks(tick: () => number): void { this.#tick = tick }

  override submit(agentId: string, intent: Intent, onResult?: (r: SubmitResult) => void): Promise<SubmitResult> {
    return super.submit(agentId, intent, (r) => {
      if (!r.ok) {
        this.rejections.push({ tick: this.#tick(), agentId, verb: intent.verb, params: intent.params, reason: r.reason })
      }
      onResult?.(r)
    })
  }
}

function qInt(db: Database.Database, sql: string, ...params: unknown[]): number {
  return Number(db.prepare(sql).pluck().get(...params))
}
function qRows<T>(db: Database.Database, sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...params) as T[]
}

const words = (text: string): number => text.trim().split(/\s+/).filter((w) => w.length > 0).length

// ------------------------------------------------------------------- the run ---

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set')
    process.exit(2)
  }
  mkdirSync(DATA_DIR, { recursive: true })
  // A gate run starts from nothing: a leftover db would mix an older town's
  // memories, rulings and llm_calls into this run's evidence.
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })

  const config: SimConfig = DEFAULT_CONFIG
  const map = makeTerrain()
  const db = openAgentDb(DB_PATH)
  migrateLlmTables(db)
  migrateFamilyTables(db)
  migrateArbiterTables(db)
  seedCodex(db)

  const store = new EventStore(db)
  const rng = new RngStreams('g9-living-world')
  let state = genesisState(config, map)
  const emit = (type: string, payload: unknown) => {
    state = fold(state, store.append(state.tick, type, payload), config)
  }

  // --- Genesis: the town as it stands on the morning of day zero (g9world.ts). ---
  // One unborn mouth: the staged birth lands on day 1 and eats for the rest of the run.
  for (const e of townGenesisEvents({
    config,
    totalTicks: TOTAL_TICKS,
    unbornMinds: 1,
    minds: MINDS.map((m) => ({
      id: m.id, name: m.identity.name, sex: m.sex, ageDays: m.ageDays, x: m.x, y: m.y,
      houseIndex: HOUSES.findIndex((h) => h.id === m.house.id),
    })),
  })) emit(e.type, e.payload)

  // The staged birth (user ruling 2026-08-16): gestation stays at the real 72
  // sim-days and the pregnancy is backdated so the term completes on day 1.
  const conceivedDay = 1 - config.reproduction.gestationDays
  for (const day of [-3, -2, -1]) emit('co_slept', { aId: MOTHER.id, bId: FATHER.id, day })
  emit('agent_conceived', { motherId: MOTHER.id, fatherId: FATHER.id, day: conceivedDay })

  // --- The loop, the bridge, the laws. ---
  const lawQueue: LawQueue = []
  const worldTick = createWorldTick(config, rng, lawQueue)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store, state, rng, config, startTick: START_TICK, realMsPerTick: REAL_MS_PER_TICK,
    onTick: (ctx) => handler(ctx),
  })
  // No window override: the bridge's own default now outlasts the gap between a
  // mind's turns, and the gate is run on what a consumer gets by default.
  const bridge = new WatchedBridge({ loop, store, simConfig: config })
  bridge.watchTicks(() => loop.tick)
  handler = bridge.wrapTickHandler(({ emit: e }) => {
    // A hearth is a fire someone keeps: relight it rather than let the gate
    // depend on whether a recipe's "beside a fire" still holds at hour ten.
    if (loop.tick % 60 === 0 && loop.state.structures[HEARTH.id]?.burning === false) {
      e('fire_ignited', { structureId: HEARTH.id, cause: 'the stove is fed' })
    }
    for (const ev of worldTick(loop.state).events) e(ev.type, ev.payload)
  })

  const adminToken = randomBytes(16).toString('hex')
  const admin = createLawsAdmin({ token: adminToken, submitLaw: (p, v) => applyLaw(lawQueue, p, v) })
  await new Promise<void>((resolve) => admin.listen(ADMIN_PORT, '127.0.0.1', resolve))
  const adminUrl = `http://127.0.0.1:${(admin.address() as AddressInfo).port}${ADMIN_LAWS_PATH}`

  // --- The minds. ---
  const embedder = await Embedder.create(MODELS_DIR)
  const thoughts: Array<{ tick: number; agentId: string; text: string }> = []
  const runtimes = new Map<string, AgentRuntime>()
  const memories = new Map<string, MemoryStore>()
  const personaOf = new Map<string, ParentPersona>()

  // Set once the arbiter exists; every mind booted after that — the child
  // included — is wired to it at birth.
  let seam: { adjudicate: Adjudicator; codify: Codifier } | null = null

  function boot(spec: { id: string; identity: IdentityCore; personality: PersonalityDoc }): AgentRuntime {
    const personality = new PersonalityStore(db, spec.id)
    personality.init(spec.personality, Math.floor(loop.tick / MINUTES_PER_DAY))
    const turnLlm = new LlmClient({ db, caller: 'turn', agentId: spec.id, budgetUsd: CAP_USD })
    const reflectionLlm = makeReflectionLlm(new LlmClient({ db, caller: 'reflection', agentId: spec.id, budgetUsd: CAP_USD }))
    const runtime = new AgentRuntime({
      db, llm: turnLlm, embedder, identity: spec.identity, personality, bridge, reflectionLlm,
      onThought: (t) => thoughts.push(t),
    })
    runtime.start(spec.id)
    if (seam !== null) wireArbiter(runtime, seam)
    runtimes.set(spec.id, runtime)
    memories.set(spec.id, new MemoryStore(db, spec.id, embedder))
    personaOf.set(spec.id, { agentId: spec.id, identity: spec.identity, personality: spec.personality })
    return runtime
  }

  for (const m of MINDS) boot(m)

  // --- The arbiter, wired to every mind that exists and every one to come. ---
  const arbiterLlm = new LlmClient({ db, caller: 'arbiter', budgetUsd: CAP_USD })
  const arbiter = makeArbiter({ db, llm: arbiterLlm, embedder, tick: () => loop.tick })
  const adjudications: Array<{ tick: number; intent: string; kind: string }> = []
  const codified: string[] = []
  let firstCodifiedIntent: string | null = null
  const watchedArbiter = {
    adjudicate: async (intent: string, ctx: Parameters<typeof arbiter.adjudicate>[1]) => {
      const verdict = await arbiter.adjudicate(intent, ctx)
      adjudications.push({ tick: loop.tick, intent, kind: verdict.kind })
      if (verdict.kind === 'attempt' && firstCodifiedIntent === null) firstCodifiedIntent = intent
      return verdict
    },
    codify: (recipe: { id: string }, credit: DiscoveryCredit) => {
      const out = arbiter.codify(recipe as Recipe, credit)
      codified.push(out.verb)
      return out
    },
  }
  seam = watchedArbiter
  for (const runtime of runtimes.values()) wireArbiter(runtime, watchedArbiter)

  // --- A birth builds a mind (user ruling 2026-08-16: hybrid naming). ---
  type BornChild = {
    id: string; registryName: string; socialName: string | null; bornTick: number
    personaNamesBothParents: boolean; seedEntries: number; seedAllPublic: boolean
    motherBirthMemoryTick: number | null
  }
  // A box, not a bare `let`: the only assignment is inside an async callback, so control-flow
  // analysis narrows a plain binding to `null` at every read below and every field on it comes
  // out `never`. Eleven errors that only became visible when `scripts/` started being checked.
  const childBox: { value: BornChild | null } = { value: null }
  const namingLlm = new LlmClient({ db, caller: 'naming', agentId: MOTHER.id, budgetUsd: CAP_USD })

  const onBorn = (born: AgentBornPayload): void => {
    const bornTick = loop.tick
    console.log(`[g9] tick ${bornTick}: ${born.name} is born to ${born.motherId} and ${born.fatherId}`)
    void (async () => {
      const parents: [ParentPersona, ParentPersona] = [personaOf.get(born.motherId)!, personaOf.get(born.fatherId)!]
      const derived = derivePersona({ id: born.id, name: born.name, sex: born.sex }, parents)
      const seed = buildHouseholdSeed(store, {
        childId: born.id, motherId: born.motherId, fatherId: born.fatherId,
        homeStructureId: MOTHER.house.id, upToTick: bornTick,
      })
      boot({ id: born.id, identity: derived.identity, personality: derived.personality })
      const childMem = memories.get(born.id)!
      for (const entry of seed) {
        await childMem.insertMemory({
          tick: bornTick, kind: 'perception', text: entry.text, importance: entry.importance,
          tags: { people: [], place: null, objects: [], topics: entry.tags },
        })
      }
      // The mother's next turn is prompted with the birth, and her own name for
      // the child is recorded beside the registry one.
      const motherMem = memories.get(born.motherId)!
      const line = promptBirthLine(born)
      await motherMem.insertMemory({
        tick: bornTick, kind: 'perception', text: line, importance: 10,
        tags: { people: [born.name], place: null, objects: [], topics: ['birth'] },
      })
      const socialName = await captureSocialName(namingLlm, db, {
        born, motherPersona: personaOf.get(born.motherId) ?? null, tick: bornTick,
      })
      const backstory = derived.identity.backstory
      childBox.value = {
        id: born.id,
        registryName: born.name,
        socialName,
        bornTick,
        personaNamesBothParents:
          backstory.includes(parents[0].identity.name) && backstory.includes(parents[1].identity.name),
        seedEntries: seed.length,
        seedAllPublic: seed.every((e) => e.tags.some((t) => /^event:\d+$/.test(t))),
        motherBirthMemoryTick: bornTick,
      }
      console.log(`[g9] child mind booted: ${born.id} (${born.name}), the mother calls ${socialName ?? '— nothing yet'}`)
    })()
  }
  const stopWatchingBirths = watchBirths(bridge, store, onBorn)

  // --- The run. ---
  const spendProjections: Array<{ tick: number; usdPerSimDay: number; sampledCalls: number }> = []
  let forcedSpendAlert = false
  let adminPostStatus: number | null = null
  let capBlown = false

  const totalSpend = (): number => Number(db.prepare('SELECT COALESCE(SUM(cost_usd), 0) FROM llm_calls').pluck().get())

  console.log(`[g9] model=${MIND_MODEL} ticks=${TOTAL_TICKS} pace=${REAL_MS_PER_TICK}ms cap=$${CAP_USD.toFixed(2)} admin=${adminUrl}`)
  const startWall = Date.now()
  for (let i = 0; i < TOTAL_TICKS; i += 1) {
    const stepStart = Date.now()
    loop.step()

    if (loop.tick % 60 === 0) {
      const p = checkSpend(db, { windowRealMinutes: 15 })
      spendProjections.push({ tick: loop.tick, usdPerSimDay: p.usdPerSimDay, sampledCalls: p.sampledCalls })
    }
    if (loop.tick === FORCED_ALERT_TICK) {
      // The operator drops the threshold to nothing for one check: the alert
      // path has to fire on real spend, not on a fixture.
      forcedSpendAlert = checkSpend(db, { windowRealMinutes: 15, thresholdUsdPerSimDay: 0.000001 }).alerted
      console.log(`[g9] forced spend check at tick ${loop.tick}: alerted=${forcedSpendAlert}`)
    }
    if (loop.tick === FLIP_TICK) {
      for (const [lawPath, value] of [['mystery.chancePerDay', 1], ['spoilage.enabled', false]] as const) {
        const res = await fetch(adminUrl, {
          method: 'POST',
          headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ path: lawPath, value }),
        })
        adminPostStatus = res.status
        console.log(`[g9] operator posts ${lawPath}=${JSON.stringify(value)} → ${res.status}`)
      }
    }
    if (loop.tick % 240 === 0) {
      const mins = ((Date.now() - startWall) / 60_000).toFixed(1)
      const turns = [...runtimes.values()].reduce((s, r) => s + r.stats().turns, 0)
      console.log(`[g9] tick ${loop.tick}/${TOTAL_TICKS} (${mins} min, turns=${turns}, $${totalSpend().toFixed(4)})`)
    }
    const spent = totalSpend()
    if (spent > CAP_USD) { capBlown = true; break }
    if (spent > WARN_USD && loop.tick % 60 === 0) console.warn(`[g9] spend past the warning line: $${spent.toFixed(4)}`)

    await sleep(Math.max(0, REAL_MS_PER_TICK - (Date.now() - stepStart)))
  }

  // A reflection begun near the end must be allowed to finish, then everything settles.
  const reflectionDeadline = Date.now() + 300_000
  while ([...runtimes.values()].some((r) => r.reflectionInFlight()) && Date.now() < reflectionDeadline) {
    await sleep(2000)
  }
  const settleDeadline = Date.now() + 60_000
  let lastLlmId = qInt(db, 'SELECT COALESCE(MAX(id), 0) FROM llm_calls')
  while (Date.now() < settleDeadline) {
    await sleep(2000)
    const nowId = qInt(db, 'SELECT COALESCE(MAX(id), 0) FROM llm_calls')
    if (nowId === lastLlmId) break
    lastLlmId = nowId
  }

  stopWatchingBirths()
  for (const runtime of runtimes.values()) runtime.stop()
  const drainedIntents = bridge.drain('the moment passes')
  const drainedAgainCount = bridge.drain()
  admin.close()

  if (capBlown) {
    console.error(`BUDGET CAP EXCEEDED: $${totalSpend().toFixed(4)} > $${CAP_USD.toFixed(2)}`)
    process.exit(1)
  }

  // --- Adjudicate the same intent again: precedent, not another ruling. ---
  let repeatArbiterCalls = 0
  const repeatIntent: string | null = firstCodifiedIntent
  if (repeatIntent !== null) {
    const asker = MINDS.map((m) => m.id).find((id) => loop.state.agents[id]?.alive === true)
    if (asker !== undefined) {
      const before = qInt(db, `SELECT COUNT(*) FROM llm_calls WHERE caller = 'arbiter'`)
      try {
        await arbiter.adjudicate(repeatIntent, buildAgentCtx(bridge, asker))
      } catch (err) {
        console.error('[g9] the repeat adjudication threw:', err)
      }
      repeatArbiterCalls = qInt(db, `SELECT COUNT(*) FROM llm_calls WHERE caller = 'arbiter'`) - before
    }
  }

  // ------------------------------------------------------------- evidence ---
  const allEvents = store.readFrom(0)
  const finalState: WorldState = loop.state

  const crashAlerts = qInt(db, `SELECT COUNT(*) FROM alerts WHERE kind IN ('turn_crash', 'reflection_failed')`)
  const reflectionFallbacks = qInt(db, `SELECT COUNT(*) FROM alerts WHERE kind = 'reflection_fallback'`)
  const reflectionsStarted = [...runtimes.values()].reduce((s, r) => s + r.stats().reflections, 0)
  const reflectionsResolved = qInt(db, `SELECT COUNT(*) FROM (SELECT DISTINCT agent_id, day FROM summary_nodes WHERE level = 'day')`)

  const unknownVerbRejections = bridge.rejections.filter((r) => r.reason.startsWith('unknown verb:'))
  const routedIntents = new Set(adjudications.map((a) => a.intent))
  const adjudicationsAfterUnknownVerb = unknownVerbRejections
    .filter((r) => routedIntents.has(humanizeIntent(r.verb, r.params))).length
  const unknownVerbRefusalMemories = qInt(
    db, `SELECT COUNT(*) FROM memories WHERE text LIKE 'You realize you cannot: unknown verb:%'`,
  )

  const spokeRows = qRows<{ payload: string }>(
    db, `SELECT payload FROM events WHERE type = 'agent_spoke' ORDER BY seq`,
  ).map((r) => JSON.parse(r.payload) as { agentId: string; text: string })
  const voice = [...runtimes.keys()].map((agentId) => {
    const said = spokeRows.filter((s) => s.agentId === agentId).map((s) => words(s.text))
    const budget = personaOf.get(agentId)?.identity.voiceCard.wordBudget ?? null
    return {
      agentId,
      budgetTypical: budget === null ? null : budget.typical,
      utterances: said.length,
      meanWords: said.length === 0 ? 0 : said.reduce((a, b) => a + b, 0) / said.length,
      medianWords: median(said),
    }
  })

  const possessive = new RegExp(`\\b(${NAMES.join('|')})'s\\b`)
  const perceptionRows = qRows<{ text: string }>(
    db, `SELECT text FROM memories WHERE kind = 'perception' ORDER BY id`,
  ).map((r) => r.text)
  const ownershipProse = perceptionRows.filter((t) => possessive.test(t))
  const witnessProse = perceptionRows.filter((t) => /You watch \w+ take /.test(t))
  const theftCount = allEvents.filter((e) => e.type === 'item_taken').length

  const lawFlips = allEvents
    .filter((e) => e.type === 'config_changed')
    .map((e) => ({ tick: e.tick, ...(e.payload as { path: string; value: unknown }) }))
  const replayed = replayFromGenesis(store, config, map)
  const replayHashMatches = stateHash(replayed) === stateHash(finalState)

  const costByCaller = Object.fromEntries(
    qRows<{ caller: string; total: number }>(
      db, `SELECT caller, COALESCE(SUM(cost_usd), 0) AS total FROM llm_calls GROUP BY caller`,
    ).map((r) => [r.caller, r.total]),
  )

  const child = childBox.value
  const childTurns = child === null ? 0 : (runtimes.get(child.id)?.stats().turns ?? 0)
  const childThought = child === null ? null : thoughts.find((t) => t.agentId === child.id)?.text ?? null
  const motherTurnTickAfterBirth = child === null
    ? null
    : thoughts.find((t) => t.agentId === MOTHER.id && t.tick > child.bornTick)?.tick ?? null

  const report: G9Report = {
    generatedAt: new Date().toISOString(),
    model: MIND_MODEL,
    totalTicks: TOTAL_TICKS,
    realMsPerTick: REAL_MS_PER_TICK,
    capUsd: CAP_USD,
    expectedCallCostUsd: DEFAULT_EXPECTED_CALL_COST_USD,
    totalCostUsd: totalSpend(),
    costByCaller,
    llmCallCount: qInt(db, 'SELECT COUNT(*) FROM llm_calls'),
    excerpts: {
      childThought,
      motherBirthLine: child === null ? null : promptBirthLine({
        id: child.id, name: child.registryName, sex: finalState.agents[child.id]?.sex ?? 'f',
        motherId: MOTHER.id, fatherId: FATHER.id, x: 0, y: 0,
      }),
      ownershipProse: ownershipProse[0] ?? null,
      witnessProse: witnessProse[0] ?? null,
    },
    evidence: {
      ticksRun: loop.tick - START_TICK,
      crashAlerts,
      drainedIntents,
      drainedAgainCount,
      minds: [...runtimes.entries()].map(([agentId, r]) => ({
        agentId, turns: r.stats().turns, reflections: r.stats().reflections,
      })),
      child: child === null ? null : {
        id: child.id,
        registryName: child.registryName,
        socialName: child.socialName,
        bornTick: child.bornTick,
        turns: childTurns,
        personaNamesBothParents: child.personaNamesBothParents,
        seedEntries: child.seedEntries,
        seedAllPublic: child.seedAllPublic,
        motherBirthMemoryTick: child.motherBirthMemoryTick,
        motherTurnTickAfterBirth,
      },
      novelIntents: adjudications.length,
      codifiedVerbs: codified,
      repeatIntent,
      repeatArbiterCalls,
      unknownVerbRejections: unknownVerbRejections.length,
      unknownVerbRefusalMemories,
      adjudicationsAfterUnknownVerb,
      reflectionsStarted,
      reflectionsResolved,
      reflectionFallbacks,
      spendProjections,
      forcedSpendAlert,
      spendAlertRows: qInt(db, `SELECT COUNT(*) FROM alerts WHERE kind = 'spend_projection'`),
      voice,
      ownershipPhraseCount: ownershipProse.length,
      witnessProseCount: witnessProse.length,
      theftCount,
      adminPostStatus,
      lawFlips,
      lawHistoryEntries: lawChangesFrom(allEvents).length,
      finalLaws: (finalState.laws ?? {}) as Record<string, unknown>,
      replayHashMatches,
    },
  }

  G9ReportSchema.parse(report)
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  writeFileSync(TRANSCRIPT_PATH, transcript(report, thoughts, spokeRows, adjudications, lawFlips, bridge.rejections))

  console.log('\n=== GATE G9b report ===')
  console.log(JSON.stringify(report, null, 2))
  console.log(`\n  TOTAL: $${report.totalCostUsd.toFixed(6)} (cap $${CAP_USD.toFixed(2)}) over ${report.llmCallCount} calls`)

  const failed = Object.entries(checkG9Report(report)).filter(([, d]) => d !== null)
  if (failed.length > 0) {
    console.error('\nGATE G9b FAILED:')
    for (const [name, detail] of failed) console.error(`  - ${name}: ${detail}`)
    console.error(`Report: ${REPORT_PATH}`)
    process.exit(1)
  }
  console.log(`\nGATE G9b PASSED (8/8 criteria). Report: ${REPORT_PATH}`)
}

function transcript(
  report: G9Report,
  thoughts: Array<{ tick: number; agentId: string; text: string }>,
  spoke: Array<{ agentId: string; text: string }>,
  adjudications: Array<{ tick: number; intent: string; kind: string }>,
  lawFlips: Array<{ tick: number; path: string; value: unknown }>,
  rejections: Rejection[],
): string {
  const lines: string[] = [
    `# GATE G9b — living world, ${(report.totalTicks / MINUTES_PER_DAY).toFixed(0)} sim-days`,
    '',
    `Model ${report.model}; ${report.totalTicks} ticks at ${report.realMsPerTick} ms; $${report.totalCostUsd.toFixed(6)} over ${report.llmCallCount} calls.`,
    '',
    '## Thoughts',
    '',
    ...thoughts.map((t) => `- t${t.tick} **${t.agentId}**: ${t.text}`),
    '',
    '## Said aloud',
    '',
    ...spoke.map((s) => `- **${s.agentId}**: "${s.text}"`),
    '',
    '## Put to the arbiter',
    '',
    ...adjudications.map((a) => `- t${a.tick} ${a.kind}: ${a.intent}`),
    '',
    '## Refused by the world',
    '',
    ...rejections.slice(0, 200).map((r) => `- t${r.tick} ${r.agentId} ${r.verb}: ${r.reason}`),
    '',
    '## Laws changed mid-run',
    '',
    ...lawFlips.map((f) => `- t${f.tick} ${f.path} = ${JSON.stringify(f.value)}`),
    '',
  ]
  return lines.join('\n')
}

main().catch((err) => {
  console.error('g9-livingworld crashed:', err)
  process.exit(1)
})
