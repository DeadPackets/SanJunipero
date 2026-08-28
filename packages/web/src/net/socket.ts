import { CLOSE_BAD_HELLO, PROTOCOL_VERSION, ServerMsg } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'

const LAST_SEEN_KEY = 'sj:lastSeenTick'
const GAP_TICKS = 1440 // more than a missed day → offer the digest
const BACKOFF_MIN_MS = 1_000
const BACKOFF_MAX_MS = 30_000

export type ObservatoryHandle = { scrub(tick: number): void; goLive(): void; close(): void }
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

  const open = (): void => {
    if (closed) return
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
      if (msg.t === 'snapshot') {
        const last = readLastSeen()
        if (last !== null && msg.tick - last > GAP_TICKS) opts.onGap?.(msg.tick - last)
      }
      opts.store.applyServer(msg)
      if (msg.t === 'snapshot' || msg.t === 'tick') writeLastSeen(msg.tick)
    }
    sock.onclose = (e: CloseEvent) => {
      if (closed) return
      // The server refuses a hello it does not recognise; reconnecting with the same one loops
      // forever, and a reload is the only thing that fetches the viewer this town speaks to.
      if (e.code === CLOSE_BAD_HELLO) {
        location.reload()
        return
      }
      setStatus('reconnecting')
      setTimeout(open, backoffMs)
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS)
    }
  }
  open()
  opts.onStatus?.(status)

  const send = (payload: unknown): void => {
    if (sock !== null && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(payload))
  }
  return {
    scrub(tick) {
      send({ t: 'scrub', tick, reqId: ++reqId })
    },
    goLive() {
      send({ t: 'live' })
    },
    close() {
      closed = true
      sock?.close()
    },
  }
}
