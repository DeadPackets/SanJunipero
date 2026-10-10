import type Database from 'better-sqlite3'
import type { PublicUsage, MindStatus } from '@sj/shared'
import type { Router } from './router.js'
import { sendJson } from './http.js'

export type UsageSource = () => {
  live: boolean
  db: Database.Database | null
  mindStatus: MindStatus
} | null
const CACHE_MS = 10_000
const DAY_MS = 86_400_000
const ZERO = { calls: 0, usd: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }
type Totals = typeof ZERO

export function publicUsageReader(
  source: UsageSource,
  now: () => number = Date.now,
): () => PublicUsage {
  let cached: PublicUsage | null = null
  let readAt = -Infinity
  return () => {
    const at = now()
    if (cached && at >= readAt && at - readAt < CACHE_MS) return cached
    const unavailable: PublicUsage = {
      mode: 'unavailable',
      mindStatus: 'delayed',
      updatedAt: at,
      total: null,
      last24h: null,
    }
    try {
      const current = source()
      if (!current) cached = unavailable
      else if (!current.live)
        cached = {
          mode: 'scripted',
          mindStatus: 'disabled',
          updatedAt: at,
          total: ZERO,
          last24h: ZERO,
        }
      else if (!current.db) cached = unavailable
      else {
        const rows = current.db
          .prepare(`SELECT
          CASE WHEN ts >= @day THEN 1 ELSE 0 END AS recent,
          COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS usd,
          COALESCE(SUM(input_tokens), 0) AS inputTokens,
          COALESCE(SUM(output_tokens), 0) AS outputTokens,
          COALESCE(SUM(cache_read_tokens), 0) AS cachedInputTokens
          FROM llm_calls GROUP BY recent`)
          .all({ day: at - DAY_MS }) as (Totals & { recent: number })[]
        const total = { ...ZERO }
        let last24h = { ...ZERO }
        for (const { recent, ...row } of rows) {
          for (const key of Object.keys(total) as (keyof Totals)[]) total[key] += row[key]
          if (recent === 1) last24h = row
        }
        cached = { mode: 'live', mindStatus: current.mindStatus, updatedAt: at, total, last24h }
      }
    } catch {
      cached = unavailable
    }
    readAt = at
    return cached
  }
}

export function mountPublicUsage(router: Router, source: UsageSource): void {
  const read = publicUsageReader(source)
  router.route('GET', '/api/usage', (_req, res) => {
    res.setHeader('cache-control', 'public, max-age=10')
    sendJson(res, read())
  })
}
