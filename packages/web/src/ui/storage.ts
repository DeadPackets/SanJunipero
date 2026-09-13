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

/** Where the Almanac stands: the sheet over the town, or a column beside it. Remembered, because
 *  a reader who docks it once means it. */
const DOCK = 'sj.paperDock'
export type PaperDock = 'sheet' | 'docked'

export function paperDock(storage: Pick<Storage, 'getItem'> | null): PaperDock {
  try {
    return storage?.getItem(DOCK) === 'docked' ? 'docked' : 'sheet'
  } catch {
    return 'sheet'
  }
}

export function rememberPaperDock(storage: Pick<Storage, 'setItem'> | null, v: PaperDock): void {
  try {
    storage?.setItem(DOCK, v)
  } catch {
    /* nothing to do: the choice holds for this page and is asked again on the next */
  }
}
