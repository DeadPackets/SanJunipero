import { PROTOCOL_VERSION, ServerMsg } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'

export const LAST_SEEN_KEY = 'sj:lastSeenTick'
export const GAP_TICKS = 1440              // more than a missed day → offer the digest
export const BACKOFF_MIN_MS = 1_000
export const BACKOFF_MAX_MS = 30_000

export type ObservatoryHandle = { scrub(tick: number): void; goLive(): void; close(): void }

export function connectObservatory(opts: {
  url: string
  store: WorldStore
  onGap?: (missedTicks: number) => void
}): ObservatoryHandle {
  let closed = false
  let sock: WebSocket | null = null
  let backoffMs = BACKOFF_MIN_MS
  let reqId = 0

  const readLastSeen = (): number | null => {
    try {
      const v = localStorage.getItem(LAST_SEEN_KEY)
      return v === null ? null : Number(v)
    } catch { return null }
  }
  const writeLastSeen = (tick: number): void => {
    try { localStorage.setItem(LAST_SEEN_KEY, String(tick)) } catch { /* private mode */ }
  }

  const open = (): void => {
    if (closed) return
    sock = new WebSocket(opts.url)
    sock.onopen = () => {
      backoffMs = BACKOFF_MIN_MS
      sock?.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, lastSeenTick: readLastSeen() }))
    }
    sock.onmessage = (e: MessageEvent) => {
      const msg = ServerMsg.parse(JSON.parse(String(e.data)))
      if (msg.t === 'snapshot') {
        const last = readLastSeen()
        if (last !== null && msg.tick - last > GAP_TICKS) opts.onGap?.(msg.tick - last)
      }
      opts.store.applyServer(msg)
      if (msg.t === 'snapshot' || msg.t === 'tick') writeLastSeen(msg.tick)
    }
    sock.onclose = () => {
      if (closed) return
      setTimeout(open, backoffMs)
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS)
    }
  }
  open()

  const send = (payload: unknown): void => {
    if (sock !== null && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(payload))
  }
  return {
    scrub(tick) { send({ t: 'scrub', tick, reqId: ++reqId }) },
    goLive() { send({ t: 'live' }) },
    close() { closed = true; sock?.close() },
  }
}
