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
  /** Testing seam: how many bodies are held right now. */
  size(): number
}

export function makeSeqCache(seqOf: () => number, maxKeys = MAX_KEYS): SeqCache {
  let generation = -1
  const bodies = new Map<string, string>()
  return {
    json(key, build) {
      const seq = seqOf()
      if (seq !== generation) { generation = seq; bodies.clear() }
      const hit = bodies.get(key)
      if (hit !== undefined) return hit
      const body = JSON.stringify(build())
      // Oldest-first eviction. An attacker varying the query string churns this map but can
      // never grow it, and a real viewer's handful of URLs never reaches the cap.
      if (bodies.size >= maxKeys) bodies.delete(bodies.keys().next().value as string)
      bodies.set(key, body)
      return body
    },
    size: () => bodies.size,
  }
}

export const sendPrebuilt = (res: ServerResponse, body: string): void => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(body)
}
