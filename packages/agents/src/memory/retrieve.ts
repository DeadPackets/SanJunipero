import { MINUTES_PER_DAY } from '@sj/shared'
import type { MemoryRow, MemoryStore, MemoryTags } from './store.js'

export type SceneCues = {
  people: string[]
  place: string | null
  topics: string[]
}

export type RetrievalWeights = {
  tag: number
  bm25: number
  cosine: number
  recency: number
  importance: number
}

export type ScoredMemory = MemoryRow & {
  score: number
  parts: {
    tag: number
    bm25: number
    cosine: number
    recency: number
    importance: number
  }
}

export const DEFAULT_WEIGHTS: RetrievalWeights = {
  tag: 2.0,
  bm25: 1.0,
  cosine: 1.5,
  recency: 1.0,
  importance: 0.05,
}

export const MISS_TOP_SCORE = 1.0
export const MISS_MIN_RESULTS = 3

const FTS_POOL = 50
const VEC_POOL = 50
const MAX_TAG_MATCH = 3

const STOPWORDS = new Set<string>([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'her',
  'his',
  'i',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'they',
  'to',
  'was',
])

export function keywords(text: string, max = 6): string[] {
  const out: string[] = []
  for (const raw of text.toLowerCase().split(/\W+/)) {
    if (raw === '') continue
    if (STOPWORDS.has(raw)) continue
    if (out.includes(raw)) continue
    out.push(raw)
    if (out.length >= max) break
  }
  return out
}

function cueParts(cues: SceneCues): string[] {
  const parts: string[] = [...cues.people]
  if (cues.place !== null) parts.push(cues.place)
  parts.push(...cues.topics)
  return parts
}

export function cuesToQuery(cues: SceneCues): string {
  return cueParts(cues).join(' ')
}

function flattenTags(tags: MemoryTags): string[] {
  const out: string[] = [...tags.people]
  if (tags.place !== null) out.push(tags.place)
  out.push(...tags.objects)
  out.push(...tags.topics)
  return out
}

async function retrieve(
  store: MemoryStore,
  query: string,
  queryTags: string[],
  nowTick: number,
  k: number,
  w: RetrievalWeights,
  mode: 'ambient' | 'recall',
): Promise<ScoredMemory[]> {
  const db = store.db
  const agentId = store.agentId
  const qTags = new Set(queryTags)
  const candidates = new Set<number>()
  const rawBm25 = new Map<number, number>()
  const cosine = new Map<number, number>()

  const terms = keywords(query)
  if (terms.length > 0) {
    const matchExpr = terms.map((t) => `"${t}"`).join(' AND ')
    const rows = db
      .prepare(
        `SELECT m.id AS id, bm25(memories_fts) AS raw
         FROM memories_fts
         JOIN memories m ON m.id = memories_fts.rowid
         WHERE memories_fts MATCH ? AND m.agent_id = ?
         ORDER BY bm25(memories_fts)
         LIMIT ?`,
      )
      .all(matchExpr, agentId, FTS_POOL) as Array<{ id: number; raw: number }>
    for (const r of rows) {
      rawBm25.set(r.id, r.raw)
      candidates.add(r.id)
    }
  }

  if (query.length > 0) {
    const qvec = await store.embed(query)
    const rows = db
      .prepare(
        `SELECT rowid AS id, distance AS dist
         FROM memory_vec
         WHERE embedding MATCH ? AND k = ?
           AND rowid IN (SELECT id FROM memories WHERE agent_id = ?)`,
      )
      .all(Buffer.from(qvec.buffer, qvec.byteOffset, qvec.byteLength), VEC_POOL, agentId) as Array<{
      id: number
      dist: number
    }>
    for (const r of rows) {
      // embeddings are L2-normalized: cosine = 1 − dist²/2
      cosine.set(r.id, 1 - (r.dist * r.dist) / 2)
      candidates.add(r.id)
    }
  }

  if (qTags.size > 0) {
    const placeholders = [...qTags].map(() => '?').join(', ')
    const rows = db
      .prepare(
        `SELECT DISTINCT t.memory_id AS id
         FROM memory_tags t
         JOIN memories m ON m.id = t.memory_id
         WHERE t.tag IN (${placeholders}) AND m.agent_id = ?`,
      )
      .all(...[...qTags], agentId) as Array<{ id: number }>
    for (const r of rows) candidates.add(r.id)
  }

  const scored: ScoredMemory[] = store.getMemories([...candidates]).map((row) => {
    const memoryTags = new Set(flattenTags(row.tags))
    let tag = 0
    for (const t of memoryTags) if (qTags.has(t)) tag += 1
    tag = Math.min(MAX_TAG_MATCH, tag)

    const b = Math.max(0, -(rawBm25.get(row.id) ?? 0))
    const bm25 = b / (1 + b)
    const cos = cosine.get(row.id) ?? 0
    const ageDays = Math.max(0, nowTick - row.tick) / MINUTES_PER_DAY
    const recency = 0.5 ** (ageDays / (2 * row.importance))
    const importance = row.importance

    const parts = { tag, bm25, cosine: cos, recency, importance }
    const score =
      w.tag * tag + w.bm25 * bm25 + w.cosine * cos + w.recency * recency + w.importance * importance
    return { ...row, score, parts }
  })

  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, k)

  const topScore = top.length > 0 ? top[0]!.score : null
  if (topScore === null || topScore < MISS_TOP_SCORE || top.length < MISS_MIN_RESULTS) {
    store.logMiss({ tick: nowTick, query, mode, topScore, resultCount: top.length })
  }

  return top
}

export async function retrieveAmbient(
  store: MemoryStore,
  cues: SceneCues,
  nowTick: number,
  k = 8,
  w: RetrievalWeights = DEFAULT_WEIGHTS,
): Promise<ScoredMemory[]> {
  const queryTags = cueParts(cues)
  return retrieve(store, queryTags.join(' '), queryTags, nowTick, k, w, 'ambient')
}

export async function recall(
  store: MemoryStore,
  query: string,
  nowTick: number,
  k = 12,
  w: RetrievalWeights = DEFAULT_WEIGHTS,
): Promise<ScoredMemory[]> {
  return retrieve(store, query, keywords(query), nowTick, k, w, 'recall')
}
