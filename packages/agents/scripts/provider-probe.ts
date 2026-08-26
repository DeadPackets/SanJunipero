// LIVE (~2c) — pick the turn provider BY PROBE: a datasheet does not say whether a provider
// will emit an OPTIONAL schema property, and a mind that cannot emit `action` cannot act.
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { openAgentDb } from '../src/memory/schema.js'
import { migrateLlmTables } from '../src/llm/callLog.js'
import { LlmClient } from '../src/llm/client.js'
import { MIND_MODEL, PROVIDER_ORDER } from '../src/llm/pins.js'
import {
  runPreflight,
  type PreflightAnswer,
  type PreflightResult,
} from '../src/live/providerPreflight.js'

const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url))
const DB_PATH = path.join(DATA_DIR, 'provider-probe.db')
const OUT_PATH = path.join(DATA_DIR, 'provider-probe.json')

// STOP tripwire. Twelve calls at the observed ~$0.0003 each is ~$0.004; ten times that is a
// bug, not a probe.
const CAP_USD = 0.25

type Candidate = { name: string; order: string[]; hardAllowList: boolean }

// The C8 candidate set, plus batch 11's routing — the only configuration ever measured to
// work end to end. DeepInfra is the CONTROL: it is expected to fail, and a probe whose known
// failure passes is a probe that is not measuring anything.
const CANDIDATES: Candidate[] = [
  { name: 'StreamLake', order: ['StreamLake'], hardAllowList: true },
  { name: 'Baidu', order: ['Baidu'], hardAllowList: true },
  { name: 'DeepInfra', order: ['DeepInfra'], hardAllowList: true },
  { name: 'unpinned', order: PROVIDER_ORDER, hardAllowList: false },
]

// Three calls is the gate's bar and also a coin flip on an optional field: one run passed three
// of four candidates and the next passed none, on identical code. ROUNDS repeats the whole bar.
const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 1)

type Row = {
  candidate: string
  hardAllowList: boolean
  rounds: PreflightResult[]
  roundsPassed: number
  actions: number
  speeches: number
  answered: number
  calls: number
  costUsd: number
  servedProviders: string[]
  failures: string[]
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  publishedPricePerM: { prompt: number; completion: number } | null
  answers: PreflightAnswer[]
}

// Our own cost model prices the pinned model, not the back end that served it, so the booked
// figure cannot separate two providers of one model — OpenRouter's per-provider pricing can.
async function publishedPrices(): Promise<Map<string, { prompt: number; completion: number }>> {
  const out = new Map<string, { prompt: number; completion: number }>()
  try {
    const res = await fetch(`https://openrouter.ai/api/v1/models/${MIND_MODEL}/endpoints`)
    if (!res.ok) return out
    const body = (await res.json()) as {
      data?: {
        endpoints?: Array<{
          provider_name?: string
          pricing?: { prompt?: string; completion?: string }
        }>
      }
    }
    for (const e of body.data?.endpoints ?? []) {
      if (e.provider_name === undefined) continue
      out.set(e.provider_name, {
        prompt: Number(e.pricing?.prompt ?? 0) * 1e6,
        completion: Number(e.pricing?.completion ?? 0) * 1e6,
      })
    }
  } catch (err) {
    console.warn('[probe] published pricing unavailable:', err instanceof Error ? err.message : err)
  }
  return out
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set (run with node --env-file=<repo>/.env)')
    process.exit(2)
  }
  mkdirSync(DATA_DIR, { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  const db = openAgentDb(DB_PATH)
  migrateLlmTables(db)

  const prices = await publishedPrices()
  const num = (sql: string, ...p: unknown[]): number =>
    Number(
      db
        .prepare(sql)
        .pluck()
        .get(...p),
    )
  const rows: Row[] = []

  const only = (process.env.PROBE_ONLY ?? '').split(',').filter((x) => x.length > 0)
  for (const c of CANDIDATES.filter((x) => only.length === 0 || only.includes(x.name))) {
    const llm = new LlmClient({
      db,
      caller: c.name,
      providerOrder: c.order,
      allowProviderFallbacks: !c.hardAllowList,
      // One attempt each: a retry would hide the very failure being measured. Ninety seconds,
      // because a turn call answers in a few and a probe must not sit on a stalled back end.
      maxRetries: 0,
      requestTimeoutMs: 90_000,
    })
    const answers: PreflightAnswer[] = []
    const rounds: PreflightResult[] = []
    for (let round = 0; round < ROUNDS; round++) {
      const result = await runPreflight({
        llm,
        provider: c.name,
        hardAllowList: c.hardAllowList,
        model: MIND_MODEL,
        onAnswer: (a) => answers.push(a),
        costUsd: () =>
          num('SELECT COALESCE(SUM(cost_usd),0) FROM llm_calls WHERE caller = ?', c.name),
        servedProviders: () =>
          (
            db
              .prepare(
                'SELECT DISTINCT provider FROM llm_calls WHERE caller = ? AND provider IS NOT NULL',
              )
              .all(c.name) as Array<{ provider: string }>
          ).map((r) => r.provider),
      })
      rounds.push(result)
      console.log(
        `[probe] ${c.name} round ${round + 1}/${ROUNDS}: action ${result.actions}/${result.calls},` +
          ` speech ${result.speeches}/${result.calls}, ${result.passed ? 'PASS' : 'FAIL'},` +
          ` served ${result.servedProviders.join(',') || 'unattributed'}`,
      )
      for (const f of result.failures) console.log(`    failed: ${f.slice(0, 220)}`)
      const spent = num('SELECT COALESCE(SUM(cost_usd),0) FROM llm_calls')
      if (spent > CAP_USD) {
        console.error(`STOP: $${spent.toFixed(4)} past the $${CAP_USD} probe cap`)
        process.exit(1)
      }
    }
    const sum = (pick: (r: PreflightResult) => number): number =>
      rounds.reduce((a, r) => a + pick(r), 0)
    const served = [...new Set(rounds.flatMap((r) => r.servedProviders))].sort()
    rows.push({
      candidate: c.name,
      hardAllowList: c.hardAllowList,
      rounds,
      roundsPassed: rounds.filter((r) => r.passed).length,
      actions: sum((r) => r.actions),
      speeches: sum((r) => r.speeches),
      answered: sum((r) => r.answered),
      calls: sum((r) => r.calls),
      costUsd: num('SELECT COALESCE(SUM(cost_usd),0) FROM llm_calls WHERE caller = ?', c.name),
      servedProviders: served,
      failures: rounds.flatMap((r) => r.failures),
      inputTokens: num(
        'SELECT COALESCE(SUM(input_tokens),0) FROM llm_calls WHERE caller = ?',
        c.name,
      ),
      outputTokens: num(
        'SELECT COALESCE(SUM(output_tokens),0) FROM llm_calls WHERE caller = ?',
        c.name,
      ),
      cacheReadTokens: num(
        'SELECT COALESCE(SUM(cache_read_tokens),0) FROM llm_calls WHERE caller = ?',
        c.name,
      ),
      publishedPricePerM: (served[0] === undefined ? undefined : prices.get(served[0])) ?? null,
      answers,
    })
  }

  const total = num('SELECT COALESCE(SUM(cost_usd),0) FROM llm_calls')
  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), model: MIND_MODEL, totalCostUsd: total, rows },
      null,
      2,
    ),
  )

  console.log(
    `\n| candidate | pinned | served | rounds passed | action | speech | unparseable | cache read | $ | published $/M in |`,
  )
  console.log('|---|---|---|---:|---:|---:|---:|---:|---:|---:|')
  for (const r of rows) {
    const cache = r.inputTokens === 0 ? 0 : (r.cacheReadTokens / r.inputTokens) * 100
    console.log(
      `| ${r.candidate} | ${r.hardAllowList} | ${r.servedProviders.join(',') || 'unattributed'}` +
        ` | ${r.roundsPassed}/${ROUNDS} | ${r.actions}/${r.calls} | ${r.speeches}/${r.calls}` +
        ` | ${r.calls - r.answered} | ${cache.toFixed(1)}%` +
        ` | $${r.costUsd.toFixed(6)} | ${r.publishedPricePerM === null ? 'n/a' : `$${r.publishedPricePerM.prompt.toFixed(3)}`} |`,
    )
  }
  // A candidate is only a pin if it clears the bar EVERY round: the gate refuses to start on
  // one bad round, so a provider that passes half the time is a gate that starts half the time.
  const passers = rows.filter((r) => r.hardAllowList && r.roundsPassed === ROUNDS)
  console.log(
    `\nTOTAL $${total.toFixed(6)} over ${num('SELECT COUNT(*) FROM llm_calls')} calls. Written to ${OUT_PATH}`,
  )
  console.log(
    passers.length === 0
      ? 'NO PINNED CANDIDATE PASSES EVERY ROUND. The gate runs unpinned with fallbacks on.'
      : `Pinned passers, cheapest first: ${[...passers]
          .sort((a, b) => a.costUsd - b.costUsd)
          .map((r) => r.candidate)
          .join(', ')}`,
  )
}

main().catch((err) => {
  console.error('provider-probe crashed:', err)
  process.exit(1)
})
