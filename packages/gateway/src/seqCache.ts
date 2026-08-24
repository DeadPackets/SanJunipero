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
}

export function makeSeqCache(seqOf: () => number, maxKeys = MAX_KEYS): SeqCache {
  let generation = -1
  const bodies = new Map<string, string>()
  const values = new Map<string, unknown>()
  // Oldest-first eviction. An attacker varying the query string churns these maps but can
  // never grow them, and a real viewer's handful of URLs never reaches the cap.
  const fresh = (): void => {
    const seq = seqOf()
    if (seq === generation) return
    generation = seq
    bodies.clear()
    values.clear()
  }
  const cap = (m: Map<string, unknown>): void => {
    if (m.size >= maxKeys) m.delete(m.keys().next().value as string)
  }
  return {
    json(key, build) {
      fresh()
      const hit = bodies.get(key)
      if (hit !== undefined) return hit
      const body = JSON.stringify(build())
      cap(bodies)
      bodies.set(key, body)
      return body
    },
    value<T>(key: string, build: () => T): T {
      fresh()
      if (values.has(key)) return values.get(key) as T
      const v = build()
      cap(values)
      values.set(key, v)
      return v
    },
    size: () => bodies.size,
  }
}

export const sendPrebuilt = (res: ServerResponse, body: string): void => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(body)
}
