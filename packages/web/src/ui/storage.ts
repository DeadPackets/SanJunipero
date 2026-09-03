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
