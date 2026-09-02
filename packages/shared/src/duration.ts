import { z } from 'zod'

// How long an act takes, in the words a person uses for it. Ticks are an engine unit and nobody
// thinks in them: every act in the town, built-in or minted, picks one of these six.

/** Log-spaced, and a day is the ceiling — a horizon longer than that belongs to a thing worked
 *  on across sessions, which carries its own progress, not to one act. */
export const DURATION_WORDS = ['moment', 'minutes', 'half_hour', 'hour', 'morning', 'day'] as const
export type DurationWord = (typeof DURATION_WORDS)[number]

/** THE ONE PLACE A WORD BECOMES TICKS. One tick is one sim-minute. */
export const DURATION_TICKS: Readonly<Record<DurationWord, number>> = {
  moment: 2,
  minutes: 10,
  half_hour: 30,
  hour: 60,
  morning: 240,
  day: 600,
}

export const DurationWordSchema = z.enum(DURATION_WORDS)

export function ticksFor(word: DurationWord): number {
  return DURATION_TICKS[word]
}

/** What a word off the set falls back to once the retry has been spent. */
export const DEFAULT_DURATION_WORD: DurationWord = 'half_hour'

/** The set, said the way a prompt says it, so the arbiter and the engine cannot drift apart. */
export const DURATION_VOCABULARY = DURATION_WORDS.map(
  (w) => `${w} (${DURATION_TICKS[w]} minutes)`,
).join(', ')
