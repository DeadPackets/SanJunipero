/** Reading the `sessionStorage` property ITSELF throws `SecurityError` where site data is
 *  blocked, before any `getItem` guard inside can run. */
export function sessionStore(): Storage | null {
  try {
    return sessionStorage
  } catch {
    return null
  }
}

/** The same guard for a preference that outlives the tab: how this browser likes the town shown
 *  is not news about one session. */
export function localStore(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

export type VisitCursor = { runId: string | null; seq: number | null; tick: number | null }
const EMPTY_VISIT: VisitCursor = { runId: null, seq: null, tick: null }
const VISIT_KEY = 'sj:lastVisit'

export function readVisitCursor(): VisitCursor {
  try {
    const raw = localStore()?.getItem(VISIT_KEY)
    if (!raw) return EMPTY_VISIT
    const value = JSON.parse(raw) as VisitCursor
    if (
      typeof value.runId !== 'string' ||
      !value.runId ||
      !Number.isSafeInteger(value.seq) ||
      value.seq === null ||
      value.seq < 0 ||
      !Number.isSafeInteger(value.tick) ||
      value.tick === null ||
      value.tick < 0
    )
      return EMPTY_VISIT
    return { runId: value.runId, seq: value.seq, tick: value.tick }
  } catch {
    return EMPTY_VISIT
  }
}

export function rememberVisit(cursor: VisitCursor): void {
  try {
    localStore()?.setItem(VISIT_KEY, JSON.stringify(cursor))
  } catch {
    /* site data blocked */
  }
}

// Capture before the first snapshot updates storage; reconnecting must not move this visit's start.
const VISIT_CURSOR = readVisitCursor()
export function lastVisitCursor(): VisitCursor {
  return VISIT_CURSOR
}

export function lastVisitTick(runId: string | null): number | null {
  return runId !== null && runId === VISIT_CURSOR.runId ? VISIT_CURSOR.tick : null
}

/** One remembered word: the same try/catch on both sides, because reading the storage property
 *  ITSELF throws where site data is blocked. A word off this list is a word a later build wrote,
 *  so the fallback stands. */
export function pref<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  return {
    read: (storage: Pick<Storage, 'getItem'> | null): T => {
      try {
        const said = storage?.getItem(key)
        return allowed.find((w) => w === said) ?? fallback
      } catch {
        return fallback
      }
    },
    write: (storage: Pick<Storage, 'setItem'> | null, v: T): void => {
      try {
        storage?.setItem(key, v)
      } catch {
        /* nothing to do: the choice holds for this page and is asked again on the next */
      }
    },
  }
}
