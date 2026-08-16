import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { MemoryStore } from './memory/store.js'

export type PersonalityDoc = {
  temperament: string // frozen at birth — no API can change it
  values: string[]
  beliefs: string[]
  current: { mood: string; worries: string[]; goals: string[] }
}

export const PersonalityEditSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add'),
      field: z.enum(['values', 'beliefs']),
      text: z.string().min(1).max(200),
      evidence: z.array(z.number().int()).min(1),
    })
    .strict(),
  z
    .object({
      op: z.literal('remove'),
      field: z.enum(['values', 'beliefs']),
      index: z.number().int().nonnegative(),
      evidence: z.array(z.number().int()).min(1),
    })
    .strict(),
  z
    .object({
      op: z.literal('revise'),
      field: z.enum(['values', 'beliefs']),
      index: z.number().int().nonnegative(),
      text: z.string().min(1).max(200),
      evidence: z.array(z.number().int()).min(1),
    })
    .strict(),
])

export type PersonalityEdit = z.infer<typeof PersonalityEditSchema>

export class PersonalityStore {
  constructor(
    readonly db: Database.Database,
    readonly agentId: string,
  ) {}

  init(doc: PersonalityDoc, day: number): void {
    this.db
      .prepare(
        'INSERT INTO personality_versions (agent_id, version, day, doc, edit) VALUES (?, ?, ?, ?, NULL)',
      )
      .run(this.agentId, 1, day, JSON.stringify(doc))
  }

  current(): { version: number; doc: PersonalityDoc } {
    const row = this.db
      .prepare(
        'SELECT version, doc FROM personality_versions WHERE agent_id = ? ORDER BY version DESC LIMIT 1',
      )
      .get(this.agentId) as { version: number; doc: string } | undefined
    if (!row) throw new Error(`personality not initialized for ${this.agentId}`)
    return { version: row.version, doc: JSON.parse(row.doc) as PersonalityDoc }
  }

  history(): Array<{ version: number; day: number; edit: PersonalityEdit | null }> {
    const rows = this.db
      .prepare(
        'SELECT version, day, edit FROM personality_versions WHERE agent_id = ? ORDER BY version',
      )
      .all(this.agentId) as Array<{ version: number; day: number; edit: string | null }>
    return rows.map((r) => ({
      version: r.version,
      day: r.day,
      edit: r.edit === null ? null : (JSON.parse(r.edit) as PersonalityEdit),
    }))
  }

  updateCurrent(current: PersonalityDoc['current']): void {
    const row = this.db
      .prepare(
        'SELECT version, doc FROM personality_versions WHERE agent_id = ? ORDER BY version DESC LIMIT 1',
      )
      .get(this.agentId) as { version: number; doc: string } | undefined
    if (!row) throw new Error(`personality not initialized for ${this.agentId}`)
    const doc = JSON.parse(row.doc) as PersonalityDoc
    doc.current = current
    this.db
      .prepare('UPDATE personality_versions SET doc = ? WHERE agent_id = ? AND version = ?')
      .run(JSON.stringify(doc), this.agentId, row.version)
  }

  applyNightlyEdit(
    day: number,
    rawEdit: unknown,
    mem: MemoryStore,
  ): { ok: true; version: number } | { ok: false; reason: string } {
    const parsed = PersonalityEditSchema.safeParse(rawEdit)
    if (!parsed.success) return { ok: false, reason: 'invalid_edit_shape' }
    const edit = parsed.data

    const applied = this.db
      .prepare(
        'SELECT 1 FROM personality_versions WHERE agent_id = ? AND day = ? AND edit IS NOT NULL',
      )
      .get(this.agentId, day)
    if (applied) return { ok: false, reason: 'edit_already_applied_today' }

    for (const id of edit.evidence) {
      const m = mem.getMemory(id)
      if (!m) return { ok: false, reason: 'evidence_missing' }
      if (m.day !== day) return { ok: false, reason: 'evidence_not_from_today' }
    }

    const cur = this.current()
    const doc: PersonalityDoc = JSON.parse(JSON.stringify(cur.doc)) as PersonalityDoc
    const list = doc[edit.field]
    if (edit.op === 'add') {
      list.push(edit.text)
    } else if (edit.index >= list.length) {
      return { ok: false, reason: 'index_out_of_range' }
    } else if (edit.op === 'remove') {
      list.splice(edit.index, 1)
    } else {
      list[edit.index] = edit.text
    }

    const version = cur.version + 1
    this.db
      .prepare(
        'INSERT INTO personality_versions (agent_id, version, day, doc, edit) VALUES (?, ?, ?, ?, ?)',
      )
      .run(this.agentId, version, day, JSON.stringify(doc), JSON.stringify(edit))
    return { ok: true, version }
  }
}
