export const TICK_REAL_MS = 2000
export const MINUTES_PER_DAY = 1440
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const
export type Season = (typeof SEASONS)[number]
// A year is four weeks: a life a viewer can watch to its end, and a winter every fourth week.
export const DAYS_PER_YEAR = 28
// Derived, never typed: `simTimeFromTick` indexes SEASONS by it, so a year that is not four
// seasons long is a season the calendar cannot name.
export const DAYS_PER_SEASON = DAYS_PER_YEAR / SEASONS.length

/** A grown body of no particular age — what a fixture means when it spawns "an adult". Counted,
 *  never typed: the literal 7 300 that used to say this is an elder on a four-week year. */
export const ADULT_AGE_DAYS = 30 * DAYS_PER_YEAR

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night'

export const DAWN_HOUR = 5
// The hour `SimTime.isNight` turns over on, which is the hour every sleeping mind's night begins.
const NIGHT_HOUR = 20

// The only phase derivation in the codebase. `SimTime.isNight` is the older two-way
// clock and every landed caller keeps it — the two disagree at dusk on purpose.
export function dayPhaseFromTick(tick: number): DayPhase {
  const hour = Math.floor((tick % MINUTES_PER_DAY) / 60)
  if (hour >= 21 || hour < DAWN_HOUR) return 'night'
  if (hour === 5 || hour === 6) return 'dawn'
  if (hour === 19 || hour === 20) return 'dusk'
  return 'day'
}

const tickOfHour = (tick: number, hour: number): number =>
  Math.floor(tick / MINUTES_PER_DAY) * MINUTES_PER_DAY + hour * 60

export function nextDawnTick(tick: number): number {
  const dawn = tickOfHour(tick, DAWN_HOUR)
  return tick < dawn ? dawn : dawn + MINUTES_PER_DAY
}

/** The most recent turn of `isNight` at or before this tick — the instant the whole fleet
 *  crosses into night together, and the only shared origin an anti-herd offset can measure from. */
export function nightStartTick(tick: number): number {
  const dusk = tickOfHour(tick, NIGHT_HOUR)
  return tick >= dusk ? dusk : dusk - MINUTES_PER_DAY
}

/** A container gives about ten seconds before SIGKILL; losing a night's reflection is survivable
 *  and hanging the shutdown is not, so a closing town waits this long for one and no longer. */
export const REFLECTION_SETTLE_MS = 5_000

export type SimTime = {
  tick: number
  year: number
  season: Season
  dayOfSeason: number
  dayOfYear: number
  hour: number
  minute: number
  isNight: boolean
}

export function simTimeFromTick(tick: number): SimTime {
  const dayIndex = Math.floor(tick / MINUTES_PER_DAY)
  const minuteOfDay = tick % MINUTES_PER_DAY
  const year = Math.floor(dayIndex / DAYS_PER_YEAR)
  const dayOfYear = dayIndex % DAYS_PER_YEAR
  const season = SEASONS[Math.floor(dayOfYear / DAYS_PER_SEASON)]!
  const dayOfSeason = (dayOfYear % DAYS_PER_SEASON) + 1
  const hour = Math.floor(minuteOfDay / 60)
  const minute = minuteOfDay % 60
  const isNight = hour >= NIGHT_HOUR || hour < 6
  return { tick, year, season, dayOfSeason, dayOfYear, hour, minute, isNight }
}
