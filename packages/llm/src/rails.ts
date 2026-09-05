/** Dollars in a rolling 24 real hours — the same window the town's own daily stop is measured
 *  on, so a caller's rail and the total it sits under are read against the same day. */
export const RAIL_WINDOW_MS = 24 * 60 * 60 * 1000

/** How often a held caller is let back through to the ledger. The window rolls, so a hold is
 *  never permanent; between re-checks the ask is refused without touching SQL. */
const RAIL_RECHECK_MS = 60_000

/** A caller whose own ceiling stopped it, and until when. */
export type RailHold = { caller: string; untilMs: number; spentUsd: number; railUsd: number }

type Held = RailHold & { nextCheckMs: number }

// Process-wide on purpose: one caller has many clients — every mind builds its own for `turn` —
// and a rail that only held the client that tripped it would hold nothing at all.
const holds = new Map<string, Held>()

/** Whether this caller's ask is refused on the map alone. Null lets it through to the ledger. */
export function railHold(caller: string, now: number): RailHold | null {
  const held = holds.get(caller)
  if (held === undefined) return null
  if (now >= held.untilMs) {
    holds.delete(caller)
    return null
  }
  if (now >= held.nextCheckMs) {
    held.nextCheckMs = now + RAIL_RECHECK_MS
    return null
  }
  return held
}

/** Records a trip. True the first time a caller is held — the alert is written behind that,
 *  so an operator reads one line per rail per day and not one per refused call. */
export function tripRail(hold: RailHold, now: number): boolean {
  const was = holds.get(hold.caller)
  holds.set(hold.caller, { ...hold, nextCheckMs: now + RAIL_RECHECK_MS })
  return was === undefined || now >= was.untilMs
}

/** Test seam: the map outlives any one town, and a test must not inherit another's rail. */
export function clearRails(): void {
  holds.clear()
}
