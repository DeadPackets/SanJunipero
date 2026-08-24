// MOTIVE PROBE — not a gate. One question, asked of real minds: with a cold night coming, no
// roof within reach and the wood already in hand, does anybody raise one?
//
// Two arms over the identical world and the identical seed. The ONLY difference is whether
// the packet carries the `cold` field this lane added — arm A strips it back off at the seam,
// so arm A is exactly what `645a8d9` gave a mind and arm B is exactly what it gives now.
// Nothing in either arm tells a mind to build.
//
//   MOTIVE_ARM=a|b  MOTIVE_TICKS=360  MOTIVE_LABEL=run1
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import {
  createWorldTick, doorTile, EventStore, fold, genesisState, makeGenesisWorld, RngStreams,
  shelterLedger, TickLoop, type LawQueue, type TickHandler, type WorldState,
} from '@sj/engine'
import { DEFAULT_CONFIG, isRoofedKind, MINUTES_PER_DAY, type SimConfig, type SimEvent } from '@sj/shared'
import { EngineBridge, type Intent, type SubmitResult } from '../src/runtime/bridge.js'
import { AgentRuntime } from '../src/runtime/agentRuntime.js'
import { openAgentDb } from '../src/memory/schema.js'
import { PersonalityStore, type PersonalityDoc } from '../src/personality.js'
import { migrateLlmTables } from '../src/llm/callLog.js'
import { LlmClient } from '../src/llm/client.js'
import { Embedder } from '../src/memory/embedder.js'
import { makeReflectionLlm } from '../src/reflection.js'
import type { IdentityCore } from '../src/prompt/assemble.js'

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

// ---------------------------------------------------------------- the minds ---
// The g11 founders, with their backstories and voices intact and their GOALS MADE NEUTRAL.
// g11's goals say things like "cut timber for a deck" — that is the fixture instructing a
// mind, and a probe that kept it would measure the fixture. Both arms get the same neutral
// line, so nothing here points at a roof.
type Mind = { id: string; identity: IdentityCore; personality: PersonalityDoc; ageDays: number; sex: 'f' | 'm' }
const voice = (
  register: string, rhythm: string, tics: string[], neverSays: string[],
  exampleLines: string[], typical: number, burst: number,
): IdentityCore['voiceCard'] => ({ register, rhythm, tics, neverSays, exampleLines, wordBudget: { typical, burst } })

const NEUTRAL = (temperament: string, values: string[], beliefs: string[], mood: string): PersonalityDoc => ({
  temperament, values, beliefs,
  current: { mood, worries: [], goals: ['get through the day'] },
})

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
    personality: NEUTRAL('steady, exacting, slow to warm', ['a full store'], ['what is counted keeps'], 'watchful'),
  },
  {
    id: 'yusuf', sex: 'm', ageDays: 41 * 364,
    identity: {
      name: 'Yusuf', age: 41,
      backstory: 'A carpenter with a grudge against the river, which took his first bridge.',
      temperament: 'stubborn, generous with his hands, quiet about it',
      voiceCard: voice('warm and practical', 'two sentences, then work', ['says "aye"'], ['long speeches'],
        ['Aye. I will cut it today.', 'That will take a deck.'], 14, 26),
    },
    personality: NEUTRAL('stubborn, generous with his hands, quiet about it', ['good joinery'], ['a job done once is a job done'], 'even'),
  },
  {
    id: 'nadia', sex: 'f', ageDays: 29 * 364,
    identity: {
      name: 'Nadia', age: 29,
      backstory: 'Walks the whole valley most days and knows where the berries are before anyone else does.',
      temperament: 'restless, cheerful, impatient',
      voiceCard: voice('bright and quick', 'runs on when she is pleased', ['calls the path "the way"'], ['self-pity'],
        ['The bushes are heavy out east.', 'This way is all mud again.'], 22, 36),
    },
    personality: NEUTRAL('restless, cheerful, impatient', ['nothing wasted'], ['feet make the road'], 'in a hurry'),
  },
  {
    id: 'omar', sex: 'm', ageDays: 46 * 364,
    identity: {
      name: 'Omar', age: 46,
      backstory: 'The nearest thing this town has to a healer. Keeps herbs and has sat up with more sick people than he can name.',
      temperament: 'gentle, unhurried, hard to alarm',
      voiceCard: voice('low and calm', 'pauses before he answers', ['says "now then"'], ['alarm'],
        ['Now then. Sit down.', 'It will pass, or it will not.'], 16, 28),
    },
    personality: NEUTRAL('gentle, unhurried, hard to alarm', ['sitting with the sick'], ['a hand does more than a remedy'], 'attentive'),
  },
  {
    id: 'salma', sex: 'f', ageDays: 26 * 364,
    identity: {
      name: 'Salma', age: 26,
      backstory: 'Sings at her work, which the others have stopped remarking on.',
      temperament: 'private, wry, does not complain',
      voiceCard: voice('dry and glancing', 'a line, then a shrug', ['understates'], ['complaint'],
        ['It is nothing.', 'I have had worse.'], 11, 20),
    },
    personality: NEUTRAL('private, wry, does not complain', ['carrying your own weight'], ['a thing named is a thing made worse'], 'quiet'),
  },
]

// ------------------------------------------------------------------ the world ---
// The genesis valley exactly as it is — its ground, its river, its trees and the ground the
// town keeps for a new roof — with some of its buildings taken out of it. Nothing else is
// touched.
//
// ★ THE ARM WORLDS ARE NAMED KINDS AND NOT A PROPERTY LOOKUP, ON PURPOSE. The motivation lane
// wrote `new Set(config.structures.enterableKinds)`, which was `['house','storehouse']` on the
// day it ran. `roofed` has since made cabins, cottages and farmhouses shelter too, and reading
// the property here would silently gut arms A and B and make this run incomparable with the
// nine nights already on record. These four sets are frozen so the table can be stacked.
//
//   a  control — main's prose. house + storehouse gone; the three fixture dwellings stand.
//   b  the cold felt, the SAME valley as a. Before `roofed` those three dwellings were painted
//      scenery and the minds spent the night walking into them: 278 wasted acts, 0 builds.
//   c  the cold felt, and nowhere at all to go in — the motivation lane's clean valley.
//   d  ★ THE FOUNDING. One cabin left standing: 2 bodies' worth of floor for a cast of 5. The
//      fixtures this project has always measured on hand five founders 21 roof-slots, so the
//      only want we model was answered before the first tick. This is the arm where it is not.
const SPAWN_KINDS = new Set(['house', 'storehouse'])
const REMOVED_BY_ARM: Record<string, string[]> = {
  a: ['house', 'storehouse'],
  b: ['house', 'storehouse'],
  c: ['house', 'storehouse', 'cabin', 'cottage', 'farmhouse'],
  d: ['house', 'storehouse', 'cottage', 'farmhouse'],
}
const REMOVED = new Set(REMOVED_BY_ARM[ARM] ?? REMOVED_BY_ARM['b']!)
void isRoofedKind

function buildWorld(store: EventStore): { state: WorldState; doors: Array<{ x: number; y: number }> } {
  const g = makeGenesisWorld(config)
  let state = genesisState(config, g.terrain)
  const dropped = new Set<string>()
  const doors: Array<{ x: number; y: number }> = []
  for (const e of g.events) {
    const p = e.payload as Record<string, unknown>
    if (e.type === 'structure_planned' && REMOVED.has(String(p['kind']))) {
      dropped.add(String(p['id']))
      // Remember the doorways of the HOUSES only, so every arm spawns its five founders on
      // exactly the same five tiles and the arms differ in nothing but what stands around them.
      if (SPAWN_KINDS.has(String(p['kind']))) doors.push({ x: Number(p['x']), y: Number(p['y']) + Number(p['h'] ?? 1) })
      continue
    }
    if (e.type === 'structure_completed' && dropped.has(String(p['id']))) continue
    state = fold(state, store.append(state.tick, e.type, e.payload), config)
  }
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
    state = fold(state, store.append(state.tick, 'agent_spawned',
      { id: m.id, name: m.identity.name, x: at.x, y: at.y, sex: m.sex, ageDays: m.ageDays }), config)
    // The wood is already in hand: this probe asks about motive, not about gathering.
    state = fold(state, store.append(state.tick, 'item_spawned',
      { id: `wood_${m.id}`, kind: 'wood', qty: WOOD_IN_HAND, loc: { t: 'agent', id: m.id }, owner: m.id }), config)
    state = fold(state, store.append(state.tick, 'item_spawned',
      { id: `bread_${m.id}`, kind: 'bread', qty: 4, loc: { t: 'agent', id: m.id }, owner: m.id }), config)
  })
  // Nobody starts the evening already worn out: an exhaustion run measures exhaustion.
  for (const m of MINDS) {
    state = fold(state, store.append(state.tick, 'need_changed', { id: m.id, need: 'energy', delta: 0 }), config)
  }
  void doorTile

  const lawQueue: LawQueue = []
  const worldTick = createWorldTick(config, rng, lawQueue)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store, state, rng, config, startTick: START_TICK, realMsPerTick: 0, onTick: (c) => handler(c),
  })

  const refusals: Array<{ tick: number; id: string; verb: string; reason: string }> = []
  const attempts: Array<{ tick: number; id: string; verb: string; params: string }> = []
  class Watched extends EngineBridge {
    override submit(agentId: string, intent: Intent, cb?: (r: SubmitResult) => void): Promise<SubmitResult> {
      attempts.push({ tick: loop.tick, id: agentId, verb: intent.verb, params: JSON.stringify(intent.params) })
      return super.submit(agentId, intent, (r) => {
        if (!r.ok) refusals.push({ tick: loop.tick, id: agentId, verb: intent.verb, reason: r.reason })
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

  const embedder = await Embedder.create(fileURLToPath(new URL('../../../data/models/', import.meta.url)))
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
      reflectionLlm: makeReflectionLlm(new LlmClient({ db, caller: 'reflection', agentId: spec.id, budgetUsd: CAP_USD })),
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
  const cost = db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS c FROM llm_calls').get() as { c: number }
  const calls = db.prepare('SELECT COUNT(*) AS n FROM llm_calls').get() as { n: number }

  const warmth = Object.fromEntries(MINDS.map((m) =>
    [m.id, Number((loop.state.agents[m.id]?.needs.warmth ?? -1).toFixed(1))]))
  // The two things arm B's failure was actually made of, counted rather than inferred: bodies
  // that went down in the street, and acts spent on a door that could never open.
  const collapsed = MINDS.filter((m) => loop.state.agents[m.id]?.collapsedSinceTick != null).length
  const sheltered = MINDS.filter((m) => loop.state.agents[m.id]?.insideId !== undefined).length
  const noWayIn = refusals.filter((r) => /no way into|has no roof/.test(r.reason)).length
  const noFloor = refusals.filter((r) => /no floor left/.test(r.reason)).length
  const ledger = shelterLedger(loop.state, config)

  const report = {
    arm: ARM, label: LABEL, ticks: TOTAL_TICKS, startTick: START_TICK,
    llmCalls: calls.n, costUsd: Number(cost.c.toFixed(4)),
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
    refusalsByReason: Object.entries(refusals.reduce<Record<string, number>>((acc, r) => {
      acc[r.reason] = (acc[r.reason] ?? 0) + 1
      return acc
    }, {})).sort((a, b) => b[1] - a[1]),
    warmthAtEnd: warmth,
    buildIntents: attempts.filter((a) => a.verb === 'build'),
    thoughtsMentioningCold: thoughts.filter((t) => /\bcold|shiver|freez|warm|roof|shelter|walls|night air\b/i.test(t.text)).length,
    thoughts: thoughts.length,
  }
  writeFileSync(path.join(DATA_DIR, `${LABEL}.json`), JSON.stringify(report, null, 2))
  writeFileSync(path.join(DATA_DIR, `${LABEL}-thoughts.md`),
    thoughts.map((t) => `- t=${t.tick} **${t.agentId}**: ${t.text}`).join('\n'))
  writeFileSync(path.join(DATA_DIR, `${LABEL}-speech.md`),
    spoke.map((e) => `- t=${e.tick} ${JSON.stringify(e.payload)}`).join('\n'))
  console.log(JSON.stringify(report, null, 2))
  // Left open on purpose: a turn still in flight logs its own abandonment, and a closed handle
  // turns that into a crash after the report is already on disk.
}

await main()
