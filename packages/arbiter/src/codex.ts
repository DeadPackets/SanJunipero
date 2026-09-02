import type Database from 'better-sqlite3'
import { ERA_ORDER, type Era } from './canon.js'

// The codex is the authored tech tree; `known` marks the rungs the town has
// actually earned. Unearned rows exist so adjacency can see one step beyond.
export type CodexEntry = {
  id: string
  era: Era
  name: string
  prerequisiteId: string | null
  known?: boolean
}

export class CodexStore {
  constructor(private readonly db: Database.Database) {}

  insert(entry: CodexEntry): void {
    this.db
      .prepare('INSERT INTO codex (id, era, name, prerequisite_id, known) VALUES (?, ?, ?, ?, ?)')
      .run(entry.id, entry.era, entry.name, entry.prerequisiteId, entry.known === false ? 0 : 1)
  }

  known(): string[] {
    const rows = this.db.prepare('SELECT id FROM codex WHERE known = 1 ORDER BY rowid').all() as {
      id: string
    }[]
    return rows.map((r) => r.id)
  }

  knownEra(): Era {
    const rows = this.db.prepare('SELECT era FROM codex WHERE known = 1').all() as {
      era: string
    }[]
    let best: Era = 'handwork'
    let bestOrder = 0
    for (const row of rows) {
      const order = (ERA_ORDER as Record<string, number | undefined>)[row.era]
      if (order !== undefined && order > bestOrder) {
        bestOrder = order
        best = row.era as Era
      }
    }
    return best
  }

  // The rungs one step out: unearned, but their prerequisite is practiced. Sorted
  // by id so the adjudication prefix stays byte-stable for a given codex.
  frontier(): string[] {
    const rows = this.db
      .prepare(
        'SELECT c.id FROM codex c JOIN codex p ON p.id = c.prerequisite_id' +
          ' WHERE c.known = 0 AND p.known = 1 ORDER BY c.id',
      )
      .all() as { id: string }[]
    return rows.map((r) => r.id)
  }

  // A rung is earned the moment a craft resting on it is codified.
  learn(ids: string[]): void {
    const mark = this.db.prepare('UPDATE codex SET known = 1 WHERE id = ?')
    for (const id of ids) mark.run(id)
  }

  // The court's proposed next rung: unearned, hung off a rung the codex already has. A
  // prerequisite the codex has never heard of is a made-up id, and the proposal is dropped.
  propose(rung: { id: string; name: string; prerequisiteId: string }): boolean {
    const parent = this.db.prepare('SELECT era FROM codex WHERE id = ?').get(rung.prerequisiteId) as
      | { era: Era }
      | undefined
    if (parent === undefined) return false
    if (this.db.prepare('SELECT 1 FROM codex WHERE id = ?').get(rung.id) !== undefined) return false
    this.insert({ ...rung, era: parent.era, known: false })
    return true
  }

  withinAdjacency(recipeCanon: string[]): boolean {
    if (recipeCanon.length === 0) return false
    const known = new Set(this.known())
    const prerequisite = this.db.prepare('SELECT prerequisite_id FROM codex WHERE id = ?')
    for (const id of recipeCanon) {
      if (known.has(id)) continue
      const row = prerequisite.get(id) as { prerequisite_id: string | null } | undefined
      const prerequisiteId = row?.prerequisite_id ?? null
      if (prerequisiteId !== null && known.has(prerequisiteId)) continue
      return false
    }
    return true
  }
}
