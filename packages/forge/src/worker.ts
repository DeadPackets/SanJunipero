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
    const job = opts.queue.claim()
    if (!job) {
      opts.queue.requeueStale(staleMs)
      await new Promise(r => setTimeout(r, pollMs))
      continue
    }
    const handler = opts.handlers[job.kind]
    try { opts.queue.complete(job.id, await handler(job.payload)) }
    catch (e) { opts.queue.fail(job.id, String(e)) }
  }
}
