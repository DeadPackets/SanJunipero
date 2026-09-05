// LIVE ONLY. `@sj/forge/gen` is 9.7 MB of LLM SDK, so this file is reachable from `liveWorld.ts`
// and nothing else — `discoveryArt.ts` beside it stays free of it for the scripted path.
import type Database from 'better-sqlite3'
import { insertLlmCall } from '@sj/llm'
import {
  PER_ASSET_STOP_USD,
  BudgetGuard,
  CAST_V5,
  characterImageClient,
  characterKind,
  commissionCharacter,
  loadForgeConfig,
  loadReferenceSheet,
  lookFor,
  type AssetCodex,
  type CastLook,
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
import {
  LIVE_ART_DAILY_USD,
  noCastArt,
  watchCastArt,
  type CastArtWatcher,
  type NewPerson,
} from './castArt.js'

export const FORGE_CALLER = 'forge'

/** Every dollar art has cost since `sinceMs`. Faces and objects come out of the same pocket,
 *  so the day's art cap is read off both. */
export function artSpentUsd(db: Database.Database, sinceMs = 0): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_calls WHERE caller = ? AND ts >= ?`,
    )
    .get(FORGE_CALLER, sinceMs) as { total: number }
  return row.total
}

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

/** One image, on the ledger the minds bill — so one wallet answers for a thought and a picture. */
const bookOn =
  (opsDb: Database.Database) =>
  (model: string, costUsd: number): void => {
    insertLlmCall(opsDb, {
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
      finishReason: null,
      ok: true,
      error: null,
    })
  }

export function createDiscoveryArt(opts: CommissionArtOpts): DiscoveryArtWatcher {
  const apiKey = opts.apiKey
  if (apiKey === undefined) return noDiscoveryArt()

  let refs: Promise<Buffer[]> | null = null
  // Commissions run one at a time: side by side they would each read the same balance and each
  // spend it. Art is fire-and-forget, so the queue costs nothing anyone waits on.
  let queue: Promise<unknown> = Promise.resolve()

  const book = bookOn(opts.opsDb)

  const draw: Forge['commission'] = async (desc, footprint, klass, kind) => {
    const left = opts.spendableUsd()
    if (left <= 0) throw new Error(`no budget left to draw ${kind}`)
    // The cap is what the run has left, never past the per-asset anomaly stop, and it is read
    // fresh because the day rolls and the minds spend out of the same balance.
    const budget = new BudgetGuard(Math.min(PER_ASSET_STOP_USD, left))
    const client = makeImageClient({
      apiKey,
      budget,
      onCharge: book,
      ...(opts.fetchFn === undefined ? {} : { fetchFn: opts.fetchFn }),
    })
    // A rejected sheet must not be memoised: one bad encode would draw nothing ever again.
    const sheet = await (refs ??= loadReferenceSheet().catch((e: unknown) => {
      refs = null
      throw e
    }))
    // The eye draws the retry-vs-blocked line, so it reads the operator's config, not the defaults.
    const judge = opts.judge ?? makeVisionJudge({ apiKey, refs: sheet, config: loadForgeConfig() })
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

/** How much of a day's art money is still there. One sim day is a real day here, the same
 *  window `liveWorld` reads the minds' own daily budget over. */
const ART_DAY_MS = 24 * 60 * 60 * 1000

export type CastArtOpts = CommissionArtOpts & {
  /** What a DAY may put into faces. `0` draws nothing — `SJ_ART_DAILY_USD`. */
  artDailyUsd?: number
  /** Every measurement one commission made, for the operator's log. */
  onNote?: (agentId: string, line: string) => void
}

/** The look a person is drawn from: an authored id keeps the design a human signed off, and
 *  anybody else is derived from their own id. */
export function lookOf(p: NewPerson): CastLook {
  return CAST_V5.find((c) => c.id === p.id) ?? lookFor(p)
}

/** A face for a person the town made. The sheet registers exactly as `registerCommittedCast`
 *  writes a committed one — `character:<id>`, class `rig-part`, the manifest as the meta — so the
 *  renderer cannot tell a founder's sheet from a stranger's. */
export function createCastArt(opts: CastArtOpts): CastArtWatcher {
  const apiKey = opts.apiKey
  const artDailyUsd = opts.artDailyUsd ?? LIVE_ART_DAILY_USD
  if (apiKey === undefined || artDailyUsd <= 0) return noCastArt()

  const generate = characterImageClient({
    apiKey,
    onCharge: bookOn(opts.opsDb),
    ...(opts.fetchFn === undefined ? {} : { fetchFn: opts.fetchFn }),
  })

  return watchCastArt({
    codex: opts.codex,
    artSpendableUsd: () =>
      Math.min(opts.spendableUsd(), artDailyUsd - artSpentUsd(opts.opsDb, Date.now() - ART_DAY_MS)),
    ...(opts.onError === undefined ? {} : { onError: opts.onError }),
    draw: async (p) => {
      // The cap is what the day's art has left, never past the per-asset anomaly stop, and it is
      // read fresh because the minds spend out of the same balance.
      const left = Math.min(
        PER_ASSET_STOP_USD,
        opts.spendableUsd(),
        artDailyUsd - artSpentUsd(opts.opsDb, Date.now() - ART_DAY_MS),
      )
      const budget = new BudgetGuard(Math.max(0, left))
      const sheet = await commissionCharacter(
        {
          onNote: (line) => opts.onNote?.(p.id, line),
          onRefused: (reason) => opts.onError?.(characterKind(p.id), new Error(reason)),
          generate: async (req) => {
            // Reserved with the picture: a balance that cannot pay for the next cell must refuse
            // before it is bought, and `BudgetExceededError` stops the whole commission.
            budget.spend(req.reserveUsd)
            const img = await generate(req)
            if (img.costUsd > req.reserveUsd) budget.spend(img.costUsd - req.reserveUsd)
            return img
          },
        },
        lookOf(p),
      )
      if (sheet === null) return
      const cells = Object.values(sheet.manifest.cells)
      opts.codex.register({
        class: 'rig-part',
        kind: characterKind(p.id),
        desc: `character sheet v4: ${p.id}`,
        meta: JSON.stringify(sheet.manifest),
        footprint: { w: 1, h: 1 },
        png: sheet.atlas,
        widthPx: Math.max(...cells.map((r) => r.x + r.w)),
        heightPx: Math.max(...cells.map((r) => r.y + r.h)),
        status: 'ready',
        score: null,
        attempts: 1,
        costUsd: budget.total,
      })
    },
  })
}
