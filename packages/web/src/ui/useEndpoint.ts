import { useMemo, useSyncExternalStore } from 'react'

/** `loaded` says an answer has been waited for; `failed` keeps a refused read from printing
 *  the empty state as a fact about the town. */
export type Read<T> = { data: T | null; loaded: boolean; failed: boolean }
export type Endpoint<T> = {
  get: () => Read<T>
  /** how many reads have settled — for a caller whose ROUND turns on the poll landing rather
   *  than on the answer changing */
  beat: () => number
  subscribe: (fn: () => void) => () => void
  retry: () => void
}

const UNREAD: Read<never> = { data: null, loaded: false, failed: false }

/** Reads while somebody is subscribed. A refused read keeps the last good answer and still
 *  wakes its readers, so a caller whose beat drives a state machine keeps turning. */
export function endpoint<T>(
  url: string | null,
  parse: (body: unknown) => T | null = (body) => body as T,
  everyMs?: number,
): Endpoint<T> {
  let read = UNREAD as Read<T>
  const subs = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | null = null
  let beats = 0
  let lastBody: string | null = null
  // ONE read at a time: two polls overlapping on a slow link land out of order.
  let inflight: AbortController | null = null

  const wake = (): void => {
    beats += 1
    for (const fn of subs) fn()
  }

  const settle = (data: T | null, failed: boolean): void => {
    read = { data: data ?? read.data, loaded: true, failed }
    wake()
  }

  const load = (): void => {
    if (url === null || inflight !== null) return
    const ctl = new AbortController()
    inflight = ctl
    void fetch(url, { signal: ctl.signal })
      .then(async (r) => (r.ok ? await r.text() : null))
      .then((body) => {
        inflight = null
        if (body === null) {
          settle(null, true)
          return
        }
        // An unchanged body costs no parse and no render: the read keeps its identity, and
        // `useSyncExternalStore` compares by `Object.is`.
        if (body === lastBody && read.loaded && !read.failed) {
          wake()
          return
        }
        lastBody = body
        let parsed: T | null = null
        try {
          parsed = parse(JSON.parse(body))
        } catch {
          parsed = null // a body the parser rejects is not a refused read; keep the last good one
        }
        settle(parsed, false)
      })
      .catch(() => {
        inflight = null
        if (!ctl.signal.aborted) settle(null, true)
      })
  }

  return {
    get: () => read,
    beat: () => beats,
    retry: load,
    subscribe: (fn) => {
      subs.add(fn)
      if (subs.size === 1 && url !== null) {
        load()
        if (everyMs !== undefined) timer = setInterval(load, everyMs)
      }
      return () => {
        subs.delete(fn)
        if (subs.size > 0) return
        if (timer !== null) {
          clearInterval(timer)
          timer = null
        }
        inflight?.abort()
        inflight = null
      }
    },
  }
}

/** One reader per URL for the life of the session: it stops polling when nobody is listening
 *  and keeps what it read. */
const readers = new Map<string, Endpoint<unknown>>()

export function feedFor<T>(
  url: string,
  parse?: (body: unknown) => T | null,
  everyMs?: number,
): Endpoint<T> {
  // The beat is part of the identity: two callers asking for the same URL on different beats
  // are two readers, and the first parser registered is the one that reads it.
  const key = `${url}|${everyMs ?? 0}`
  let feed = readers.get(key)
  if (feed === undefined) {
    feed = endpoint(url, parse, everyMs)
    readers.set(key, feed)
  }
  return feed as Endpoint<T>
}

export function useFeed<T>(feed: Endpoint<T>): Read<T> {
  return useSyncExternalStore(feed.subscribe, feed.get, feed.get)
}

/** A changed `url` is a new reader, so a panel showing one person's document never shows it
 *  under the next person's name. */
export function useEndpointFor<T>(
  url: string | null,
  parse?: (body: unknown) => T | null,
  everyMs?: number,
): Endpoint<T> {
  return useMemo(
    // `parse` is a parser, not a prop: re-keying on it would restart the read every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => (url === null ? endpoint<T>(null, parse, everyMs) : feedFor<T>(url, parse, everyMs)),
    [url, everyMs],
  )
}

export function usePolled<T>(
  url: string | null,
  parse?: (body: unknown) => T | null,
  everyMs?: number,
): Read<T> {
  return useFeed(useEndpointFor<T>(url, parse, everyMs))
}
