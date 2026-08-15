import { describe, it, expect } from 'vitest'
import { openForgeDb } from './db.js'
import { JobsQueue } from './queue.js'

describe('JobsQueue', () => {
  it('enqueue → claim marks running and increments attempts', () => {
    const q = new JobsQueue(openForgeDb(':memory:'))
    const id = q.enqueue('commission', { desc: 'a bucket' })
    const job = q.claim()!
    expect(job.id).toBe(id)
    expect(job.status).toBe('running')
    expect(job.attempts).toBe(1)
    expect(job.payload).toEqual({ desc: 'a bucket' })
    expect(q.claim()).toBeNull() // nothing else pending
  })
  it('complete stores the result and marks done', () => {
    const q = new JobsQueue(openForgeDb(':memory:'))
    const id = q.enqueue('commission', {})
    const job = q.claim()!
    expect(q.complete(id, job.attempts, { assetId: 'asset_x' })).toBe(true)
    expect(q.get(id)!.status).toBe('done')
  })
  it('fail re-pends with backoff until maxAttempts, then failed', () => {
    const q = new JobsQueue(openForgeDb(':memory:'))
    const id = q.enqueue('commission', {})
    for (let i = 0; i < 3; i++) {
      const job = q.claim()                          // attempts becomes i+1
      expect(job).not.toBeNull()
      q.fail(id, job!.attempts, 'boom', { retryInMs: 0 }) // re-pends until attempts hits 3
    }
    expect(q.get(id)!.status).toBe('failed')
    expect(q.claim()).toBeNull()
  })
  it('respects run_at backoff — a future-scheduled job is not claimable', () => {
    const q = new JobsQueue(openForgeDb(':memory:'))
    const id = q.enqueue('commission', {})
    const job = q.claim()!
    q.fail(id, job.attempts, 'transient', { retryInMs: 60_000 })
    expect(q.claim()).toBeNull()
  })
  it('complete is fenced on the attempts token — a late worker cannot overwrite a reclaimed job', () => {
    const q = new JobsQueue(openForgeDb(':memory:'))
    const id = q.enqueue('commission', {})
    const slow = q.claim()!            // attempts 1; worker stalls
    q.requeueStale(0)                  // presumed dead → back to pending
    const fresh = q.claim()!           // attempts 2; new owner
    expect(q.complete(id, slow.attempts, { from: 'slow' })).toBe(false)
    expect(q.get(id)!.status).toBe('running') // fresh owner undisturbed
    expect(q.complete(id, fresh.attempts, { from: 'fresh' })).toBe(true)
    expect(q.get(id)!.status).toBe('done')
  })
  it('fail is fenced on the attempts token — a late fail cannot clobber the new owner', () => {
    const q = new JobsQueue(openForgeDb(':memory:'))
    const id = q.enqueue('commission', {})
    const slow = q.claim()!
    q.requeueStale(0)
    const fresh = q.claim()!
    expect(q.fail(id, slow.attempts, 'late boom', { retryInMs: 0 })).toBe(false)
    expect(q.get(id)!.status).toBe('running')
    expect(q.complete(id, fresh.attempts, null)).toBe(true)
    expect(q.get(id)!.status).toBe('done')
  })
  it('complete/fail on a non-running job are no-ops', () => {
    const q = new JobsQueue(openForgeDb(':memory:'))
    const id = q.enqueue('commission', {})
    expect(q.complete(id, 0, null)).toBe(false)   // still pending
    expect(q.fail(id, 0, 'x')).toBe(false)
    expect(q.get(id)!.status).toBe('pending')
  })
  it('requeueStale reclaims a stale running job, preserving attempts', () => {
    const q = new JobsQueue(openForgeDb(':memory:'))
    const id = q.enqueue('commission', {})
    q.claim()                       // attempts 1, running
    q.requeueStale(0)               // stale → pending, attempts kept
    expect(q.get(id)!.status).toBe('pending')
    const again = q.claim()!
    expect(again.attempts).toBe(2)  // attempts accumulate across crash cycles
  })
  it('requeueStale leaves a fresh running job untouched', () => {
    const q = new JobsQueue(openForgeDb(':memory:'))
    const id = q.enqueue('commission', {})
    q.claim()
    q.requeueStale(60_000)          // 60s stale threshold; job just started
    expect(q.get(id)!.status).toBe('running')
  })
  it('a job requeued twice then hitting maxAttempts is failed', () => {
    const q = new JobsQueue(openForgeDb(':memory:'))
    const id = q.enqueue('commission', {})
    q.claim(); q.requeueStale(0)    // 1st crash → pending (attempts 1)
    q.claim(); q.requeueStale(0)    // 2nd crash → pending (attempts 2)
    q.claim(); q.requeueStale(0)    // 3rd crash → attempts 3 >= max → failed
    expect(q.get(id)!.status).toBe('failed')
    expect(q.claim()).toBeNull()
  })
})
