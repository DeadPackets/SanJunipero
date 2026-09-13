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

/** The tick this browser had watched up to when the tab OPENED. `socket.ts` overwrites
 *  `sj:lastSeenTick` on the first snapshot, so anything that wants to know what the viewer
 *  missed has to have read it before that — which is what this module-load capture is for. */
const VISIT_WATERMARK: number | null = (() => {
  try {
    const raw = localStore()?.getItem('sj:lastSeenTick')
    if (raw === null || raw === undefined) return null
    const n = Math.floor(Number(raw))
    return Number.isFinite(n) && n >= 0 ? n : null
  } catch {
    return null
  }
})()

export function lastVisitTick(): number | null {
  return VISIT_WATERMARK
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

/** Where the Almanac stands: the sheet over the town, or a column beside it. Remembered, because
 *  a reader who docks it once means it. */
const DOCKS = ['sheet', 'docked'] as const
export type PaperDock = (typeof DOCKS)[number]
const dock = pref('sj.paperDock', DOCKS, 'sheet')
export const paperDock = dock.read
export const rememberPaperDock = dock.write
