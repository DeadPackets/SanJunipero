import { useEffect } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import { stamp } from '../paper/stamp.js'
import { SCENE_OUT_MS, SCENE_TOTAL_MS, transitionAlpha } from './sceneTransition.js'

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
export function watchMomentEnd(
  store: WorldStore,
  play: MomentPlay,
  onEnd: (until: number) => void,
): () => void {
  const check = (): void => {
    const mode = store.getMode()
    if (mode.live || !reachedEnd(play, mode.tick, mode.replaying)) return
    onEnd(play.until)
  }
  check()
  return store.subscribe(check)
}

export function useMomentEnd(
  store: WorldStore,
  play: MomentPlay | null,
  onEnd: (until: number) => void,
): void {
  useEffect(() => {
    if (play === null) return
    return watchMomentEnd(store, play, onEnd)
  }, [store, play, onEnd])
}

/** The card names the moment and gets out of the way. It goes on the first thing that happens
 *  in the town, so the words never stand over the thing they were announcing. */
export const TITLE_CARD_MS = 2000

/** The curtain over the town, off the SAME out-120/in-180 machine an interior uses: the town
 *  leaves, the past arrives. Under reduced motion there is no dip at all — the sheet's rule is
 *  a fade or nothing, and a hard step to black for 180 ms is neither. */
export function dipAlpha(elapsedMs: number, reducedMotion = false): number {
  if (reducedMotion) return 0
  if (elapsedMs >= SCENE_TOTAL_MS || elapsedMs < 0) return 0
  const a = transitionAlpha(elapsedMs)
  return 1 - (elapsedMs < SCENE_OUT_MS ? a.out : a.in)
}

/** `Day 3 · 04:57` — the dateline of the minute the moment starts at. */
export function momentDateline(tick: number): string {
  const s = stamp(tick)
  return `Day ${s.day} · ${s.time}`
}

/** The cast as the card names them, in the town's own words. */
export function castNames(
  cast: readonly string[],
  nameOf: (id: string) => string | undefined,
): string {
  const named = cast.map(nameOf).filter((n): n is string => n !== undefined && n !== '')
  if (named.length <= 1) return named[0] ?? ''
  return `${named.slice(0, -1).join(', ')} and ${named.at(-1)!}`
}
