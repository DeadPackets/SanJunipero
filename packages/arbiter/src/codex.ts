import type Database from 'better-sqlite3'
import { ERA_ORDER, type Era } from './canon.js'

export type CodexEntry = {
  id: string
  era: Era
  name: string
  prerequisiteId: string | null
}

export class CodexStore {
  constructor(private readonly db: Database.Database) {}

  insert(entry: CodexEntry): void {
    this.db
      .prepare('INSERT INTO codex (id, era, name, prerequisite_id) VALUES (?, ?, ?, ?)')
      .run(entry.id, entry.era, entry.name, entry.prerequisiteId)
  }

  known(): string[] {
    const rows = this.db.prepare('SELECT id FROM codex ORDER BY rowid').all() as Array<{ id: string }>
    return rows.map((r) => r.id)
  }

  knownEra(): Era {
    const rows = this.db.prepare('SELECT era FROM codex').all() as Array<{ era: string }>
    let best: Era = 'agriculture'
    let bestOrder = 0
    for (const row of rows) {
      const order = ERA_ORDER[row.era as Era]
      if (order !== undefined && order > bestOrder) {
        bestOrder = order
        best = row.era as Era
      }
    }
    return best
  }

  withinAdjacency(recipeCanon: string[]): boolean {
    if (recipeCanon.length === 0) return false
    const known = new Set(this.known())
    const prerequisite = this.db.prepare('SELECT prerequisite_id FROM codex WHERE id = ?')
    for (const id of recipeCanon) {
      if (known.has(id)) continue
      const row = prerequisite.get(id) as { prerequisite_id: string | null } | undefined
      if (row && row.prerequisite_id !== null && known.has(row.prerequisite_id)) continue
      return false
    }
    return true
  }
}
