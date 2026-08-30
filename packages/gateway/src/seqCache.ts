import type { ServerResponse } from 'node:http'

/** One scan per `WorldMirror` generation: otherwise a 60-byte GET buys a full log scan, and
 *  fifty viewers cost fifty scans on the tick thread. Keys are bounded because the key includes
 *  the query string and a stranger picks that. */
export const MAX_KEYS = 32

/** Bounded by BYTES, not key count — 4 MiB against ~100 KB of real bodies, since a key cap over
 *  unbounded bodies is not a cap. A single body over the whole budget is still admitted, because
 *  refusing it means rebuilding it per request. The budget is per mounted router and deliberately
 *  not shared, so one route's churn cannot evict another's memo. */
export const MAX_BYTES = 4 * 1024 * 1024

/** Intermediates cannot be weighed without serialising them, so they get a count cap instead of
 *  a share of the byte budget: a stranger varying the window evicts rather than accumulates. */
export const MAX_VALUES = 2

export type SeqCache = {
  /** The body for `key` in this generation, built at most once. */
  json(key: string, build: () => unknown): string
  /** The intermediate VALUE for `key` in this generation, built at most once — for work two
   *  routes share, such as `/api/chronicle` and `/api/chronicle/count`. */
  value<T>(key: string, build: () => T): T
  /** Testing seam: how many bodies are held right now. */
  size(): number
  /** Testing seam: how many bytes of body are held right now. */
  bytes(): number
}

export function makeSeqCache(
  seqOf: () => number,
  maxKeys = MAX_KEYS,
  maxBytes = MAX_BYTES,
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
      if (values.size >= MAX_VALUES) values.delete(values.keys().next().value!)
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
