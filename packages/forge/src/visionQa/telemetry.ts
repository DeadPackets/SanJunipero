import type Database from 'better-sqlite3'
import { CRITERIA, type VisionVerdict } from './verdict.js'

export function recordVerdict(
  db: Database.Database, v: VisionVerdict,
  meta: { assetClass: string; attempt: number; costUsd: number },
): void {
  const scores = Object.fromEntries(CRITERIA.map(k => [k, v.criteria[k].score]))
  db.prepare(`INSERT INTO vision_qa
    (asset_id, asset_class, rubric_version, model, attempt, overall, scores, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(v.assetId, meta.assetClass, v.rubricVersion, v.model, meta.attempt, v.overall,
      JSON.stringify(scores), meta.costUsd)
}

export function passRates(db: Database.Database, assetClass?: string):
  { firstPass: number; withinRetries: number; blocked: number; n: number } {
  const where = assetClass === undefined ? '' : 'WHERE asset_class = ?'
  const params = assetClass === undefined ? [] : [assetClass]
  const rows = db.prepare(`SELECT
      asset_id,
      max(CASE WHEN attempt = 1 AND overall = 'pass' THEN 1 ELSE 0 END) AS first_pass,
      max(CASE WHEN overall = 'pass' THEN 1 ELSE 0 END)                 AS any_pass,
      max(attempt)                                                      AS last_attempt
    FROM vision_qa ${where} GROUP BY asset_id`)
    .all(...params) as Array<{ asset_id: string; first_pass: number; any_pass: number; last_attempt: number }>

  const n = rows.length
  if (n === 0) return { firstPass: 0, withinRetries: 0, blocked: 0, n: 0 }   // the G13 threshold reads this

  const lastOverall = db.prepare(
    `SELECT overall FROM vision_qa ${where}${where ? ' AND' : 'WHERE'} asset_id = ? AND attempt = ?`)
  const blocked = rows.filter(r =>
    (lastOverall.get(...params, r.asset_id, r.last_attempt) as { overall: string } | undefined)?.overall === 'blocked')
    .length

  return {
    firstPass: rows.filter(r => r.first_pass === 1).length / n,
    withinRetries: rows.filter(r => r.any_pass === 1).length / n,
    blocked: blocked / n,
    n,
  }
}
