import { CLOSE_BAD_HELLO, PROTOCOL_VERSION, ServerMsg } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'

const LAST_SEEN_KEY = 'sj:lastSeenTick'
const STALE_BUNDLE_KEY = 'sj:reloadedForStale'
const GAP_TICKS = 1440 // more than a missed day → offer the digest
const BACKOFF_MIN_MS = 1_000
const BACKOFF_MAX_MS = 30_000
/** A tab in the background is nobody watching: after this long hidden it lets go of the wire,
 *  so the town can count it out and slow down (owner, 2026-09-05). Long enough that switching
 *  tabs and back never drops the view. */
export const HIDDEN_GRACE_MS = 15_000

export type ObservatoryHandle = {
  scrub(tick: number): void
  /** Play the town forward from `from` at the live cadence, until it catches up or `goLive`. */
  replay(from: number): void
  goLive(): void
  close(): void
}
export type LinkStatus = 'connecting' | 'online' | 'reconnecting'

export function connectObservatory(opts: {
  url: string
  store: WorldStore
  onGap?: (missedTicks: number) => void
  onStatus?: (status: LinkStatus) => void
}): ObservatoryHandle {
  let closed = false
  let sock: WebSocket | null = null
  let backoffMs = BACKOFF_MIN_MS
  let hidden = false
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let reqId = 0
  let warnedBadFrame = false
  let status: LinkStatus = 'connecting'
  const setStatus = (next: LinkStatus): void => {
    if (status === next) return
    status = next
    opts.onStatus?.(next)
  }

  const readLastSeen = (): number | null => {
    try {
      const v = localStorage.getItem(LAST_SEEN_KEY)
      if (v === null) return null
      const n = Math.floor(Number(v))
      // a corrupt stored value must never brick the hello (schema wants a nonnegative int)
      return Number.isFinite(n) && n >= 0 ? n : null
    } catch {
      return null
    }
  }
  const writeLastSeen = (tick: number): void => {
    try {
      localStorage.setItem(LAST_SEEN_KEY, String(tick))
    } catch {
      /* private mode */
    }
  }

  /** One reload per page load. A bundle a cache still serves is refused again after the reload,
   *  and without this every open tab re-fetches it about once a second for as long as it lasts. */
  const reloadOnce = (): boolean => {
    try {
      if (sessionStorage.getItem(STALE_BUNDLE_KEY) !== null) return false
      sessionStorage.setItem(STALE_BUNDLE_KEY, '1')
    } catch {
      /* site data blocked: the guard is best effort, the reload is not */
    }
    location.reload()
    return true
  }
  const clearStaleMark = (): void => {
    try {
      sessionStorage.removeItem(STALE_BUNDLE_KEY)
    } catch {
      /* site data blocked */
    }
  }

  const open = (): void => {
    if (closed || hidden) return
    sock = new WebSocket(opts.url)
    sock.onopen = () => {
      backoffMs = BACKOFF_MIN_MS
      setStatus('online')
      sock?.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, lastSeenTick: readLastSeen() }))
    }
    sock.onmessage = (e: MessageEvent) => {
      let msg
      try {
        msg = ServerMsg.parse(JSON.parse(String(e.data)))
      } catch {
        // A frame shape this tab does not know must not take the viewer down with it.
        if (!warnedBadFrame) {
          warnedBadFrame = true
          console.warn('observatory: a frame this viewer cannot read was ignored')
        }
        return
      }
      // A scrub inside the server's coalescing window is answered late — after the `live` the
      // viewer asked for next — and would put the view back on a minute they have left.
      if ((msg.t === 'scrubbed' || msg.t === 'replaying') && msg.reqId !== reqId) return
      if (msg.t === 'snapshot') {
        const last = readLastSeen()
        if (last !== null && msg.tick - last > GAP_TICKS) opts.onGap?.(msg.tick - last)
      }
      const trouble = opts.store.applyServer(msg)
      if (trouble === 'reload') {
        reloadOnce()
        return
      }
      if (trouble === 'resnapshot') {
        send({ t: 'live' })
        return
      }
      // The town read: whatever this tab reloaded for is behind it, so the next real refusal
      // is allowed its own reload.
      if (msg.t === 'snapshot') clearStaleMark()
      // A replayed minute is a minute this viewer has already seen: stored, it would make the
      // next visit offer a digest of the days between then and now.
      if (msg.t === 'snapshot' || (msg.t === 'tick' && opts.store.getMode().live))
        writeLastSeen(msg.tick)
    }
    sock.onclose = (e: CloseEvent) => {
      if (closed || hidden) return
      // The server refuses a hello it does not recognise: reconnecting with the same one loops
      // forever, and only a reload fetches a viewer this town speaks to.
      if (e.code === CLOSE_BAD_HELLO && reloadOnce()) return
      setStatus('reconnecting')
      setTimeout(open, backoffMs)
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS)
    }
  }
  // The wire is let go while the tab is hidden and picked up again the moment it is seen: a
  // page open behind another counts as nobody watching, and reopens onto a fresh snapshot.
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      hideTimer ??= setTimeout(() => {
        hideTimer = null
        hidden = true
        setStatus('reconnecting')
        sock?.close()
        sock = null
      }, HIDDEN_GRACE_MS)
      return
    }
    if (hideTimer !== null) clearTimeout(hideTimer)
    hideTimer = null
    if (!hidden) return
    hidden = false
    backoffMs = BACKOFF_MIN_MS
    open()
  }
  const doc = typeof document === 'undefined' ? null : document
  doc?.addEventListener('visibilitychange', onVisibility)
  open()
  opts.onStatus?.(status)

  const send = (payload: unknown): void => {
    if (sock !== null && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(payload))
  }
  return {
    scrub(tick) {
      send({ t: 'scrub', tick, reqId: ++reqId })
    },
    replay(from) {
      send({ t: 'replay', from, reqId: ++reqId })
    },
    goLive() {
      reqId++ // no scrub still in flight can answer for the live edge
      send({ t: 'live' })
    },
    close() {
      closed = true
      if (hideTimer !== null) clearTimeout(hideTimer)
      doc?.removeEventListener('visibilitychange', onVisibility)
      sock?.close()
    },
  }
}
