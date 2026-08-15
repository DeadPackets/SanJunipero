import type Database from 'better-sqlite3'
import { unregisterVerb } from '@sj/engine'
import { RulebookStore } from './rulebook.js'

export type ReviewStatus = 'pending' | 'approved' | 'reverted'

export type ReviewRow = {
  id: number
  ruleId: number
  recipeId: string
  status: ReviewStatus
  reason: string | null
  tick: number
}

type RawReviewRow = {
  id: number
  rule_id: number
  recipe_id: string
  status: ReviewStatus
  reason: string | null
  tick: number
}

function toReviewRow(r: RawReviewRow): ReviewRow {
  return {
    id: r.id,
    ruleId: r.rule_id,
    recipeId: r.recipe_id,
    status: r.status,
    reason: r.reason,
    tick: r.tick,
  }
}

// One review row per codified rulebook row: queue upserts on rule_id, so a
// rule has at most one disposition (pending → approved/reverted) and re-queueing
// a reverted rule re-opens that single row instead of duplicating it.
export class ReviewStore {
  private readonly rulebook: RulebookStore

  constructor(readonly db: Database.Database) {
    this.rulebook = new RulebookStore(db)
  }

  queue(ruleId: number, recipeId: string, tick: number): void {
    const existing = this.db.prepare('SELECT id FROM ruling_reviews WHERE rule_id = ?').get(ruleId) as
      | { id: number }
      | undefined
    if (existing) {
      this.db.prepare('UPDATE ruling_reviews SET status = ?, reason = NULL, tick = ? WHERE id = ?').run('pending', tick, existing.id)
    } else {
      this.db
        .prepare('INSERT INTO ruling_reviews (rule_id, recipe_id, status, reason, tick) VALUES (?, ?, ?, NULL, ?)')
        .run(ruleId, recipeId, 'pending', tick)
    }
  }

  pending(): ReviewRow[] {
    return (this.db.prepare('SELECT * FROM ruling_reviews WHERE status = ? ORDER BY id').all('pending') as RawReviewRow[]).map(
      toReviewRow,
    )
  }

  approve(ruleId: number): void {
    this.db.prepare('UPDATE ruling_reviews SET status = ? WHERE rule_id = ?').run('approved', ruleId)
  }

  revert(ruleId: number, reason: string, tick: number): void {
    const row = this.db.prepare('SELECT * FROM ruling_reviews WHERE rule_id = ?').get(ruleId) as RawReviewRow | undefined
    if (!row) return
    this.db.prepare('UPDATE ruling_reviews SET status = ?, reason = ?, tick = ? WHERE rule_id = ?').run('reverted', reason, tick, ruleId)
    this.rulebook.revert(row.recipe_id, reason, tick)
    unregisterVerb(row.recipe_id)
  }
}
