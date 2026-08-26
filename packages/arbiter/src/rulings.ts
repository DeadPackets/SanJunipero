import type Database from 'better-sqlite3'
import { cosine } from '@sj/agents'
import { normalizeIntent } from './rulebook.js'
import type { Verdict } from './verdict.js'

export type RulingRow = {
  id: number
  intentText: string
  normalizedIntent: string
  verdictJson: string
  tick: number
}

const VEC_POOL = 50
const FTS_POOL = 50

type RawRuling = {
  id: number
  intent_text: string
  normalized_intent: string
  verdict_json: string
  tick: number
}

function keywords(text: string, max = 6): string[] {
  const out: string[] = []
  for (const raw of text.toLowerCase().split(/\W+/)) {
    if (raw === '') continue
    if (out.includes(raw)) continue
    out.push(raw)
    if (out.length >= max) break
  }
  return out
}

function toRulingRow(r: RawRuling): RulingRow {
  return {
    id: r.id,
    intentText: r.intent_text,
    normalizedIntent: r.normalized_intent,
    verdictJson: r.verdict_json,
    tick: r.tick,
  }
}

function toF32(bytes: Uint8Array): Float32Array {
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

export class RulingsStore {
  constructor(
    readonly db: Database.Database,
    private readonly embedder: { embed(t: string): Promise<Float32Array> },
  ) {}

  async record(intent: string, verdict: Verdict, tick: number): Promise<number> {
    const embedding = await this.embedder.embed(intent)
    const normalized = normalizeIntent(intent)
    const verdictJson = JSON.stringify(verdict)
    const insert = this.db.transaction((): number => {
      const res = this.db
        .prepare(
          `INSERT INTO rulings (intent_text, normalized_intent, verdict_json, tick)
           VALUES (?, ?, ?, ?)`,
        )
        .run(intent, normalized, verdictJson, tick)
      const id = Number(res.lastInsertRowid)
      this.db
        .prepare('INSERT INTO rulings_vec (rowid, embedding) VALUES (?, ?)')
        // vec0 rejects float-typed rowids; BigInt forces an INTEGER bind
        .run(BigInt(id), Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength))
      return id
    })
    return insert()
  }

  get(id: number): RulingRow | null {
    const row = this.db.prepare('SELECT * FROM rulings WHERE id = ?').get(id) as
      | RawRuling
      | undefined
    return row ? toRulingRow(row) : null
  }

  async similar(query: string, k = 5): Promise<Array<{ ruling: RulingRow; cosine: number }>> {
    const db = this.db
    const ids = new Set<number>()
    const cosineById = new Map<number, number>()

    const qvec = await this.embedder.embed(query)
    const qbuf = Buffer.from(qvec.buffer, qvec.byteOffset, qvec.byteLength)

    const knn = db
      .prepare(
        `SELECT rowid AS id, distance AS dist
         FROM rulings_vec
         WHERE embedding MATCH ? AND k = ?`,
      )
      .all(qbuf, VEC_POOL) as Array<{ id: number; dist: number }>
    for (const r of knn) {
      ids.add(r.id)
      // embeddings are L2-normalized: cosine = 1 − dist²/2
      cosineById.set(r.id, 1 - (r.dist * r.dist) / 2)
    }

    const terms = keywords(query)
    if (terms.length > 0) {
      const matchExpr = terms.map((t) => `"${t}"`).join(' AND ')
      const fts = db
        .prepare(
          `SELECT rowid AS id
           FROM rulings_fts
           WHERE rulings_fts MATCH ?
           ORDER BY bm25(rulings_fts)
           LIMIT ?`,
        )
        .all(matchExpr, FTS_POOL) as Array<{ id: number }>
      for (const r of fts) ids.add(r.id)
    }

    const results: Array<{ ruling: RulingRow; cosine: number }> = []
    for (const id of ids) {
      const ruling = this.get(id)
      if (!ruling) continue
      let cos = cosineById.get(id)
      if (cos === undefined) {
        const row = db.prepare('SELECT embedding FROM rulings_vec WHERE rowid = ?').get(id) as
          | { embedding: Uint8Array }
          | undefined
        cos = row ? cosine(qvec, toF32(row.embedding)) : 0
      }
      results.push({ ruling, cosine: cos })
    }
    results.sort((a, b) => b.cosine - a.cosine)
    return results.slice(0, k)
  }
}
