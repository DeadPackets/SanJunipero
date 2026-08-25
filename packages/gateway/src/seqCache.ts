import type { ServerResponse } from 'node:http'

/**
 * ★ ONE WORLD, MANY STRANGERS — THE READ API COSTED FOR A CROWD.
 *
 * Every whole-history endpoint (`/api/society`, `/api/bonds`, `/api/heat`, `/api/digest`,
 * `/api/chronicle`, `/api/discoveries`, `/api/timeline/marks`) answers by reading the ENTIRE
 * event log and running `JSON.parse` on every row, synchronously, on the same thread that folds
 * the world. Written for a dev session that meant one viewer, that is correct and cheap.
 * Published to the internet it is an amplifier: a 60-byte GET buys a full scan of the town's
 * whole history, so fifty viewers cost fifty scans and one stranger in a `while true` loop
 * stalls the tick loop for everybody else.
 *
 * The answer only changes when the world does. `WorldMirror.seq()` is exactly that clock, so
 * one scan per generation is enough and every asker after the first is handed a string already
 * built. This is the difference between a demo and a stream.
 *
 * Keys are bounded, because the key includes the query string and a stranger picks that.
 */
export const MAX_KEYS = 32

/**
 * ★ AND A KEY CAP IS NOT A MEMORY CAP.
 *
 * The comment above promised bounded memory and the code bounded the number of KEYS, so the real
 * ceiling was 32 × the largest body — and the largest body was `/api/bonds` at **83 704 521 B**,
 * which made the honest reading of "bounded" about 2.7 GB. Bonds now has a ceiling of its own,
 * but a key cap over unbounded bodies is not a cap and the next big route would inherit the same
 * lie.
 *
 * 4 MiB, because the four whole-history routes come to about 100 KB together on a twelve-agent
 * town and 4 MiB is two orders of headroom over that — large enough that no real viewer ever
 * meets it, small enough to be a number rather than "whatever the biggest answer happens to be".
 *
 * A single body larger than the whole budget is still admitted, after everything else has been
 * dropped for it. Refusing it would mean rebuilding it on every request, which is exactly the
 * amplification this cache exists to stop.
 */
export const MAX_BYTES = 4 * 1024 * 1024

export type SeqCache = {
  /** The body for `key` in this generation, built at most once. */
  json(key: string, build: () => unknown): string
  /**
   * The intermediate VALUE for `key` in this generation, built at most once — for work two
   * routes share. `/api/chronicle` and `/api/chronicle/count` are the same scan and the same
   * formatting; only the shape sent differs, and a badge asking for a number must not pay for
   * the ledger twice.
   */
  value<T>(key: string, build: () => T): T
  /** Testing seam: how many bodies are held right now. */
  size(): number
  /** Testing seam: how many bytes of body are held right now. */
  bytes(): number
}

export function makeSeqCache(
  seqOf: () => number, maxKeys = MAX_KEYS, maxBytes = MAX_BYTES,
): SeqCache {
  let generation = -1
  const bodies = new Map<string, string>()
  const values = new Map<string, unknown>()
  let held = 0
  // Oldest-first eviction. An attacker varying the query string churns these maps but can
  // never grow them, and a real viewer's handful of URLs never reaches the cap.
  const fresh = (): void => {
    const seq = seqOf()
    if (seq === generation) return
    generation = seq
    bodies.clear()
    values.clear()
    held = 0
  }
  const evictOldest = (): void => {
    const oldest = bodies.keys().next()
    if (oldest.done === true) return
    held -= bodies.get(oldest.value)!.length
    bodies.delete(oldest.value)
  }
  return {
    json(key, build) {
      fresh()
      const hit = bodies.get(key)
      if (hit !== undefined) return hit
      const body = JSON.stringify(build())
      if (bodies.size >= maxKeys) evictOldest()
      while (bodies.size > 0 && held + body.length > maxBytes) evictOldest()
      bodies.set(key, body)
      held += body.length
      return body
    },
    value<T>(key: string, build: () => T): T {
      fresh()
      if (values.has(key)) return values.get(key) as T
      const v = build()
      // Intermediates are objects, not strings, so their bytes cannot be measured without
      // serialising them — which is the work this map exists to avoid. Keys only, and the two
      // callers of `value` share one key each.
      if (values.size >= maxKeys) values.delete(values.keys().next().value as string)
      values.set(key, v)
      return v
    },
    size: () => bodies.size,
    bytes: () => held,
  }
}

export const sendPrebuilt = (res: ServerResponse, body: string): void => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(body)
}
