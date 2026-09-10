import { TYPE_CHARS_PER_S } from '../render/converse.js'

// One slot with four claimants replaced a line mid-read and finished neither. A slot holds one
// line, keeps it until it has been readable, and shows the newest thing that arrived meanwhile.

/** Long enough to notice the line changed at all, before the town's own reading pace over the
 *  words. Capped, so one long line cannot hold the slot against everything behind it. */
const CUE_NOTICE_MS = 1000
const CUE_FLOOR_MAX_MS = 4000

function cueFloorMs(words: string): number {
  return Math.min(
    CUE_FLOOR_MAX_MS,
    CUE_NOTICE_MS + Math.ceil((words.length * 1000) / TYPE_CHARS_PER_S),
  )
}

/** A line the slot can hold, keyed by the words a viewer reads. An empty key is no line. */
export type CueLine<T> = { key: string; line: T | null }

/** What the slot is holding, until when, and the last thing the world handed it. `waiting` is
 *  the queue and it is one deep: a second arrival drops the first, which the world has left. */
export type CueSlot<T> = { shown: CueLine<T>; until: number; waiting: CueLine<T> }

export const NO_CUE_LINE: CueLine<never> = { key: '', line: null }

export function cueStep<T>(slot: CueSlot<T>, next: CueLine<T>, now: number): CueSlot<T> {
  if (next.key === slot.shown.key) return { shown: next, until: slot.until, waiting: next }
  if (now < slot.until) return { shown: slot.shown, until: slot.until, waiting: next }
  return {
    shown: next,
    until: next.key === '' ? 0 : now + cueFloorMs(next.key),
    waiting: next,
  }
}
