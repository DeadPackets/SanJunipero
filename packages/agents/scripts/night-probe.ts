// NIGHT PROBE — not a gate. One question, asked of real minds: the dark already charges a
// builder half again for every hour it works blind. Given a standing light it could raise for
// two wood, does anybody raise one — and does having the option make anything WORSE?
// The harness DELETES every roofed building — re-running it unchanged measures a town this
// project does not ship; NIGHT_VALLEY/NIGHT_LADDER are what make it comparable.
//
//   NIGHT_ARM=a|b  NIGHT_TICKS=300  NIGHT_LABEL=run1
//   NIGHT_VALLEY=shipped|stripped   NIGHT_LADDER=after|before
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import {
  createWorldTick, doorTile, EventStore, fold, genesisState, makeGenesisWorld, RngStreams,
  TickLoop, type LawQueue, type TickHandler, type WorldState,
} from '@sj/engine'
import {
  DEFAULT_CONFIG, MINUTES_PER_DAY, isHearthKind, isRoofedKind,
  type SimConfig, type SimEvent,
} from '@sj/shared'
import { EngineBridge, type Intent, type SubmitResult } from '../src/runtime/bridge.js'
import { AgentRuntime } from '../src/runtime/agentRuntime.js'
import { openAgentDb } from '../src/memory/schema.js'
import { PersonalityStore } from '../src/personality.js'
import { FOUNDER_MINDS } from '../src/live/founderMinds.js'
import { migrateLlmTables } from '../src/llm/callLog.js'
import { LlmClient } from '../src/llm/client.js'
import { Embedder } from '../src/memory/embedder.js'
import { makeReflectionLlm } from '../src/reflection.js'

const ARM = (process.env.NIGHT_ARM ?? 'b').toLowerCase()
const LABEL = process.env.NIGHT_LABEL ?? ARM
const TOTAL_TICKS = Number(process.env.NIGHT_TICKS ?? 300)
// 20:00. Dusk is 'dim' and costs nothing; the deep dark starts at 21:00 and charges from the
// first tick of it. Starting an hour before means a mind meets the dark rather than waking in
// it, which is the difference between a night it can plan for and a night it is already losing.
const START_TICK = 20 * 60
const CAP_USD = 6.0
const REAL_MS_PER_TICK = Number(process.env.NIGHT_MS_PER_TICK ?? 250)
// Twelve: a house is ten and a lamp is two, so a mind can raise the light AND still afford the
// roof. Ten would have made the lamp cost a house, and then this probe would be measuring a
// trade-off it invented rather than the question it asked.
const WOOD_IN_HAND = 12
const DATA_DIR = fileURLToPath(new URL('../data/night/', import.meta.url))

// ★ ARM A IS THE WORLD BEFORE THIS LANE, MADE BY TAKING THE LAMP BACK OUT. Both arms keep the
// dark and its 1.5x penalty, which have been shipped since C11 — the difference is only
// whether a pair of hands has anything to answer them with. `makeablesLine` reads the recipe
// table, so removing the row is also what takes the words "a lamp post (2 wood)" out of the
// prose: arm A's minds are never given the noun, and by the canon-vocabulary law a word a mind
// is never given is a word it never uses.
const LAMP = 'lamp_post'
const withoutLamp = (c: SimConfig): SimConfig => {
  const { [LAMP]: _r, ...recipes } = c.structures.recipes
  const { [LAMP]: _g, ...glowRadius } = c.light.glowRadius as Record<string, number>
  return {
    ...c,
    structures: { ...c.structures, recipes },
    light: { ...c.light, glowRadius: glowRadius as typeof c.light.glowRadius },
  }
}

// ★ THE LADDER BEFORE AND AFTER. `before` puts back the exact three rows the world-fixes lane
// changed, so the lamp A/B can be read against the world we ship AND against the world we
// shipped it over. Nothing else moves: same seed, same prose, same cast, same ground.
const LADDER = (process.env.NIGHT_LADDER ?? 'after').toLowerCase()
const beforeTheLadder = (c: SimConfig): SimConfig => ({
  ...c,
  structures: {
    ...c.structures,
    recipes: {
      ...c.structures.recipes,
      cabin: { ...c.structures.recipes['cabin']!, hearth: false },
      cottage: { ...c.structures.recipes['cottage']!, hearth: false, bed: false },
      farmhouse: { ...c.structures.recipes['farmhouse']!, hearth: false, bed: false },
    },
  },
})

const withArm = ARM === 'a' ? withoutLamp(DEFAULT_CONFIG) : DEFAULT_CONFIG
const config: SimConfig = LADDER === 'before' ? beforeTheLadder(withArm) : withArm

// ---------------------------------------------------------------- the minds ---
// The founding cast, read from the one place it is defined. This file used to carry its own
// copy, which drifted: the copy still put a literal `says "now then"` in Omar's mouth after
// `founderMinds.ts` had already rewritten that tic as a behaviour, so every run of this probe
// would have reproduced the stock opener the voice lane measured out.
const MINDS = FOUNDER_MINDS

// ------------------------------------------------------------------ the world ---
// The genesis valley exactly as it is — its ground, its river, its trees and the ground the
// town keeps for a new roof — with every ROOF taken out of it. Nothing else is touched: the
// question is what five bodies do about a cold night when there is nowhere to go in out of it.
// `structures.enterableKinds` was the roster this read; `wants` replaced it with the `roofed`
// property, so the question is asked of every recipe rather than of a remembered list.
const ROOFED = new Set(
  Object.keys(config.structures.recipes).filter((k) => isRoofedKind(config, k)))

// ★ AND WHICH WORLD IT ASKS IT OF, WHICH IS THE THING THAT WENT STALE. `stripped` is the world
// the landed numbers were taken in: every roof lifted out, because the motivation lane was
// measuring eighty refusals a night on "there is no way into a cabin" and a probe that left
// them in would have spent its budget re-measuring somebody else's defect.
//
// That defect is closed. A cabin is a room a body walks into and, since the world-fixes lane,
// the one indoor fire in the valley. So `stripped` now deletes the very buildings the question
// is about — a lamp A/B run in it cannot see a hearth, a bed or a ladder, and the number it
// returns describes a town this project does not ship. `shipped` is the founding valley as it
// stands: two sound roofs, seven sets of walls three quarters up, and a fire under one of them.
const VALLEY = (process.env.NIGHT_VALLEY ?? 'shipped').toLowerCase()
const REMOVED: ReadonlySet<string> = VALLEY === 'stripped' ? ROOFED : new Set<string>()

function buildWorld(store: EventStore): { state: WorldState; doors: Array<{ x: number; y: number }> } {
  const g = makeGenesisWorld(config)
  let state = genesisState(config, g.terrain)
  const dropped = new Set<string>()
  const doors: Array<{ x: number; y: number }> = []
  for (const e of g.events) {
    const p = e.payload as Record<string, unknown>
    if (e.type === 'structure_planned' && ROOFED.has(String(p['kind']))) {
      // Collected whether or not the roof is then dropped, so every arm and BOTH valleys spawn
      // their five founders on exactly the same five tiles.
      doors.push({ x: Number(p['x']), y: Number(p['y']) + Number(p['h'] ?? 1) })
    }
    if (e.type === 'structure_planned' && REMOVED.has(String(p['kind']))) {
      dropped.add(String(p['id']))
      continue
    }
    // Anything that names a building that is not there: the completion, the walls genesis
    // stands three quarters up, and the founder kit that would have been spawned inside it.
    // `structure_progressed` and the kits did not exist here when this probe last ran, and an
    // item carries its own `id` — so the location has to be asked FIRST or the kit slips past.
    const loc = p['loc'] as { t?: string; id?: string } | undefined
    const names = loc?.t === 'structure' ? loc.id : (p['structureId'] ?? p['id'])
    if (e.type !== 'structure_planned' && typeof names === 'string' && dropped.has(names)) continue
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
  const rng = new RngStreams('night-probe')
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

    // ★ NO PERCEPTION DIFFERENCE BETWEEN THE ARMS, ON PURPOSE. Both are told the same things
    // about the dark in the same words — `light` and `fumbling` are C11's and are on in both.
    // The arms differ in the WORLD, not in what a mind is told about it.
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

  const report = {
    arm: ARM, valley: VALLEY, ladder: LADDER, label: LABEL, ticks: TOTAL_TICKS, startTick: START_TICK,
    llmCalls: calls.n, costUsd: Number(cost.c.toFixed(4)),
    intents: attempts.length,
    byVerb: Object.fromEntries([...byVerb].sort((a, b) => b[1] - a[1])),
    builds: byVerb.get('build') ?? 0,
    structuresPlanned: planned.length,
    structuresCompleted: completed.length,
    structureProgressed: progressed.length,
    entered: entered.length,
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

    // ---- what THIS lane is asking -------------------------------------------------
    // Every act aimed at the dark, named separately, because "did they build" cannot tell a
    // lamp from a house and the whole question is which one a mind reached for.
    lampsPlanned: planned.filter((e) => (e.payload as { kind?: string }).kind === LAMP).length,
    lampsCompleted: completed.filter((e) => {
      const id = (e.payload as { id?: string }).id
      return planned.some((q) => {
        const p2 = q.payload as { id?: string; kind?: string }
        return p2.id === id && p2.kind === LAMP
      })
    }).length,
    lampBuildIntents: attempts.filter((a) => a.verb === 'build' && a.params.includes(LAMP)).length,
    houseBuildIntents: attempts.filter((a) => a.verb === 'build' && a.params.includes('house')).length,
    stoked: events.filter((e) => e.type === 'structure_fueled').length,
    // ★ THE CHAIN THE WORLD-FIXES LANE BUILT A ROAD FOR, counted end to end: a body that went
    // in, a body that went in somewhere with a fire in it, and a fire it then fed. Zero on the
    // third with a positive first is the road being there and nobody walking it.
    enteredWarm: entered.filter((e) => {
      const id = (e.payload as { structureId?: string }).structureId
      const k = id === undefined ? undefined : loop.state.structures[id]?.kind
      return k !== undefined && isHearthKind(config, k)
    }).length,
    stokedIndoors: events.filter((e) => {
      if (e.type !== 'structure_fueled') return false
      const id = (e.payload as { structureId?: string }).structureId
      const k = id === undefined ? undefined : loop.state.structures[id]?.kind
      return k !== undefined && isRoofedKind(config, k)
    }).length,
    slept: events.filter((e) => e.type === 'agent_slept').length,
    kindled: events.filter((e) => e.type === 'item_lit').length,
    torchCrafts: attempts.filter((a) => a.verb === 'craft' && a.params.includes('torch')).length,
    // The ONE number that says whether the road was taken: acts aimed at light, of any kind.
    lightActs: attempts.filter((a) =>
      a.verb === 'stoke' || a.verb === 'kindle'
      || (a.verb === 'build' && a.params.includes(LAMP))
      || (a.verb === 'craft' && a.params.includes('torch'))).length,
    thoughtsMentioningDark: thoughts.filter((t) =>
      /\bdark|light|lamp|torch|lantern|fire|flame|lit\b|blind|see |glow|night\b/i.test(t.text)).length,
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
