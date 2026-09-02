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
