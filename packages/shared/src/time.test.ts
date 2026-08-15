import { describe, it, expect } from 'vitest'
import { simTimeFromTick, MINUTES_PER_DAY } from './time.js'

describe('simTimeFromTick', () => {
  it('tick 0 is year 0, spring day 1, 00:00, night', () => {
    const t = simTimeFromTick(0)
    expect(t).toMatchObject({ year: 0, season: 'spring', dayOfSeason: 1, hour: 0, minute: 0, isNight: true })
  })
  it('noon of day 1', () => {
    const t = simTimeFromTick(12 * 60)
    expect(t.hour).toBe(12); expect(t.isNight).toBe(false)
  })
  it('day 92 is summer day 1', () => {
    const t = simTimeFromTick(91 * MINUTES_PER_DAY)
    expect(t.season).toBe('summer'); expect(t.dayOfSeason).toBe(1)
  })
  it('day 365 is year 1 spring day 1', () => {
    const t = simTimeFromTick(364 * MINUTES_PER_DAY)
    expect(t.year).toBe(1); expect(t.season).toBe('spring'); expect(t.dayOfSeason).toBe(1)
  })
  it('night spans 20:00–05:59', () => {
    expect(simTimeFromTick(20 * 60).isNight).toBe(true)
    expect(simTimeFromTick(6 * 60).isNight).toBe(false)
  })
})
