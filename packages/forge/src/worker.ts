import type { JobsQueue } from './queue.js'

export async function runForgeWorker(opts: {
  queue: JobsQueue
  handlers: Record<string, (payload: unknown) => Promise<unknown>>
  pollMs?: number
  staleMs?: number
  signal: AbortSignal
}): Promise<void> {
  const pollMs = opts.pollMs ?? 500
  const staleMs = opts.staleMs ?? 60_000
  while (!opts.signal.aborted) {
    // every iteration, not just when idle — a steady backlog must not starve crashed workers' jobs
    opts.queue.requeueStale(staleMs)
    const job = opts.queue.claim()
    if (!job) {
      await new Promise(r => setTimeout(r, pollMs))
      continue
    }
    const handler = opts.handlers[job.kind]
    if (!handler) { opts.queue.fail(job.id, job.attempts, `no handler for kind '${job.kind}'`, { maxAttempts: 1 }); continue }
    try { opts.queue.complete(job.id, job.attempts, await handler(job.payload)) }
    catch (e) { opts.queue.fail(job.id, job.attempts, String(e)) }
  }
}
