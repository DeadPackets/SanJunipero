import type Database from 'better-sqlite3'

export function normalizeIntent(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^(i try to |i want to |i attempt to )/, '')
    .replace(/[.,!?;:]+$/, '')
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export type RulebookRow = {
  id: number
  recipeId: string
  name: string
  normalizedName: string
  recipeJson: string
  verb: string
  tick: number
  revertedAtTick: number | null
  revertedReason: string | null
  // The last tick a body began this act; the minting tick until then.
  lastUsedTick: number
}

type RawRulebookRow = {
  id: number
  recipe_id: string
  name: string
  normalized_name: string
  recipe_json: string
  verb: string
  tick: number
  reverted_at_tick: number | null
  reverted_reason: string | null
  last_used_tick: number | null
}

function toRulebookRow(r: RawRulebookRow): RulebookRow {
  return {
    id: r.id,
    recipeId: r.recipe_id,
    name: r.name,
    normalizedName: r.normalized_name,
    recipeJson: r.recipe_json,
    verb: r.verb,
    tick: r.tick,
    revertedAtTick: r.reverted_at_tick,
    revertedReason: r.reverted_reason,
    lastUsedTick: r.last_used_tick ?? r.tick,
  }
}

// What the rulebook actually needs from a codified thing: an id and a name. A crafting
// recipe is one; an expressive ruling is the other, and the row keeps whichever JSON it got.
export type RulebookEntry = { id: string; name: string }

export class RulebookStore {
  constructor(readonly db: Database.Database) {}

  insert(recipe: RulebookEntry, tick: number): number {
    const res = this.db
      .prepare(
        `INSERT INTO rulebook (recipe_id, name, normalized_name, recipe_json, verb, tick, last_used_tick)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        recipe.id,
        recipe.name,
        normalizeIntent(recipe.name),
        JSON.stringify(recipe),
        recipe.id,
        tick,
        tick,
      )
    return Number(res.lastInsertRowid)
  }

  byId(recipeId: string): RulebookRow | null {
    const row = this.db.prepare('SELECT * FROM rulebook WHERE recipe_id = ?').get(recipeId) as
      | RawRulebookRow
      | undefined
    return row ? toRulebookRow(row) : null
  }

  lookup(intent: string): RulebookRow | null {
    const row = this.db
      .prepare('SELECT * FROM rulebook WHERE normalized_name = ? AND reverted_at_tick IS NULL')
      .get(normalizeIntent(intent)) as RawRulebookRow | undefined
    return row ? toRulebookRow(row) : null
  }

  reactivate(recipe: RulebookEntry, tick: number): void {
    this.db
      .prepare(
        `UPDATE rulebook SET reverted_at_tick = NULL, reverted_reason = NULL,
           name = ?, normalized_name = ?, recipe_json = ?, verb = ?, tick = ?, last_used_tick = ?
         WHERE recipe_id = ?`,
      )
      .run(
        recipe.name,
        normalizeIntent(recipe.name),
        JSON.stringify(recipe),
        recipe.id,
        tick,
        tick,
        recipe.id,
      )
  }

  touch(verb: string, tick: number): void {
    this.db.prepare('UPDATE rulebook SET last_used_tick = ? WHERE verb = ?').run(tick, verb)
  }

  // Active rows nobody has used since `beforeTick`, minting counted as a use.
  unusedSince(beforeTick: number): RulebookRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM rulebook WHERE reverted_at_tick IS NULL
           AND COALESCE(last_used_tick, tick) < ? ORDER BY id`,
      )
      .all(beforeTick) as RawRulebookRow[]
    return rows.map(toRulebookRow)
  }

  allActive(): RulebookRow[] {
    const rows = this.db
      .prepare('SELECT * FROM rulebook WHERE reverted_at_tick IS NULL ORDER BY id')
      .all() as RawRulebookRow[]
    return rows.map(toRulebookRow)
  }

  revert(recipeId: string, reason: string, tick: number): void {
    this.db
      .prepare('UPDATE rulebook SET reverted_at_tick = ?, reverted_reason = ? WHERE recipe_id = ?')
      .run(tick, reason, recipeId)
  }
}
