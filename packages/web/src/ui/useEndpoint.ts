import { useMemo, useSyncExternalStore } from 'react'

/** `data` is the last answer that arrived, `loaded` says whether one has been WAITED for yet —
 *  the difference between "nothing has happened" and "nobody has asked". */
export type Read<T> = { data: T | null; loaded: boolean }
export type Endpoint<T> = { get: () => Read<T>; subscribe: (fn: () => void) => () => void }

const UNREAD: Read<never> = { data: null, loaded: false }

/**
 * One reader for one URL. It reads while somebody is subscribed and stops when the last of them
 * leaves; `everyMs` re-reads on that beat, and no `everyMs` reads once. A refused read, or a body
 * the parser rejects, keeps the last good answer rather than blanking the panel — and still wakes
 * its readers, so a reader whose BEAT drives a state machine keeps turning while the gateway is
 * down.
 */
export function endpoint<T>(
  url: string | null,
  parse: (body: unknown) => T | null = (body) => body as T,
  everyMs?: number,
): Endpoint<T> {
  let read = UNREAD as Read<T>
  const subs = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | null = null

  const settle = (data: T | null): void => {
    read = { data: data ?? read.data, loaded: true }
    for (const fn of subs) fn()
  }

  const load = (): void => {
    if (url === null) return
    void fetch(url)
      .then(async (r) => (r.ok ? parse(await r.json()) : null))
      .then(settle)
      .catch(() => {
        settle(null)
      })
  }

  return {
    get: () => read,
    subscribe: (fn) => {
      subs.add(fn)
      if (subs.size === 1 && url !== null) {
        load()
        if (everyMs !== undefined) timer = setInterval(load, everyMs)
      }
      return () => {
        subs.delete(fn)
        if (subs.size === 0 && timer !== null) {
          clearInterval(timer)
          timer = null
        }
      }
    },
  }
}

/** Read a feed that is shared page-wide (`feeds.ts`). */
export function useFeed<T>(feed: Endpoint<T>): Read<T> {
  return useSyncExternalStore(feed.subscribe, feed.get, feed.get)
}

/** Read an endpoint this component alone wants. A changed `url` is a new read, so a panel showing
 *  one person's document never shows it under the next person's name. */
export function usePolled<T>(
  url: string | null,
  parse?: (body: unknown) => T | null,
  everyMs?: number,
): Read<T> {
  // `parse` is a parser, not a prop: re-keying on it would restart the read every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const feed = useMemo(() => endpoint<T>(url, parse, everyMs), [url, everyMs])
  return useFeed(feed)
}
