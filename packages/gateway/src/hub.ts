export const MAX_BUFFERED = 1_048_576      // 1 MiB: beyond this a viewer is lagging
export const RESUME_BELOW = 65_536         // drained enough to resync
export type HubSocket = { send(data: string): void; readonly bufferedAmount: number; readonly readyState: number }
export const OPEN = 1

type Member = { sock: HubSocket; onResync: () => string; lagging: boolean }

/** What the hub says out loud. Injectable so a test can read the sentence instead of stderr. */
export type HubReport = (line: string) => void

// broadcast serializes NOTHING — callers pass one pre-built string (serialize-once at the call site).
export class SocketHub {
  #members = new Set<Member>()
  #report: HubReport

  /**
   * ★ THE STREAM COULD NOT TELL ANYBODY IT WAS UNHEALTHY.
   *
   * The hub decides a viewer is 1 MiB behind, marks it `lagging` and silently drops its deltas
   * until it drains. `laggingCount()` reported that and **had no non-test caller** — so on a
   * surface handed to strangers, the one health signal that matters was computed for nobody.
   *
   * A line on stderr rather than a field on `/api/health`, and the reason is the defect itself:
   * a gauge nobody polls is the same failure in a new shape. **The event is a transition.** A
   * viewer crossing the threshold is a discrete moment, `pump()` runs every 250 ms, and a viewer
   * can lag and drain entirely between two samples of an endpoint — a poll would simply miss it.
   * stderr is also the channel this surface already uses: `server.ts` reports socket-server
   * errors the same way, and one convention beats two.
   *
   * It cannot flood. A line is written when a viewer CHANGES state, and the 1 MiB / 64 KiB
   * hysteresis means changing state costs a megabyte of drain — not per broadcast, and not per
   * viewer per tick.
   */
  constructor(report: HubReport = (line) => console.warn(`gateway: ${line}`)) {
    this.#report = report
  }

  add(sock: HubSocket, onResync: () => string): () => void {
    const m: Member = { sock, onResync, lagging: false }
    this.#members.add(m)
    return () => { this.#members.delete(m) }
  }

  broadcast(json: string): void {
    for (const m of this.#members) {
      if (m.sock.readyState !== OPEN) { this.#members.delete(m); continue }
      if (!m.lagging) {
        if (m.sock.bufferedAmount > MAX_BUFFERED) {
          m.lagging = true                    // deltas are droppable: resync replaces them
          this.#say('fell behind and is having its deltas dropped', m.sock.bufferedAmount)
          continue
        }
        m.sock.send(json)
      } else if (m.sock.bufferedAmount < RESUME_BELOW) {
        m.sock.send(m.onResync())
        m.lagging = false
        this.#say('caught up and was resynced', m.sock.bufferedAmount)
        m.sock.send(json)
      }
      // else: still lagging → drop
    }
  }

  #say(what: string, buffered: number): void {
    this.#report(
      `a viewer ${what} at ${buffered} B buffered`
      + ` — ${this.laggingCount()} of ${this.size()} viewers lagging`)
  }

  size(): number { return this.#members.size }
  laggingCount(): number { return [...this.#members].filter(m => m.lagging).length }
}
