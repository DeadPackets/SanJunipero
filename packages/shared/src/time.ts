export const TICK_REAL_MS = 2500
export const MINUTES_PER_DAY = 1440
export const DAYS_PER_SEASON = 91
export const DAYS_PER_YEAR = 364
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const
export type Season = (typeof SEASONS)[number]

export type SimTime = {
  tick: number; year: number; season: Season; dayOfSeason: number
  dayOfYear: number; hour: number; minute: number; isNight: boolean
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
  const isNight = hour >= 20 || hour < 6
  return { tick, year, season, dayOfSeason, dayOfYear, hour, minute, isNight }
}
