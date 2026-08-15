import { describe, it, expect } from 'vitest'
import { openForgeDb } from './db.js'
import { JobsQueue } from './queue.js'
import { runForgeWorker } from './worker.js'

describe('runForgeWorker', () => {
  it('claims, dispatches by kind, completes, and stops on abort', async () => {
    const q = new JobsQueue(openForgeDb(':memory:'))
    const id = q.enqueue('commission', { desc: 'a pot' })
    const ctl = new AbortController()
    const handled: unknown[] = []
    const workerDone = runForgeWorker({
      queue: q, pollMs: 5, signal: ctl.signal,
      handlers: { commission: async p => { handled.push(p); return { ok: true } } },
    })
    await new Promise(r => setTimeout(r, 50))
    ctl.abort()
    await workerDone
    expect(handled).toEqual([{ desc: 'a pot' }])
    expect(q.get(id)!.status).toBe('done')
  })
  it('a throwing handler fails the job (requeued for retry)', async () => {
    const q = new JobsQueue(openForgeDb(':memory:'))
    const id = q.enqueue('commission', {})
    const ctl = new AbortController()
    const workerDone = runForgeWorker({
      queue: q, pollMs: 5, signal: ctl.signal,
      handlers: { commission: async () => { throw new Error('provider down') } },
    })
    await new Promise(r => setTimeout(r, 50))
    ctl.abort()
    await workerDone
    expect(['pending', 'failed']).toContain(q.get(id)!.status) // retried with backoff, never 'running' forever
  })
  it('requeues a stale running job from a previous worker, leaving a fresh one running', async () => {
    const db = openForgeDb(':memory:')
    const q = new JobsQueue(db)
    const idStale = q.enqueue('commission', { desc: 'stale' })
    const idFresh = q.enqueue('commission', { desc: 'fresh' })
    q.claim() // stale → running, attempts 1
    q.claim() // fresh → running, attempts 1
    db.prepare("UPDATE jobs SET started_at = datetime('now', '-10 seconds') WHERE id = ?").run(idStale)
    db.prepare("UPDATE jobs SET started_at = datetime('now', '-2 seconds') WHERE id = ?").run(idFresh)
    const ctl = new AbortController()
    const handled: unknown[] = []
    const workerDone = runForgeWorker({
      queue: q, pollMs: 5, staleMs: 5000, signal: ctl.signal,
      handlers: { commission: async p => { handled.push(p); return { ok: true } } },
    })
    await new Promise(r => setTimeout(r, 50))
    ctl.abort()
    await workerDone
    expect(handled).toEqual([{ desc: 'stale' }])
    expect(q.get(idStale)!.status).toBe('done')
    expect(q.get(idFresh)!.status).toBe('running')
  })
  it('requeues a running job once it ages past the window while the worker is up', async () => {
    const db = openForgeDb(':memory:')
    const q = new JobsQueue(db)
    const id = q.enqueue('commission', { desc: 'orphaned' })
    q.claim() // previous worker claimed it (attempts 1) and died; this worker restarts within the window
    const ctl = new AbortController()
    const handled: unknown[] = []
    const workerDone = runForgeWorker({
      queue: q, pollMs: 5, staleMs: 60_000, signal: ctl.signal,
      handlers: { commission: async p => { handled.push(p); return { ok: true } } },
    })
    await new Promise(r => setTimeout(r, 20))
    // age it past the 60s window while the worker is still polling
    db.prepare("UPDATE jobs SET started_at = datetime('now', '-61 seconds') WHERE id = ?").run(id)
    await new Promise(r => setTimeout(r, 60))
    ctl.abort()
    await workerDone
    expect(handled).toEqual([{ desc: 'orphaned' }])
    expect(q.get(id)!.status).toBe('done')
  })
  it('an unknown kind fails immediately (maxAttempts 1), no handler TypeError', async () => {
    const q = new JobsQueue(openForgeDb(':memory:'))
    const id = q.enqueue('unknown_kind', {})
    const ctl = new AbortController()
    const workerDone = runForgeWorker({
      queue: q, pollMs: 5, signal: ctl.signal,
      handlers: { commission: async p => p },
    })
    await new Promise(r => setTimeout(r, 50))
    ctl.abort()
    await workerDone
    expect(q.get(id)!.status).toBe('failed')
  })
})
