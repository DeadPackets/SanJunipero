import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type Database from 'better-sqlite3'
import {
  createWorldTick,
  EventStore,
  fold,
  genesisState,
  RngStreams,
  TickLoop,
  type TickHandler,
  type TileId,
} from '@sj/engine'
import { DEFAULT_CONFIG, MINUTES_PER_DAY, type SimConfig } from '@sj/shared'
import { EngineBridge } from '../src/runtime/bridge.js'
import { AgentRuntime } from '../src/runtime/agentRuntime.js'
import { openAgentDb } from '../src/memory/schema.js'
import { MemoryStore, type MemoryRow } from '../src/memory/store.js'
import { PersonalityStore, type PersonalityDoc } from '../src/personality.js'
import { migrateLlmTables } from '../src/llm/callLog.js'
import { LlmClient } from '../src/llm/client.js'
import { Embedder } from '../src/memory/embedder.js'
import { recall } from '../src/memory/retrieve.js'
import { makeReflectionLlm } from '../src/reflection.js'
import type { DreamLlm } from '../src/dream.js'
import { MIND_MODEL } from '../src/llm/pins.js'
import { TAMAR, TAMAR_PERSONALITY_V1 } from '../src/persona/tamar.js'
import { G3ReportSchema, type G3Report, type G3NightlyEditOutcome } from '../src/live/g3report.js'

const AGENT = 'tamar'
const AGENT_NAME = 'Tamar'
const STOREHOUSE_ID = 'structure_1'
const BREAD_ID = 'item_1'
const TOTAL_TICKS = 2 * MINUTES_PER_DAY // 2,880 ticks = 2 sim days
const REAL_MS_PER_TICK = 250
const BUDGET_USD = 5.0

const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url))
const DB_PATH = path.join(DATA_DIR, 'g3.db')
const REPORT_PATH = path.join(DATA_DIR, 'g3-report.json')
const MODELS_DIR = fileURLToPath(new URL('../../../data/models/', import.meta.url))

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// --- Real dream LLM: the only DreamLlm method, composed through the same thin
// client door as every other call. Diegetic, framing-clean prompt. ---
const DREAM_SCHEMA = z.object({ text: z.string().min(1), mood: z.string().min(1) }).strict()

function makeDreamLlm(client: LlmClient): DreamLlm {
  return {
    async composeDream(fragments: MemoryRow[]) {
      const content = fragments.map((m) => `[${m.id}] ${m.text}`).join('\n')
      const { value } = await client.object({
        system:
          'Your sleeping mind stitches a dream from the strongest threads of the past days. Speak it plainly, and name the feeling it leaves you with.',
        messages: [{ role: 'user', content: `These moments follow you into sleep:\n${content}` }],
        schema: DREAM_SCHEMA,
      })
      return value
    },
  }
}

// --- Record the nightly edit attempt outcome (applied or named rejection) so
// assertion 5 can observe the drift-limiter for both nights. ---
class RecordingPersonalityStore extends PersonalityStore {
  readonly editOutcomes = new Map<number, string>()
  override applyNightlyEdit(day: number, rawEdit: unknown, mem: MemoryStore) {
    const result = super.applyNightlyEdit(day, rawEdit, mem)
    this.editOutcomes.set(day, result.ok ? 'applied' : `rejected:${result.reason}`)
    return result
  }
}

function qInt(db: Database.Database, sql: string, ...params: unknown[]): number {
  return Number(db.prepare(sql).pluck().get(...params))
}

function qRows<T>(db: Database.Database, sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...params) as T[]
}

function eventCount(db: Database.Database, type: string, agentId: string): number {
  return qInt(db, `SELECT COUNT(*) FROM events WHERE type = ? AND json_extract(payload, '$.agentId') = ?`, type, agentId)
}

function flattenTags(tags: MemoryRow['tags']): string[] {
  return [...tags.people, ...(tags.place === null ? [] : [tags.place]), ...tags.objects, ...tags.topics]
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set')
    process.exit(2)
  }

  // 48×48 fixture: grass everywhere, river column at x=40, forest edge at y<5.
  const config: SimConfig = DEFAULT_CONFIG
  const terrain: TileId[][] = Array.from({ length: 48 }, (_, y) =>
    Array.from({ length: 48 }, (_, x): TileId => (x === 40 ? 2 : y < 5 ? 3 : 0)),
  )
  mkdirSync(DATA_DIR, { recursive: true })


  const db = openAgentDb(DB_PATH)
  migrateLlmTables(db)
  const store = new EventStore(db)
  const rng = new RngStreams('g3-live-tamar')
  let state = genesisState(config, terrain)
  const emit = (type: string, payload: unknown) => {
    const ev = store.append(state.tick, type, payload)
    state = fold(state, ev, config)
  }
  emit('agent_spawned', { id: AGENT, name: AGENT_NAME, x: 8, y: 10, ageDays: 31 })
  emit('structure_planned', {
    id: STOREHOUSE_ID, kind: 'storehouse', x: 10, y: 10, w: 1, h: 1,
    maxHp: 50, flammable: true, builderId: AGENT,
  })
  emit('structure_completed', { id: STOREHOUSE_ID })
  emit('item_spawned', { id: BREAD_ID, kind: 'bread', qty: 20, loc: { t: 'structure', id: STOREHOUSE_ID } })

  const worldTick = createWorldTick(config, rng)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store,
    state,
    rng,
    config,
    realMsPerTick: REAL_MS_PER_TICK,
    onTick: (ctx) => handler(ctx),
  })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  handler = bridge.wrapTickHandler(({ emit: e }) => {
    for (const ev of worldTick(loop.state).events) e(ev.type, ev.payload)
  })

  const embedder = await Embedder.create(MODELS_DIR)
  const personality = new RecordingPersonalityStore(db, AGENT)
  personality.init(TAMAR_PERSONALITY_V1 satisfies PersonalityDoc, 0)

  const turnLlm = new LlmClient({ db, caller: 'turn', agentId: AGENT, budgetUsd: BUDGET_USD })
  const reflectionLlm = makeReflectionLlm(new LlmClient({ db, caller: 'reflection', agentId: AGENT, budgetUsd: BUDGET_USD }))
  const dreamLlm = makeDreamLlm(new LlmClient({ db, caller: 'dream', agentId: AGENT, budgetUsd: BUDGET_USD }))

  const runtime = new AgentRuntime({
    db,
    llm: turnLlm,
    embedder,
    identity: TAMAR,
    personality,
    bridge,
    reflectionLlm,
    dreamLlm,
  })
  runtime.start(AGENT)

  // Manual stepping (not loop.start()) so we can record each tick's wall-clock
  // for assertion 3's "count llm_calls between the two events' ticks".
  const tickWallClock = new Map<number, number>()
  const startWall = Date.now()
  for (let i = 0; i < TOTAL_TICKS; i += 1) {
    const stepStart = Date.now()
    loop.step()
    tickWallClock.set(loop.tick, stepStart)
    if (loop.tick % 240 === 0) {
      const mins = ((Date.now() - startWall) / 60_000).toFixed(1)
      console.log(`[g3] tick ${loop.tick}/${TOTAL_TICKS} (${mins} min elapsed, turns=${runtime.stats().turns})`)
    }
    const elapsed = Date.now() - stepStart
    await sleep(Math.max(0, REAL_MS_PER_TICK - elapsed))
  }
  // A nightly reflection begun near the window's end must be allowed to finish:
  // its single calls can run for minutes with no new llm_calls row to observe,
  // so wait on the runtime's own signal (capped) before the settle loop.
  const reflectionDeadline = Date.now() + 300_000
  while (runtime.reflectionInFlight() && Date.now() < reflectionDeadline) {
    await sleep(2000)
  }
  // Stop ticking; wait for any in-flight turn/reflection/dream to settle so the
  // report reflects every call the run actually made.
  const settleDeadline = Date.now() + 60_000
  let lastLlmId = qInt(db, 'SELECT COALESCE(MAX(id), 0) FROM llm_calls')
  while (Date.now() < settleDeadline) {
    await sleep(2000)
    const nowId = qInt(db, 'SELECT COALESCE(MAX(id), 0) FROM llm_calls')
    if (nowId === lastLlmId) break
    lastLlmId = nowId
  }
  runtime.stop()

  const endTick = loop.tick

  // ---- Assertions 1–8 ----
  const sleptCount = eventCount(db, 'agent_slept', AGENT)
  const wokeCount = eventCount(db, 'agent_woke', AGENT)

  const eatCompletedCount = qInt(
    db,
    `SELECT COUNT(*) FROM events WHERE type = 'action_completed' AND json_extract(payload, '$.verb') = 'eat' AND json_extract(payload, '$.agentId') = ?`,
    AGENT,
  )
  const diedCount = eventCount(db, 'agent_died', AGENT)
  const finalAgent = loop.state.agents[AGENT]
  const deathPathReached = diedCount > 0 || finalAgent === undefined || !finalAgent.alive
  const finalHunger = finalAgent?.needs.hunger ?? 0

  // Assertion 3: longest run of consecutive action_started events whose every
  // adjacent gap saw zero 'turn' llm_calls (by wall-clock between the ticks).
  const actionStarted = qRows<{ seq: number; tick: number }>(
    db,
    `SELECT seq, tick FROM events WHERE type = 'action_started' AND json_extract(payload, '$.agentId') = ? ORDER BY seq`,
    AGENT,
  )
  const turnCalls = qRows<{ ts: number }>(db, `SELECT ts FROM llm_calls WHERE caller = 'turn' ORDER BY id`)
  const turnTs = turnCalls.map((c) => c.ts)
  let maxConsecutiveActionStartedWithoutTurn = 0
  let run = 0
  for (let i = 0; i < actionStarted.length; i += 1) {
    const prev = actionStarted[i - 1]
    const cur = actionStarted[i]!
    let gapTurns = 0
    if (prev !== undefined) {
      const a = tickWallClock.get(prev.tick)
      const b = tickWallClock.get(cur.tick)
      if (a !== undefined && b !== undefined) {
        gapTurns = turnTs.filter((ts) => ts > a && ts < b).length
      }
    }
    run = i === 0 || gapTurns > 0 ? 1 : run + 1
    if (run > maxConsecutiveActionStartedWithoutTurn) maxConsecutiveActionStartedWithoutTurn = run
  }

  const journalCount = qInt(db, `SELECT COUNT(*) FROM journal WHERE agent_id = ?`, AGENT)

  // Assertion 5.
  const dayNodeDays = qRows<{ day: number }>(db, `SELECT DISTINCT day FROM summary_nodes WHERE agent_id = ? AND level = 'day' ORDER BY day`, AGENT).map(
    (r) => r.day,
  )
  const factCount = qInt(db, `SELECT COUNT(*) FROM facts WHERE agent_id = ?`, AGENT)
  const autobiographyParagraphs = qInt(db, `SELECT COUNT(*) FROM autobiography WHERE agent_id = ?`, AGENT)
  const nightlyEditOutcomes: G3NightlyEditOutcome[] = [0, 1].map((day) => ({
    day,
    outcome: editOutcomeFor(personality, day),
  }))

  // Assertion 6.
  const turnRows = qRows<{ id: number; cache_read_tokens: number; input_tokens: number }>(
    db,
    `SELECT id, cache_read_tokens, input_tokens FROM llm_calls WHERE caller = 'turn' AND agent_id = ? ORDER BY id`,
    AGENT,
  )
  let cacheReadConsecutivePairFound = false
  for (let i = 1; i < turnRows.length; i += 1) {
    if (turnRows[i]!.cache_read_tokens > 0) {
      cacheReadConsecutivePairFound = true
      break
    }
  }
  const turnInputTokens = turnRows.reduce((s, r) => s + r.input_tokens, 0)
  const turnCacheRead = turnRows.reduce((s, r) => s + r.cache_read_tokens, 0)
  const cacheHitRate = turnInputTokens > 0 ? turnCacheRead / turnInputTokens : 0

  // Assertion 7.
  const mem = new MemoryStore(db, AGENT, embedder)
  const recalled = await recall(mem, 'storehouse bread', endTick)
  let recallVerbatimRowCount = 0
  for (const row of recalled) {
    const original = mem.getMemory(row.id)
    const tagHit = flattenTags(row.tags).some((t) => t === 'storehouse' || t === 'bread')
    if (original !== null && row.text === original.text && tagHit) recallVerbatimRowCount += 1
  }

  // Assertion 8.
  const allLlmRowsHaveCost = qInt(db, `SELECT COUNT(*) FROM llm_calls WHERE cost_usd IS NULL`) === 0
  const costByCaller = Object.fromEntries(
    qRows<{ caller: string; total: number }>(db, `SELECT caller, COALESCE(SUM(cost_usd), 0) AS total FROM llm_calls GROUP BY caller`).map(
      (r) => [r.caller, r.total],
    ),
  )
  const totalCostUsd = Object.values(costByCaller).reduce((s, v) => s + v, 0)
  const budgetTripped = totalCostUsd >= BUDGET_USD
  const llmCallCount = qInt(db, `SELECT COUNT(*) FROM llm_calls`)

  // Voice-card evidence: first verbatim thought + speech emitted.
  const firstThought = qRows<{ text: string }>(
    db,
    `SELECT text FROM memories WHERE agent_id = ? AND kind = 'thought' ORDER BY id LIMIT 1`,
    AGENT,
  )[0]?.text ?? ''
  const firstSpeech = qRows<{ payload: string }>(
    db,
    `SELECT payload FROM events WHERE type = 'agent_spoke' AND json_extract(payload, '$.agentId') = ? ORDER BY seq LIMIT 1`,
    AGENT,
  )[0]

  const report: G3Report = {
    generatedAt: new Date().toISOString(),
    agentId: AGENT,
    model: MIND_MODEL,
    totalTicks: TOTAL_TICKS,
    realMsPerTick: REAL_MS_PER_TICK,
    totalCostUsd,
    costByCaller,
    cacheHitRate,
    llmCallCount,
    excerpts: {
      thought: firstThought,
      speech: firstSpeech ? (JSON.parse(firstSpeech.payload) as { text: string }).text : null,
    },
    evidence: {
      sleptCount,
      wokeCount,
      eatCompletedCount,
      deathPathReached,
      finalHunger,
      maxConsecutiveActionStartedWithoutTurn,
      journalCount,
      dayNodeDays,
      factCount,
      autobiographyParagraphs,
      nightlyEditOutcomes,
      cacheReadConsecutivePairFound,
      recallVerbatimRowCount,
      allLlmRowsHaveCost,
      budgetTripped,
    },
  }

  G3ReportSchema.parse(report)
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))

  console.log('\n=== GATE G3 report ===')
  console.log(JSON.stringify(report, null, 2))
  console.log('\n=== per-caller cost ===')
  for (const [caller, cost] of Object.entries(costByCaller)) console.log(`  ${caller}: $${cost.toFixed(6)}`)
  console.log(`  TOTAL: $${totalCostUsd.toFixed(6)} (cap $${BUDGET_USD.toFixed(2)})`)
  console.log(`  cache-hit rate (turn calls): ${(cacheHitRate * 100).toFixed(1)}%`)

  // Assertion 9 is `pnpm test && pnpm typecheck`, run separately by the operator.
  const failed = failedAssertions(report)
  if (failed.length > 0) {
    console.error('\nGATE G3 FAILED assertions:')
    for (const f of failed) console.error(`  - ${f}`)
    console.error(`Report written to ${REPORT_PATH}`)
    process.exit(1)
  }
  console.log(`\nGATE G3 PASSED (8/8 programmatic assertions). Report: ${REPORT_PATH}`)
}

function editOutcomeFor(personality: RecordingPersonalityStore, day: number): string {
  const recorded = personality.editOutcomes.get(day)
  if (recorded !== undefined) return recorded
  // history() shows applied edits as a version row for that day; a null edit row
  // is the initial doc, so absence of a non-null edit means no edit was applied.
  const applied = personality.history().some((r) => r.day === day && r.edit !== null)
  return applied ? 'applied' : 'no_proposal'
}

function failedAssertions(report: G3Report): string[] {
  const e = report.evidence
  const out: string[] = []
  if (e.sleptCount < 2 || e.wokeCount < 2) out.push(`1.sleeps/wakes: slept=${e.sleptCount} woke=${e.wokeCount}`)
  if (e.eatCompletedCount < 2 || e.deathPathReached) out.push(`2.eats: eats=${e.eatCompletedCount} deathPath=${e.deathPathReached}`)
  if (e.maxConsecutiveActionStartedWithoutTurn < 2) out.push(`3.plans: maxConsecutive=${e.maxConsecutiveActionStartedWithoutTurn}`)
  if (e.journalCount < 1) out.push(`4.journals: ${e.journalCount}`)
  const day0 = e.dayNodeDays.includes(0)
  const day1 = e.dayNodeDays.includes(1)
  const facts = e.factCount >= 1
  const auto = e.autobiographyParagraphs === 2
  const edits = e.nightlyEditOutcomes.filter((o) => o.day === 0 || o.day === 1)
  const bothResolved = edits.length === 2 && edits.every((o) => o.outcome.startsWith('applied') || o.outcome.startsWith('rejected:'))
  if (!(day0 && day1 && facts && auto && bothResolved)) {
    out.push(`5.reflects: days=${e.dayNodeDays.join(',')} facts=${e.factCount} auto=${e.autobiographyParagraphs} edits=${JSON.stringify(e.nightlyEditOutcomes)}`)
  }
  if (!e.cacheReadConsecutivePairFound) out.push('6.cacheReadTokens: no consecutive turn pair with cache_read_tokens > 0')
  if (e.recallVerbatimRowCount < 1) out.push(`7.recall-verbatim: ${e.recallVerbatimRowCount} rows`)
  if (!e.allLlmRowsHaveCost || e.budgetTripped || report.totalCostUsd >= BUDGET_USD) {
    out.push(`8.cost: allHaveCost=${e.allLlmRowsHaveCost} budgetTripped=${e.budgetTripped} total=$${report.totalCostUsd.toFixed(6)}`)
  }
  return out
}

main().catch((err) => {
  console.error('g3-run crashed:', err)
  process.exit(1)
})
