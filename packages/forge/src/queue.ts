import type Database from 'better-sqlite3'

export type Job = { id: number; kind: string; payload: unknown; status: 'pending' | 'running' | 'done' | 'failed'; attempts: number }

export class JobsQueue {
  #insert; #claim; #complete; #retry; #failHard; #get; #requeueStale; #failStale
  constructor(db: Database.Database) {
    this.#insert = db.prepare("INSERT INTO jobs (kind, payload) VALUES (?, ?)")
    // single UPDATE...RETURNING = atomic claim under better-sqlite3's serialized access
    this.#claim = db.prepare(`
      UPDATE jobs SET status = 'running', attempts = attempts + 1, started_at = datetime('now')
      WHERE id = (SELECT id FROM jobs WHERE status = 'pending' AND run_at <= datetime('now') ORDER BY id LIMIT 1)
      RETURNING id, kind, payload, status, attempts`)
    this.#complete = db.prepare("UPDATE jobs SET status = 'done', result = ? WHERE id = ?")
    this.#retry = db.prepare("UPDATE jobs SET status = 'pending', error = ?, run_at = datetime('now', ? || ' seconds') WHERE id = ?")
    this.#failHard = db.prepare("UPDATE jobs SET status = 'failed', error = ? WHERE id = ?")
    this.#requeueStale = db.prepare("UPDATE jobs SET status = 'pending' WHERE status = 'running' AND attempts < ? AND started_at <= datetime('now', ?)")
    this.#failStale = db.prepare("UPDATE jobs SET status = 'failed', error = COALESCE(error, 'stale: max attempts exceeded') WHERE status = 'running' AND attempts >= ? AND started_at <= datetime('now', ?)")
    this.#get = db.prepare('SELECT id, kind, payload, status, attempts FROM jobs WHERE id = ?')
  }

  enqueue(kind: string, payload: unknown): number {
    return Number(this.#insert.run(kind, JSON.stringify(payload ?? null)).lastInsertRowid)
  }
  claim(): Job | null {
    const r = this.#claim.get() as (Omit<Job, 'payload'> & { payload: string }) | undefined
    return r ? { ...r, payload: JSON.parse(r.payload) } : null
  }
  complete(id: number, result: unknown): void { this.#complete.run(JSON.stringify(result ?? null), id) }
  fail(id: number, error: string, opts: { retryInMs?: number; maxAttempts?: number } = {}): void {
    const max = opts.maxAttempts ?? 3
    const job = this.get(id)
    if (!job) return
    if (job.attempts >= max) this.#failHard.run(error, id)
    else this.#retry.run(error, String(Math.ceil((opts.retryInMs ?? 30_000) / 1000)), id)
  }
  requeueStale(ageMs: number, opts: { maxAttempts?: number } = {}): number {
    const max = opts.maxAttempts ?? 3
    const delta = `-${Math.max(0, Math.ceil(ageMs / 1000))} seconds`
    const requeued = this.#requeueStale.run(max, delta).changes
    const failed = this.#failStale.run(max, delta).changes
    return requeued + failed
  }
  get(id: number): Job | null {
    const r = this.#get.get(id) as (Omit<Job, 'payload'> & { payload: string }) | undefined
    return r ? { ...r, payload: JSON.parse(r.payload) } : null
  }
}
