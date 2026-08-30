// LIVE ONLY. `@sj/forge/gen` is 9.7 MB of LLM SDK, so this file is reachable from `liveWorld.ts`
// and nothing else — `discoveryArt.ts` beside it stays free of it for the scripted path.
import type Database from 'better-sqlite3'
import { insertLlmCall } from '@sj/llm'
import {
  ANOMALY_STOP_USD,
  BudgetGuard,
  loadReferenceSheet,
  type AssetCodex,
  type Forge,
} from '@sj/forge'
import {
  EST_COST_PER_VISION_CALL,
  createForge,
  makeImageClient,
  makeVisionJudge,
  type VisionJudgeFn,
} from '@sj/forge/gen'
import { noDiscoveryArt, watchDiscoveryArt, type DiscoveryArtWatcher } from './discoveryArt.js'

/** The ledger name art bills under, beside the minds' `turn`, `reflection` and `arbiter`. */
export const FORGE_CALLER = 'forge'

export type CommissionArtOpts = {
  codex: AssetCodex
  /** The minds' own ops db: every image books a row here, so one wallet answers for a thought
   *  and a picture alike. */
  opsDb: Database.Database
  /** Dollars this run may still spend, off that same ledger. `<= 0` refuses the commission. */
  spendableUsd: () => number
  /** Absent — no key — draws nothing. */
  apiKey: string | undefined
  onError?: (kind: string, err: unknown) => void
  /** The rehearsal's provider: the real `makeImageClient` runs, the network does not. */
  fetchFn?: typeof fetch
  /** The rehearsal's art reviewer, in place of the SDK-backed one. */
  judge?: VisionJudgeFn
}

/** Discoveries drawn for real, on the minds' budget. */
export function createDiscoveryArt(opts: CommissionArtOpts): DiscoveryArtWatcher {
  const apiKey = opts.apiKey
  if (apiKey === undefined) return noDiscoveryArt()

  let refs: Promise<Buffer[]> | null = null
  // Commissions run one at a time: side by side they would each read the same balance and each
  // spend it. Art is fire-and-forget, so the queue costs nothing anyone waits on.
  let queue: Promise<unknown> = Promise.resolve()

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
      // Art is billed by the image, not by a token table: the estimate IS the charge.
      estimatedCostUsd: costUsd,
      reportedCostUsd: null,
      latencyMs: 0,
      ok: true,
      error: null,
    })
  }

  const draw: Forge['commission'] = async (desc, footprint, klass, kind) => {
    const left = opts.spendableUsd()
    if (left <= 0) throw new Error(`no budget left to draw ${kind}`)
    // The cap is what the run has left, never past the per-asset anomaly stop, and it is read
    // fresh because the day rolls and the minds spend out of the same balance.
    const budget = new BudgetGuard(Math.min(ANOMALY_STOP_USD, left))
    const client = makeImageClient({
      apiKey,
      budget,
      ...(opts.fetchFn === undefined ? {} : { fetchFn: opts.fetchFn }),
    })
    const sheet = await (refs ??= loadReferenceSheet())
    const judge = opts.judge ?? makeVisionJudge({ apiKey, refs: sheet })
    return createForge({
      codex: opts.codex,
      refs: sheet,
      client: {
        async generateCandidates(prompt, candidateRefs, n) {
          // Reserved with the picture, not after it: a balance that cannot pay for both must
          // refuse before the picture is bought.
          budget.spend(EST_COST_PER_VISION_CALL)
          const out = await client.generateCandidates(prompt, candidateRefs, n)
          for (const c of out) book(c.model, c.costUsd)
          return out
        },
      },
      judge: async (a) => {
        const reviewed = await judge(a)
        book(reviewed.verdict.model, reviewed.costUsd)
        return reviewed
      },
    }).commission(desc, footprint, klass, kind)
  }

  return watchDiscoveryArt({
    forge: {
      commission: (desc, footprint, klass, kind) => {
        const mine = queue.then(() => draw(desc, footprint, klass, kind))
        queue = mine.catch(() => undefined)
        return mine
      },
    },
    codex: opts.codex,
    ...(opts.onError === undefined ? {} : { onError: opts.onError }),
  })
}
