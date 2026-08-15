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
})
