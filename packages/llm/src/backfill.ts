import type Database from 'better-sqlite3'
import {
  insertAlert,
  unattributedCalls,
  updateCallPricing,
  type UnattributedCall,
} from './callLog.js'
import { bookCostUsd, computeCostUsd } from './pricing.js'

const GENERATION_URL = 'https://openrouter.ai/api/v1/generation'

/** OpenRouter writes a generation's accounting row a moment after the stream closes; asked
 *  sooner it answers 404. */
const BACKFILL_DELAY_MS = 5_000

/** Past this the endpoint will never answer, and re-asking would hold every newer row behind a
 *  permanent failure for the life of the run. */
const BACKFILL_GIVE_UP_MS = 60 * 60 * 1000

/** One sweep's worth. What it leaves behind, the next sweep picks up. */
const BACKFILL_LIMIT = 25

const FETCH_TIMEOUT_MS = 10_000

type GenerationFacts = { provider: string; costUsd: number | null }

export type BackfillOpts = {
  apiKey: string
  fetchFn?: typeof fetch
  now?: number
  delayMs?: number
  signal?: AbortSignal
  /** Generation ids this run has already been refused, ADDED TO as more are. A 404 here is
   *  permanent, and re-asking holds every newer row out of the window until it ages out. */
  unclaimable?: Set<string>
}

export type BackfillResult = { attempted: number; backfilled: number }

// Null on anything but an answer that names a back end: a backfill that cannot be trusted must
// leave the ceiling price standing rather than replace it with a guess.
async function fetchGeneration(
  id: string,
  opts: { apiKey: string; fetchFn?: typeof fetch; signal?: AbortSignal },
): Promise<GenerationFacts | null> {
  const doFetch = opts.fetchFn ?? fetch
  try {
    const res = await doFetch(`${GENERATION_URL}?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      signal: AbortSignal.any([
        AbortSignal.timeout(FETCH_TIMEOUT_MS),
        ...(opts.signal === undefined ? [] : [opts.signal]),
      ]),
    })
    if (!res.ok) return null
    const data = ((await res.json()) as { data?: Record<string, unknown> } | undefined)?.data
    const provider = data?.provider_name
    if (typeof provider !== 'string' || provider.length === 0) return null
    const cost = data?.total_cost
    return {
      provider,
      costUsd: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null,
    }
  } catch {
    return null
  }
}

/** Rows whose answer named no back end book at the ceiling and can never be reconciled. This
 *  asks OpenRouter who served them, re-prices them, and re-runs the per-call reconciliation. */
export async function backfillUnattributed(
  db: Database.Database,
  opts: BackfillOpts,
): Promise<BackfillResult> {
  if (opts.signal?.aborted) return { attempted: 0, backfilled: 0 }
  const now = opts.now ?? Date.now()
  const rows = unattributedCalls(db, {
    from: now - BACKFILL_GIVE_UP_MS,
    until: now - (opts.delayMs ?? BACKFILL_DELAY_MS),
    limit: BACKFILL_LIMIT,
    skip: opts.unclaimable === undefined ? [] : [...opts.unclaimable],
  })
  const named: { call: UnattributedCall; facts: GenerationFacts }[] = []
  let attempted = 0
  for (const call of rows) {
    if (opts.signal?.aborted) break
    attempted++
    const facts = await fetchGeneration(call.generationId, opts)
    // A failed backfill leaves the ceiling price and its alert exactly where they were.
    if (facts !== null) named.push({ call, facts })
    else if (!opts.signal?.aborted) opts.unclaimable?.add(call.generationId)
  }
  // One transaction for the sweep: better-sqlite3 fsyncs per statement, and this runs on the
  // same thread as the world tick.
  db.transaction(() => {
    for (const { call, facts } of named) {
      const computed = computeCostUsd(
        call.inputTokens,
        call.outputTokens,
        call.cacheReadTokens,
        call.model,
        facts.provider,
      )
      const costUsd = bookCostUsd(db, {
        agentId: call.agentId,
        computed,
        reported: facts.costUsd,
        served: call.model,
        provider: facts.provider,
        alertCeiling: false,
      })
      updateCallPricing(db, call.id, {
        provider: facts.provider,
        reportedCostUsd: facts.costUsd,
        estimatedCostUsd: computed.costUsd,
        costUsd,
      })
      insertAlert(db, {
        agentId: call.agentId,
        kind: 'llm_price_backfilled',
        detail:
          `${call.generationId} was served by ${facts.provider}; re-priced from the ceiling ` +
          `to $${costUsd.toFixed(6)} (prices from ${computed.source})`,
      })
    }
  })()
  return { attempted, backfilled: named.length }
}
