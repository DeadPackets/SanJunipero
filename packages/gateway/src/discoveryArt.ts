// LIVE ONLY. `@sj/forge/gen` carries the LLM SDK the free scripted stream must never load, so
// nothing on the scripted path may import this file (enforced by test).
import type Database from 'better-sqlite3'
import { insertLlmCall } from '@sj/agents'
import {
  ANOMALY_STOP_USD,
  BudgetExceededError,
  BudgetGuard,
  loadReferenceSheet,
  type AssetCodex,
  type Forge,
} from '@sj/forge'
import {
  EST_COST_PER_JUDGE,
  JUDGE_MODEL,
  createForge,
  makeImageClient,
  makeVlmJudge,
  type JudgeFn,
} from '@sj/forge/gen'

/**
 * Commissioning writes the `assets` table — not the event log, not folded — so it runs off the
 * tick and cannot move a golden. `commission()` never rejects, so art never blocks a discovery.
 */

/** The item kinds a discovery names that the codex has no art for. Sorted, deduped. */
export function artNeededFor(makes: readonly string[], known: ReadonlySet<string>): string[] {
  return [...new Set(makes)].filter((k) => !known.has(k)).sort()
}

// A kind is a slug in the engine and PROSE to a model. This text never enters the world, so
// the framing law does not reach it.
export function itemCommissionText(kind: string, discoveryName: string): string {
  const words = kind.replace(/_/g, ' ')
  return `A single ${words}, the object itself, lying still — the thing a townsperson gets when they ${discoveryName}.`
}

export type DiscoveryArtWatcher = {
  /** Fire-and-forget. Returns immediately; the art arrives when it arrives. */
  onDiscovery(d: { name: string; makes: readonly string[] }): void
  /** Awaits everything in flight. Tests only — the live run never waits on art. */
  settle(): Promise<void>
}

export function watchDiscoveryArt(deps: {
  forge: Pick<Forge, 'commission'>
  codex: Pick<AssetCodex, 'listSince' | 'onAssetReady'>
  onError?: (kind: string, err: unknown) => void
}): DiscoveryArtWatcher {
  // Every kind the codex has ever registered, kept live. `listSince(0)` seeds it once; the
  // ready callback keeps it current, including for art this watcher did not ask for.
  const known = new Set<string>()
  for (const rec of deps.codex.listSince(0)) if (rec.kind !== null) known.add(rec.kind)
  deps.codex.onAssetReady((rec) => {
    if (rec.kind !== null) known.add(rec.kind)
  })

  const inFlight = new Set<Promise<unknown>>()

  return {
    onDiscovery(d) {
      for (const kind of artNeededFor(d.makes, known)) {
        // Claimed BEFORE the await, so a second discovery naming the same kind in the same
        // breath does not pay for it twice.
        known.add(kind)
        const p: Promise<unknown> = deps.forge
          .commission(itemCommissionText(kind, d.name), { w: 1, h: 1 }, 'item', kind)
          .catch((err: unknown) => {
            // commission() contracts never to reject; if it somehow does, the kind goes back
            // so a later discovery can try again, and the run does not stop for a picture.
            known.delete(kind)
            deps.onError?.(kind, err)
          })
          .finally(() => {
            inFlight.delete(p)
          })
        inFlight.add(p)
      }
    },
    async settle() {
      while (inFlight.size > 0) await Promise.all([...inFlight])
    },
  }
}

/** The ledger name art bills under, beside the minds' `turn`, `reflection` and `arbiter`. */
export const FORGE_CALLER = 'forge'

export type CommissionArtOpts = {
  codex: AssetCodex
  /** The minds' own ops db. Art is read out of the same daily budget and booked into the same
   *  `llm_calls` table, so one wallet answers for a thought and a picture alike. */
  opsDb: Database.Database
  dailyBudgetUsd: number
  spentTodayUsd: () => number
  apiKey: string
  onError?: (kind: string, err: unknown) => void
  /** The rehearsal's provider: the real client and judge run, the network does not. */
  fetchFn?: typeof fetch
  judge?: JudgeFn
}

/** Discoveries drawn for real, on the minds' budget. */
export function createDiscoveryArt(opts: CommissionArtOpts): DiscoveryArtWatcher {
  let refs: Promise<Buffer[]> | null = null
  const book = (model: string, costUsd: number): void => {
    insertLlmCall(opts.opsDb, {
      agentId: null,
      caller: FORGE_CALLER,
      model,
      provider: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      costUsd,
      reportedCostUsd: null,
      latencyMs: 0,
      ok: true,
      error: null,
    })
  }

  const commission: Forge['commission'] = async (desc, footprint, klass, kind) => {
    const left = opts.dailyBudgetUsd - opts.spentTodayUsd()
    if (left <= 0) throw new BudgetExceededError(opts.dailyBudgetUsd, opts.spentTodayUsd())
    // One guard per commission: its cap is what the rolling day has left, never past the
    // per-asset anomaly stop, and it is re-read because the day rolls and the minds spend too.
    const budget = new BudgetGuard(Math.min(ANOMALY_STOP_USD, left))
    const client = makeImageClient({
      apiKey: opts.apiKey,
      budget,
      ...(opts.fetchFn === undefined ? {} : { fetchFn: opts.fetchFn }),
    })
    const sheet = await (refs ??= loadReferenceSheet())
    const judge = opts.judge ?? makeVlmJudge({ apiKey: opts.apiKey, refSheets: sheet })
    return createForge({
      codex: opts.codex,
      refs: sheet,
      client: {
        async generateCandidates(prompt, candidateRefs, n) {
          const out = await client.generateCandidates(prompt, candidateRefs, n)
          for (const c of out) book(c.model, c.costUsd)
          return out
        },
      },
      judge: async (png) => {
        budget.spend(EST_COST_PER_JUDGE)
        const verdict = await judge(png)
        book(JUDGE_MODEL, EST_COST_PER_JUDGE)
        return verdict
      },
    }).commission(desc, footprint, klass, kind)
  }

  return watchDiscoveryArt({
    forge: { commission },
    codex: opts.codex,
    ...(opts.onError === undefined ? {} : { onError: opts.onError }),
  })
}

/** A watcher that draws nothing: a run with no image budget must still record every discovery. */
export function noDiscoveryArt(): DiscoveryArtWatcher {
  return {
    onDiscovery() {
      /* the record is already in the world log; a picture is not owed */
    },
    async settle() {
      /* nothing was ever in flight */
    },
  }
}
