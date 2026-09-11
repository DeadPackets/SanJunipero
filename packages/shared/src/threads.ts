import type { StakeTerm } from './stakes.js'
import { MINUTES_PER_DAY } from './time.js'

// What a story is made of. Everything here is read-path only: it sits beside `WHY_PHRASE` and
// no mind can reach any of it.

/** Warm, cold or neither. Keyed by every term, so a term added later fails the typecheck rather
 *  than defaulting to neutral. Editorial about presentation and about nothing else. */
export const VALENCE: Readonly<Record<StakeTerm, -1 | 0 | 1>> = {
  talk: 0,
  quarrel: -1,
  council: 0,
  gathering: 1,
  telling: 1,
  invitation: 0,
  lexicon: 0,
  give_way: 1,
  slight: -1,
  promise_broken: -1,
  attraction: 1,
  partnership_strained: -1,
  agent_died: -1,
  agent_born: 1,
  agent_arrived: 1,
  agent_departed: -1,
  partnership_formed: 1,
  partnership_dissolved: -1,
  law_ratified: 1,
  law_broken: -1,
  law_repealed: -1,
  discovery_made: 1,
  co_slept_first: 1,
  invitation_refused_seen: -1,
}

/** Four sim-days. A grudge six days old still reads at about a third of its peak, which is the
 *  right behaviour for a grudge and is why the 45 tick body decay cannot serve. */
export const THREAD_HALF_LIFE_TICKS = 4 * MINUTES_PER_DAY

const halved = (value: number, elapsedTicks: number, halfLife: number): number =>
  value * Math.pow(2, -Math.max(0, elapsedTicks) / halfLife)

/** The body curve at the thread half life. Both the fold and the viewer read it, so a bar and
 *  a ranking never disagree about how cold a story has gone. */
export const decayedHeat = (heat: number, elapsedTicks: number): number =>
  halved(heat, elapsedTicks, THREAD_HALF_LIFE_TICKS)

/** One sim-day. How much of a story a viewer saw yesterday matters less today than a grudge
 *  does, so screen time forgets four times faster than heat. */
const THREAD_SCREEN_HALF_LIFE_TICKS = MINUTES_PER_DAY

/** The same curve for how much of the ribbon a story has already had. */
export const decayedScreen = (ticks: number, elapsedTicks: number): number =>
  halved(ticks, elapsedTicks, THREAD_SCREEN_HALF_LIFE_TICKS)

/** What the hottest story in town is worth, as a fraction of a peak moment:
 *    storyTerm = THREAD_RANK_COEF * PEAK_SCORE * heat / hottestHeatNow
 *  Two thirds puts that term at 12, midway between an idle talk at 10 and a quarrel at 14, which
 *  is the widest margin the town's own weights leave. Not a regression from the old 0.35: the
 *  units changed in round two. */
export const THREAD_RANK_COEF = 2 / 3

/** The screen-time term of that ranking, which stops the film becoming a soap about one couple. */
export const THREAD_SCREEN_DIVISOR = 0.5
export const THREAD_SCREEN_TICKS = 40

/** A story is at most four people: what a 320px capsule overlaps at 26px, and where `castWords`
 *  stops naming them. At the cap it refuses another member and pays only the edges it holds. */
export const THREAD_MEMBER_CAP = 4

/** Under this many payments a story is still new, whatever its heat has done. */
export const THREAD_OPENING_PAYMENTS = 3

/** How many stories the ribbon carries, and how many rows the shot board shows. */
export const THREAD_TOP_N = 6
export const BOARD_TOP_N = 5

/** A payment this heavy against the thread's running sign is the reversal, detected rather than
 *  written. */
export const THREAD_TURN_WEIGHT = 6

/** Two threads merge when they come to share this many members: a quarrel that grows into a
 *  council is the same story, and a triangle is one story with three edges. */
export const THREAD_MERGE_MEMBERS = 2

/** Under this a thread has nothing left to show. */
export const THREAD_FLOOR = 1

/** Two sim-days with no payment at all and the story is over. Silence is a fact a viewer can
 *  check: nobody has touched this in two days. */
export const THREAD_SILENCE_TICKS = 2 * MINUTES_PER_DAY

/** Every one of these is derived from the payments, none is authored, and the derivation lives
 *  in the gateway fold. */
export const THREAD_STATES = ['opened', 'rising', 'turned', 'held', 'cooling', 'closed'] as const
export type ThreadState = (typeof THREAD_STATES)[number]
