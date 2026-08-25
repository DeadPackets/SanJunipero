// COST LADDER — one arm of the reasoning-dial ladder, with the quality measure beside the bill.
//
// ★ THE ONLY WAY THIS LANE CAN FAIL IS BY MAKING THE MINDS STUPIDER, and a token count cannot
// see that. So every arm reports six behaviours that were MEASURED TO BE ABSENT and then
// appeared — a regression in any of them is visible as a number, not as an opinion:
//
//   enteredWarm   a mind goes indoors when cold      (0,0,0,0 -> 1,1,1,1, world-fixes)
//   lightActs     a mind makes light                 (0 across eight live nights, then t133)
//   recovered     a mind recovers from a refusal     ("you cannot: stoke needs a {structureId}")
//   bonds         a tie forms                        (BONDS 0 -> 1, fifteen unscripted lines)
//   completed     a mind builds                      ("Begun by Amara on Day 0 - still rising")
//   emDashPct     voice quality                      (0.0% em dash, opener reuse 82% -> 30%)
//
// Three of the six are read with the PRODUCT'S OWN code rather than a proxy invented here:
// `buildBonds` is the gateway's shipped derivation, the shiver line is the one `prose.ts` uses
// to tell a mind it is cold, and the repair count is `repair.ts`'s own `decode_repaired` alert.
//
// Every arm is matched: same seed, same cast, same spawn tiles, same tick count, same machine,
// same wood and bread in hand. The ONLY difference between arms is what `reasoning` the turn
// client and the reflection client send.
//
//   LADDER_TURN=unset|off|minimal|low|medium|high
//   LADDER_REFL=unset|off|minimal|low|medium|high
//   LADDER_TICKS=300 LADDER_LABEL=a1
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import {
  createWorldTick, EventStore, fold, genesisState, makeGenesisWorld, RngStreams,
  TickLoop, type LawQueue, type TickHandler, type WorldState,
} from '@sj/engine'
import { DEFAULT_CONFIG, MINUTES_PER_DAY, type SimConfig, type SimEvent } from '@sj/shared'
// Cross-package by relative path, the way g9-livingworld reaches the arbiter: @sj/gateway
// depends on @sj/agents, so a package-level dependency here would close a cycle.
import { buildBonds } from '../../gateway/src/bonds.js'
import { EngineBridge, type Intent, type SubmitResult } from '../src/runtime/bridge.js'
import { AgentRuntime } from '../src/runtime/agentRuntime.js'
import { openAgentDb } from '../src/memory/schema.js'
import { PersonalityStore } from '../src/personality.js'
import { FOUNDER_MINDS } from '../src/live/founderMinds.js'
import { migrateLlmTables } from '../src/llm/callLog.js'
import { LlmClient, type ReasoningSetting } from '../src/llm/client.js'
import { Embedder } from '../src/memory/embedder.js'
import { makeReflectionLlm } from '../src/reflection.js'

const LABEL = process.env.LADDER_LABEL ?? 'ladder'
const TOTAL_TICKS = Number(process.env.LADDER_TICKS ?? 420)
// ★ A WINTER NIGHT, BECAUSE THE FIRST CONTROL ARM MEASURED NOTHING.
//
// Run on the default day 0 the arm came back `enteredWarm 0, lightActs 0, completed 0` — not
// because the minds failed, but because day 0 is SPRING (`SEASONS[floor(dayOfYear/91)]`) and
// spring night sits at ambient 9. Nobody drops under the shiver line, so three of the six
// behaviours cannot fire in the control and a measure that cannot fire cannot detect a
// regression. Winter night is ambient -12: the cold is real, the dark is real, and all six are
// live. Day 273 is the first winter day; 20:00 is where night-probe starts, an hour before the
// deep dark, so a mind meets the night rather than waking in it.
const WINTER_NIGHT = 273 * MINUTES_PER_DAY + 20 * 60
const START_TICK = Number(process.env.LADDER_START_TICK ?? WINTER_NIGHT)
const CAP_USD = Number(process.env.LADDER_CAP ?? 3.0)
const REAL_MS_PER_TICK = Number(process.env.LADDER_MS_PER_TICK ?? 250)
const WOOD_IN_HAND = 12
const DATA_DIR = fileURLToPath(new URL('../data/ladder/', import.meta.url))

// `prose.ts:408` — `if (warmth < 30) lines.push('You shiver against the cold.')`. The threshold
// is not chosen here; it is the number at which the mind is TOLD it is cold, so "went indoors
// while cold" means the same thing to the measure as it does to the person.
const SHIVER_LINE = 30
// A refusal is recovered when the same mind gets the SAME verb accepted inside half a sim-hour.
const RECOVERY_WINDOW_TICKS = 30

function reasoningFromEnv(name: string): ReasoningSetting | null {
  const v = (process.env[name] ?? 'unset').toLowerCase()
  if (v === 'unset') return null
  if (v === 'off') return { enabled: false }
  if (v === 'minimal' || v === 'low' || v === 'medium' || v === 'high') return { effort: v }
  throw new Error(`${name}: ${v} is not a rung`)
}
const TURN_REASONING = reasoningFromEnv('LADDER_TURN')
const REFL_REASONING = reasoningFromEnv('LADDER_REFL')

// The valley exactly as it ships. Unlike night-probe this arm keeps every roof: going indoors
// when cold is one of the six behaviours, and a world with nothing to go into cannot show it.
const config: SimConfig = DEFAULT_CONFIG
const MINDS = FOUNDER_MINDS

function buildWorld(store: EventStore): { state: WorldState; doors: Array<{ x: number; y: number }> } {
  const g = makeGenesisWorld(config)
  let state = genesisState(config, g.terrain)
  const doors: Array<{ x: number; y: number }> = []
  for (const e of g.events) {
    const p = e.payload as Record<string, unknown>
    // Remember the doorways so every arm spawns its five founders on exactly the same tiles.
    if (e.type === 'structure_planned' && p['kind'] === 'house') {
      doors.push({ x: Number(p['x']), y: Number(p['y']) + Number(p['h'] ?? 1) })
    }
    state = fold(state, store.append(state.tick, e.type, e.payload), config)
  }
  return { state, doors }
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('no key in the environment')
  mkdirSync(DATA_DIR, { recursive: true })
  const dbPath = path.join(DATA_DIR, `${LABEL}.db`)
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })
  const db = openAgentDb(dbPath)
  migrateLlmTables(db)

  const store = new EventStore(db)
  // One fixed seed for every arm. Two prior lanes priced the same prompt clause at +229 and at
  // +64 because their baselines differed; nothing here is allowed to differ but the dial.
  const rng = new RngStreams('cost-ladder')
  let { state, doors } = buildWorld(store)
  MINDS.forEach((m, i) => {
    const at = doors[i] ?? doors[0]!
    state = fold(state, store.append(state.tick, 'agent_spawned',
      { id: m.id, name: m.identity.name, x: at.x, y: at.y, sex: m.sex, ageDays: m.ageDays }), config)
    state = fold(state, store.append(state.tick, 'item_spawned',
      { id: `wood_${m.id}`, kind: 'wood', qty: WOOD_IN_HAND, loc: { t: 'agent', id: m.id }, owner: m.id }), config)
    state = fold(state, store.append(state.tick, 'item_spawned',
      { id: `bread_${m.id}`, kind: 'bread', qty: 4, loc: { t: 'agent', id: m.id }, owner: m.id }), config)
  })

  const lawQueue: LawQueue = []
  const worldTick = createWorldTick(config, rng, lawQueue)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store, state, rng, config, startTick: START_TICK, realMsPerTick: 0, onTick: (c) => handler(c),
  })

  const refusals: Array<{ tick: number; id: string; verb: string; reason: string }> = []
  const accepted: Array<{ tick: number; id: string; verb: string }> = []
  const attempts: Array<{ tick: number; id: string; verb: string; params: string }> = []
  class Watched extends EngineBridge {
    override submit(agentId: string, intent: Intent, cb?: (r: SubmitResult) => void): Promise<SubmitResult> {
      attempts.push({ tick: loop.tick, id: agentId, verb: intent.verb, params: JSON.stringify(intent.params) })
      return super.submit(agentId, intent, (r) => {
        if (r.ok) accepted.push({ tick: loop.tick, id: agentId, verb: intent.verb })
        else refusals.push({ tick: loop.tick, id: agentId, verb: intent.verb, reason: r.reason })
        cb?.(r)
      })
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
      llm: new LlmClient({ db, caller: 'turn', agentId: spec.id, budgetUsd: CAP_USD, reasoning: TURN_REASONING }),
      embedder,
      identity: spec.identity,
      personality,
      bridge,
      reflectionLlm: makeReflectionLlm(
        new LlmClient({ db, caller: 'reflection', agentId: spec.id, budgetUsd: CAP_USD, reasoning: REFL_REASONING }),
      ),
      onThought: (t) => thoughts.push(t),
    })
    runtime.start(spec.id)
    runtimes.push(runtime)
  }

  // ★ THE WARMTH SNAPSHOT. `agent_entered` says who went in and where, never how cold they
  // were. Sampling every tick is what makes "went indoors WHILE COLD" answerable afterwards.
  const warmthAt = new Map<number, Record<string, number>>()
  const end = START_TICK + TOTAL_TICKS
  while (loop.tick < end) {
    const at = Date.now()
    loop.step()
    warmthAt.set(loop.tick, Object.fromEntries(
      MINDS.map((m) => [m.id, loop.state.agents[m.id]?.needs.warmth ?? 100]),
    ))
    await new Promise<void>((r) => setTimeout(r, Math.max(0, REAL_MS_PER_TICK - (Date.now() - at))))
  }
  for (const r of runtimes) r.stop()
  bridge.drain()
  await new Promise<void>((r) => setTimeout(r, 3000))

  // --------------------------------------------------------------- the measure ---
  const events: SimEvent[] = store.readFrom(0).filter((e) => e.tick >= START_TICK)
  const planned = events.filter((e) => e.type === 'structure_planned')
  const completed = events.filter((e) => e.type === 'structure_completed')
  const entered = events.filter((e) => e.type === 'agent_entered')

  // 1. went indoors while cold — the shiver line the mind itself is told about.
  const enteredWarm = entered.filter((e) => {
    const p = e.payload as { agentId?: string }
    const w = warmthAt.get(e.tick)?.[String(p.agentId)]
    return w !== undefined && w < SHIVER_LINE
  }).length

  // 2. made light — any act aimed at the dark, of any kind.
  const lightActs = attempts.filter((a) =>
    a.verb === 'stoke' || a.verb === 'kindle'
    || (a.verb === 'build' && a.params.includes('lamp_post'))
    || (a.verb === 'craft' && a.params.includes('torch'))).length

  // 3. recovered from a refusal — same mind, same verb, accepted inside half a sim-hour.
  const recovered = refusals.filter((r) =>
    accepted.some((a) => a.id === r.id && a.verb === r.verb
      && a.tick > r.tick && a.tick - r.tick <= RECOVERY_WINDOW_TICKS)).length

  // 4. ties — the gateway's own derivation, not a proxy.
  const bonds = buildBonds(events, config.movement.earshotRadius, loop.tick).bonds.length

  // 6. voice — the two numbers the `dashes` lane moved.
  const said = [...thoughts.map((t) => t.text),
    ...events.filter((e) => e.type === 'agent_spoke').map((e) => String((e.payload as { text?: string }).text ?? ''))]
  const emDashLines = said.filter((s) => s.includes('—')).length
  const openers = said.map((s) => s.trim().toLowerCase().split(/\s+/).slice(0, 3).join(' ')).filter((s) => s.length > 0)
  const openerCounts = new Map<string, number>()
  for (const o of openers) openerCounts.set(o, (openerCounts.get(o) ?? 0) + 1)
  const topOpener = [...openerCounts.entries()].sort((a, b) => b[1] - a[1])[0]

  // ---- the bill, and the cheapest early warning there is ----
  const byCaller = db.prepare(`
    SELECT caller,
           COUNT(*) AS calls,
           SUM(ok) AS okCalls,
           COALESCE(SUM(input_tokens),0) AS inTok,
           COALESCE(SUM(output_tokens),0) AS outTok,
           COALESCE(SUM(reasoning_tokens),0) AS reasonTok,
           COALESCE(SUM(cache_read_tokens),0) AS cacheTok,
           COALESCE(SUM(cost_usd),0) AS cost
    FROM llm_calls GROUP BY caller
  `).all() as Array<{ caller: string; calls: number; okCalls: number; inTok: number; outTok: number; reasonTok: number; cacheTok: number; cost: number }>
  const repairs = db.prepare(
    "SELECT COUNT(*) AS n FROM alerts WHERE kind = 'decode_repaired'").get() as { n: number }
  const totalOk = byCaller.reduce((s, r) => s + r.okCalls, 0)
  const simHours = TOTAL_TICKS / 60

  const report = {
    label: LABEL,
    turnReasoning: TURN_REASONING, reflectionReasoning: REFL_REASONING,
    ticks: TOTAL_TICKS, startTick: START_TICK, simHours,
    season: ['spring', 'summer', 'autumn', 'winter'][Math.floor((Math.floor(START_TICK / MINUTES_PER_DAY) % 364) / 91)],
    warmthAtEnd: Object.fromEntries(MINDS.map((m) =>
      [m.id, Number((loop.state.agents[m.id]?.needs.warmth ?? -1).toFixed(1))])),
    seed: 'cost-ladder', cast: MINDS.map((m) => m.id),

    // ---- the bill ----
    byCaller: byCaller.map((r) => ({
      ...r,
      cost: Number(r.cost.toFixed(6)),
      outPerCall: r.okCalls === 0 ? 0 : Math.round(r.outTok / r.okCalls),
      reasoningPct: r.outTok === 0 ? 0 : Number(((100 * r.reasonTok) / r.outTok).toFixed(1)),
      cacheHitPct: r.inTok === 0 ? 0 : Number(((100 * r.cacheTok) / r.inTok).toFixed(1)),
    })),
    costUsd: Number(byCaller.reduce((s, r) => s + r.cost, 0).toFixed(6)),
    costPerSimHour: Number((byCaller.reduce((s, r) => s + r.cost, 0) / simHours).toFixed(4)),

    // ---- the measure ----
    quality: {
      enteredWarm, lightActs, recovered, bonds,
      completed: completed.length,
      planned: planned.length,
      refusals: refusals.length,
      recoveryPct: refusals.length === 0 ? null : Number(((100 * recovered) / refusals.length).toFixed(1)),
      thoughts: thoughts.length,
      spoke: said.length - thoughts.length,
      emDashPct: said.length === 0 ? 0 : Number(((100 * emDashLines) / said.length).toFixed(1)),
      topOpener: topOpener ? { words: topOpener[0], n: topOpener[1], pct: Number(((100 * topOpener[1]) / openers.length).toFixed(1)) } : null,
      // ★ THE CHEAPEST EARLY WARNING. `repair.ts` exists because minds sometimes hand back a
      // turn the schema rejects; the rate it fires at is the first thing to move if a rung has
      // made them worse at answering, and it moves before any behaviour does.
      repairs: repairs.n,
      repairPct: totalOk === 0 ? 0 : Number(((100 * repairs.n) / totalOk).toFixed(1)),
      hardFailures: byCaller.reduce((s, r) => s + (r.calls - r.okCalls), 0),
    },
    intents: attempts.length,
    refusalsByReason: Object.entries(refusals.reduce<Record<string, number>>((acc, r) => {
      acc[r.reason] = (acc[r.reason] ?? 0) + 1
      return acc
    }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8),
  }
  writeFileSync(path.join(DATA_DIR, `${LABEL}.json`), JSON.stringify(report, null, 2))
  writeFileSync(path.join(DATA_DIR, `${LABEL}-thoughts.md`),
    thoughts.map((t) => `- t=${t.tick} **${t.agentId}**: ${t.text}`).join('\n'))
  console.log(JSON.stringify(report, null, 2))
}

await main()
