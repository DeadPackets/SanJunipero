import { MINUTES_PER_DAY } from '@sj/shared'
import type Database from 'better-sqlite3'

export type MemoryKind =
  | 'perception'
  | 'thought'
  | 'action'
  | 'speech_heard'
  | 'journal'
  | 'dream'
  | 'reflection'

export type MemoryTags = {
  people: string[]
  place: string | null
  objects: string[]
  topics: string[]
}

export type MemoryRow = {
  id: number
  agentId: string
  tick: number
  day: number
  kind: MemoryKind
  text: string
  importance: number
  tags: MemoryTags
}

export type FactRow = {
  id: number
  agentId: string
  day: number
  subject: string
  predicate: string
  object: string
  srcMemoryId: number
}

export type SummaryLevel = 'scene' | 'day' | 'era'

export type SummaryNodeRow = {
  id: number
  agentId: string
  level: SummaryLevel
  day: number
  title: string
  text: string
  childIds: number[]
  memoryIds: number[]
}

type RawMemory = {
  id: number
  agent_id: string
  tick: number
  day: number
  kind: MemoryKind
  text: string
  importance: number
  tags: string
}

function toMemoryRow(r: RawMemory): MemoryRow {
  return {
    id: r.id,
    agentId: r.agent_id,
    tick: r.tick,
    day: r.day,
    kind: r.kind,
    text: r.text,
    importance: r.importance,
    tags: JSON.parse(r.tags) as MemoryTags,
  }
}

export class MemoryStore {
  constructor(
    readonly db: Database.Database,
    readonly agentId: string,
    private readonly embedder: { embed(t: string): Promise<Float32Array> },
  ) {}

  embed(text: string): Promise<Float32Array> {
    return this.embedder.embed(text)
  }

  async insertMemory(m: {
    tick: number
    kind: MemoryKind
    text: string
    importance: number
    tags: MemoryTags
  }): Promise<number> {
    const embedding = await this.embedder.embed(m.text)
    const insert = this.db.transaction((): number => {
      const res = this.db
        .prepare(
          `INSERT INTO memories (agent_id, tick, day, kind, text, importance, tags)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.agentId,
          m.tick,
          Math.floor(m.tick / MINUTES_PER_DAY),
          m.kind,
          m.text,
          m.importance,
          JSON.stringify(m.tags),
        )
      const id = Number(res.lastInsertRowid)
      const tagStmt = this.db.prepare(
        'INSERT INTO memory_tags (memory_id, kind, tag) VALUES (?, ?, ?)',
      )
      for (const person of m.tags.people) tagStmt.run(id, 'person', person)
      if (m.tags.place !== null) tagStmt.run(id, 'place', m.tags.place)
      for (const object of m.tags.objects) tagStmt.run(id, 'object', object)
      for (const topic of m.tags.topics) tagStmt.run(id, 'topic', topic)
      this.db
        .prepare('INSERT INTO memory_vec (rowid, embedding) VALUES (?, ?)')
        // vec0 rejects float-typed rowids; BigInt forces an INTEGER bind
        .run(BigInt(id), Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength))
      return id
    })
    return insert()
  }

  getMemory(id: number): MemoryRow | null {
    const row = this.db
      .prepare('SELECT * FROM memories WHERE id = ? AND agent_id = ?')
      .get(id, this.agentId) as RawMemory | undefined
    return row ? toMemoryRow(row) : null
  }

  getMemories(ids: number[]): MemoryRow[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(', ')
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE agent_id = ? AND id IN (${placeholders})`)
      .all(this.agentId, ...ids) as RawMemory[]
    return rows.map(toMemoryRow)
  }

  memoriesOfDay(day: number): MemoryRow[] {
    const rows = this.db
      .prepare('SELECT * FROM memories WHERE agent_id = ? AND day = ? ORDER BY id')
      .all(this.agentId, day) as RawMemory[]
    return rows.map(toMemoryRow)
  }

  insertFact(f: {
    day: number
    subject: string
    predicate: string
    object: string
    srcMemoryId: number
  }): number {
    const res = this.db
      .prepare(
        `INSERT INTO facts (agent_id, day, subject, predicate, object, src_memory_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(this.agentId, f.day, f.subject, f.predicate, f.object, f.srcMemoryId)
    return Number(res.lastInsertRowid)
  }

  factsAbout(subject: string): FactRow[] {
    const rows = this.db
      .prepare('SELECT * FROM facts WHERE agent_id = ? AND subject = ? ORDER BY id')
      .all(this.agentId, subject) as {
      id: number
      agent_id: string
      day: number
      subject: string
      predicate: string
      object: string
      src_memory_id: number
    }[]
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agent_id,
      day: r.day,
      subject: r.subject,
      predicate: r.predicate,
      object: r.object,
      srcMemoryId: r.src_memory_id,
    }))
  }

  upsertLedger(personId: string, doc: string, day: number): void {
    this.db
      .prepare(
        `INSERT INTO ledgers (agent_id, person_id, doc, updated_day) VALUES (?, ?, ?, ?)
         ON CONFLICT (agent_id, person_id)
         DO UPDATE SET doc = excluded.doc, updated_day = excluded.updated_day`,
      )
      .run(this.agentId, personId, doc, day)
  }

  getLedger(personId: string): { doc: string; updatedDay: number } | null {
    const row = this.db
      .prepare('SELECT doc, updated_day FROM ledgers WHERE agent_id = ? AND person_id = ?')
      .get(this.agentId, personId) as { doc: string; updated_day: number } | undefined
    return row ? { doc: row.doc, updatedDay: row.updated_day } : null
  }

  insertSummaryNode(n: {
    level: SummaryLevel
    day: number
    title: string
    text: string
    childIds: number[]
    memoryIds: number[]
  }): number {
    const res = this.db
      .prepare(
        `INSERT INTO summary_nodes (agent_id, level, day, title, text, child_ids, memory_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.agentId,
        n.level,
        n.day,
        n.title,
        n.text,
        JSON.stringify(n.childIds),
        JSON.stringify(n.memoryIds),
      )
    return Number(res.lastInsertRowid)
  }

  summaryNodes(level: SummaryLevel, day?: number): SummaryNodeRow[] {
    const sql = `SELECT * FROM summary_nodes WHERE agent_id = ? AND level = ?${
      day === undefined ? '' : ' AND day = ?'
    } ORDER BY id`
    const params = day === undefined ? [this.agentId, level] : [this.agentId, level, day]
    const rows = this.db.prepare(sql).all(...params) as {
      id: number
      agent_id: string
      level: SummaryLevel
      day: number
      title: string
      text: string
      child_ids: string
      memory_ids: string
    }[]
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agent_id,
      level: r.level,
      day: r.day,
      title: r.title,
      text: r.text,
      childIds: JSON.parse(r.child_ids) as number[],
      memoryIds: JSON.parse(r.memory_ids) as number[],
    }))
  }

  insertJournal(tick: number, day: number, text: string): number {
    const res = this.db
      .prepare('INSERT INTO journal (agent_id, tick, day, text) VALUES (?, ?, ?, ?)')
      .run(this.agentId, tick, day, text)
    return Number(res.lastInsertRowid)
  }

  journalEntries(): { tick: number; day: number; text: string }[] {
    return this.db
      .prepare('SELECT tick, day, text FROM journal WHERE agent_id = ? ORDER BY id')
      .all(this.agentId) as { tick: number; day: number; text: string }[]
  }

  /** The last pages of the book, oldest first, for the writer to read back. */
  recentJournal(limit: number): { tick: number; text: string }[] {
    const rows = this.db
      .prepare('SELECT tick, text FROM journal WHERE agent_id = ? ORDER BY id DESC LIMIT ?')
      .all(this.agentId, limit) as { tick: number; text: string }[]
    return rows.reverse()
  }

  appendAutobiography(day: number, paragraph: string): void {
    this.db
      .prepare('INSERT INTO autobiography (agent_id, day, paragraph) VALUES (?, ?, ?)')
      .run(this.agentId, day, paragraph)
  }

  autobiography(asOfDay = Number.MAX_SAFE_INTEGER): string[] {
    const rows = this.db
      .prepare('SELECT paragraph FROM autobiography WHERE agent_id = ? AND day <= ? ORDER BY id')
      .all(this.agentId, asOfDay) as { paragraph: string }[]
    return rows.map((r) => r.paragraph)
  }

  logMiss(m: {
    tick: number
    query: string
    mode: 'ambient' | 'recall'
    topScore: number | null
    resultCount: number
  }): void {
    this.db
      .prepare(
        `INSERT INTO recall_misses (agent_id, tick, query, mode, top_score, result_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(this.agentId, m.tick, m.query, m.mode, m.topScore, m.resultCount)
  }
}
