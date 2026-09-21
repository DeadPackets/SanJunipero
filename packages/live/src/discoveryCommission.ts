// LIVE ONLY. `@sj/forge/gen` is 9.7 MB of LLM SDK, so this file is reachable from `liveWorld.ts`
// and nothing else — `discoveryArt.ts` beside it stays free of it for the scripted path.
import type Database from 'better-sqlite3'
import { makeBudgetGuard } from '@sj/llm'
import {
  PER_ASSET_STOP_USD,
  BudgetGuard,
  BudgetExceededError,
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
  artDailyUsd?: number
  signal?: AbortSignal
  /** Absent — no key — draws nothing. */
  apiKey: string | undefined
  onError?: (kind: string, err: unknown) => void
  /** The rehearsal's provider: the real `makeImageClient` runs, the network does not. */
  fetchFn?: typeof fetch
  /** The rehearsal's art reviewer, in place of the SDK-backed one. */
  judge?: VisionJudgeFn
}

function reserveArtCharge(opts: CommissionArtOpts, budget: BudgetGuard) {
  const guard = makeBudgetGuard(opts.opsDb, FORGE_CALLER)
  return (model: string, expectedUsd: number) => {
    opts.signal?.throwIfAborted()
    budget.spend(expectedUsd)
    const artDailyUsd = opts.artDailyUsd ?? LIVE_ART_DAILY_USD
    const reservation = guard.reserve(expectedUsd, null, {
      usd: artDailyUsd,
      sinceMs: Date.now() - ART_DAY_MS,
    })
    if ('held' in reservation) {
      budget.release(expectedUsd)
      throw new BudgetExceededError(artDailyUsd, reservation.spentUsd + expectedUsd)
    }
    let settled = false
    return {
      settle(costUsd: number) {
        guard.reconcile(reservation.id, {
          agentId: null,
          caller: FORGE_CALLER,
          model,
          provider: null,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          reasoningTokens: 0,
          costUsd,
          estimatedCostUsd: expectedUsd,
          reportedCostUsd: costUsd,
          latencyMs: 0,
          finishReason: null,
          ok: true,
          error: null,
        })
        if (settled) return
        settled = true
        if (costUsd > expectedUsd) budget.spend(costUsd - expectedUsd)
        else budget.release(expectedUsd - costUsd)
      },
      retainUncertain() {
        guard.retainUncertain(reservation.id)
        settled = true
      },
      release() {
        guard.release(reservation.id)
        if (!settled) {
          budget.release(expectedUsd)
          settled = true
        }
      },
    }
  }
}

export function createDiscoveryArt(opts: CommissionArtOpts): DiscoveryArtWatcher {
  const apiKey = opts.apiKey
  if (apiKey === undefined || (opts.artDailyUsd ?? LIVE_ART_DAILY_USD) <= 0) return noDiscoveryArt()

  let refs: Promise<Buffer[]> | null = null
  // One commission at a time bounds image processing memory.
  let queue: Promise<unknown> = Promise.resolve()

  const draw: Forge['commission'] = async (desc, footprint, klass, kind) => {
    opts.signal?.throwIfAborted()
    const budget = new BudgetGuard(PER_ASSET_STOP_USD)
    const reserveCharge = reserveArtCharge(opts, budget)
    const client = makeImageClient({
      apiKey,
      reserveCharge,
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      ...(opts.fetchFn === undefined ? {} : { fetchFn: opts.fetchFn }),
    })
    // A rejected sheet must not be memoised: one bad encode would draw nothing ever again.
    const sheet = await (refs ??= loadReferenceSheet().catch((e: unknown) => {
      refs = null
      throw e
    }))
    let eye: ReturnType<typeof reserveCharge> | null = null
    const releaseEye = () => {
      eye?.release()
      eye = null
    }
    const config = loadForgeConfig()
    const judge =
      opts.judge ??
      makeVisionJudge({
        apiKey,
        refs: sheet,
        config,
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
        onCharge: (_model, costUsd) => eye?.settle(costUsd),
      })
    try {
      return await createForge({
        codex: opts.codex,
        refs: sheet,
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
        client: {
          async generateCandidates(prompt, candidateRefs, n) {
            releaseEye()
            eye = reserveCharge(config.visionQa.model, EST_COST_PER_VISION_CALL)
            return client.generateCandidates(prompt, candidateRefs, n)
          },
        },
        judge: async (a) => {
          let dispatched = false
          try {
            opts.signal?.throwIfAborted()
            dispatched = true
            const reviewed = await judge(a)
            eye?.settle(reviewed.costUsd)
            return reviewed
          } catch (err) {
            if (dispatched) eye?.retainUncertain()
            throw err
          } finally {
            releaseEye()
          }
        },
      }).commission(desc, footprint, klass, kind)
    } finally {
      releaseEye()
    }
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
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    ...(opts.onError === undefined ? {} : { onError: opts.onError }),
  })
}

/** How much of a day's art money is still there. One sim day is a real day here, the same
 *  window `liveWorld` reads the minds' own daily budget over. */
const ART_DAY_MS = 24 * 60 * 60 * 1000

export type CastArtOpts = CommissionArtOpts & {
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

  return watchCastArt({
    codex: opts.codex,
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    artSpendableUsd: () => artDailyUsd - artSpentUsd(opts.opsDb, Date.now() - ART_DAY_MS),
    ...(opts.onError === undefined ? {} : { onError: opts.onError }),
    draw: async (p) => {
      opts.signal?.throwIfAborted()
      const budget = new BudgetGuard(PER_ASSET_STOP_USD)
      const generate = characterImageClient({
        apiKey,
        reserveCharge: reserveArtCharge(opts, budget),
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
        ...(opts.fetchFn === undefined ? {} : { fetchFn: opts.fetchFn }),
      })
      const sheet = await commissionCharacter(
        {
          onNote: (line) => opts.onNote?.(p.id, line),
          onRefused: (reason) => opts.onError?.(characterKind(p.id), new Error(reason)),
          generate,
        },
        lookOf(p),
      )
      if (sheet === null) throw new Error('character generation did not pass its image gates')
      opts.signal?.throwIfAborted()
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
