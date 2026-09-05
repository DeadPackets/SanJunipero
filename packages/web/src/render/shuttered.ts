import type { SimEvent } from '@sj/shared'

// A house with two people lying together in it is shut to the town. The viewer is told the
// house is not to be looked into, and is told it the way a house says it: the window goes dim.

/** What is left of a shuttered window's glow. Not nothing — somebody is home. */
export const SHUTTERED_GLOW = 0.3

const LIE_WITH = 'lie_with'

export type Shutters = {
  /** structureId → the tick the door opens again */
  readonly houses: ReadonlyMap<string, number>
  /** whose act is holding each shut, so the last one up opens it */
  readonly by: ReadonlyMap<string, string>
}

export const NO_SHUTTERS: Shutters = { houses: new Map(), by: new Map() }

export function isShuttered(shutters: Shutters, structureId: string, tick: number): boolean {
  return (shutters.houses.get(structureId) ?? -1) > tick
}

/** Reads the log for the act and for its end. `insideOf` is the world's own answer to which roof
 *  a body is under; a body that is under none shutters nothing. Returns the SAME object when the
 *  window of events said nothing about a door. */
export function foldShutters(
  prev: Shutters,
  events: readonly SimEvent[],
  insideOf: (agentId: string) => string | undefined,
): Shutters {
  const houses = new Map(prev.houses)
  const by = new Map(prev.by)
  let touched = false

  for (const ev of events) {
    const p = ev.payload as { agentId?: unknown; verb?: unknown; duration?: unknown }
    const who = typeof p.agentId === 'string' ? p.agentId : null
    if (who === null) continue

    if (ev.type === 'action_started' && p.verb === LIE_WITH) {
      const house = insideOf(who)
      if (house === undefined) continue
      const duration = typeof p.duration === 'number' ? p.duration : 0
      houses.set(house, Math.max(houses.get(house) ?? 0, ev.tick + duration))
      by.set(who, house)
      touched = true
      continue
    }
    // A body has one activity at a time, so any end to this one's is an end to the act. The
    // other body may still be lying there, and then the door stays shut.
    if (ev.type !== 'action_completed' && ev.type !== 'action_interrupted') continue
    const house = by.get(who)
    if (house === undefined) continue
    by.delete(who)
    if (![...by.values()].includes(house)) houses.delete(house)
    touched = true
  }

  if (!touched) return prev
  // A house whose hour ran out with no end in the log is open again; nothing here outlives it.
  const now = events[events.length - 1]?.tick ?? 0
  for (const [id, until] of houses) if (until <= now) houses.delete(id)
  for (const [who, id] of by) if (!houses.has(id)) by.delete(who)
  return { houses, by }
}
