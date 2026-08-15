import type { JobsQueue } from './queue.js'

export async function runForgeWorker(opts: {
  queue: JobsQueue
  handlers: Record<string, (payload: unknown) => Promise<unknown>>
  pollMs?: number
  staleMs?: number
  signal: AbortSignal
}): Promise<void> {
  const pollMs = opts.pollMs ?? 500
  opts.queue.requeueStale(opts.staleMs ?? 60_000)
  while (!opts.signal.aborted) {
    const job = opts.queue.claim()
    if (!job) { await new Promise(r => setTimeout(r, pollMs)); continue }
    const handler = opts.handlers[job.kind]
    if (!handler) { opts.queue.fail(job.id, `no handler for kind '${job.kind}'`, { maxAttempts: 1 }); continue }
    try { opts.queue.complete(job.id, await handler(job.payload)) }
    catch (e) { opts.queue.fail(job.id, String(e)) }
  }
}
