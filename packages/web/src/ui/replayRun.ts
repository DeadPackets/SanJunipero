import { useEffect } from 'react'
import type { WorldStore } from '../state/worldStore.js'

/** A point event is watched from three sim-minutes before it to ten after: long enough for the
 *  bodies to arrive and the thing to land, short enough that day 3 of a nine-day town is not a
 *  4.8-hour sit. A scene brings its own close and needs no tail. */
export const MOMENT_LEAD_TICKS = 3
export const MOMENT_TAIL_TICKS = 10

/** One replayed moment: where it starts, where it stops, who it is about, what to call it. */
export type MomentPlay = {
  from: number
  until: number
  /** the people the moment is about, for the camera and the title card */
  cast: readonly string[]
  /** the chronicle line or the scene topic, for the title card */
  title: string
  tick: number
}

const clampSpan = (from: number, until: number, edge: number): { from: number; until: number } => {
  const start = Math.max(0, Math.min(from, edge))
  return { from: start, until: Math.max(start, Math.min(until, edge)) }
}

/** The window around one thing that happened at `tick`. */
export function pointWindow(tick: number, edge: number): { from: number; until: number } {
  return clampSpan(tick - MOMENT_LEAD_TICKS, tick + MOMENT_TAIL_TICKS, edge)
}

/** A scene runs from the minute before it opened to its own close. */
export function sceneWindow(
  startTick: number,
  endTick: number,
  edge: number,
): { from: number; until: number } {
  return clampSpan(startTick - 1, Math.max(startTick, endTick), edge)
}

export function pointPlay(
  tick: number,
  edge: number,
  title: string,
  cast: readonly string[] = [],
): MomentPlay {
  return { ...pointWindow(tick, edge), cast, title, tick }
}

/** Has the playhead reached the end of the moment? A replay is a stream of `tick` frames and the
 *  socket coalesces, so the arrival tick can overshoot — hence `>=`, never `===`. */
export function reachedEnd(play: MomentPlay, tick: number, replaying: boolean): boolean {
  return replaying && tick >= play.until
}

/** `ClientReplay` carries no end, so the end is watched here rather than grown into the protocol:
 *  the store is the playhead, and the still the moment finishes on is `scrub(until)`. */
export function useMomentEnd(
  store: WorldStore,
  play: MomentPlay | null,
  onEnd: (until: number) => void,
): void {
  useEffect(() => {
    if (play === null) return
    const check = (): void => {
      const mode = store.getMode()
      if (mode.live || !reachedEnd(play, mode.tick, mode.replaying)) return
      onEnd(play.until)
    }
    check()
    return store.subscribe(check)
  }, [store, play, onEnd])
}
