import { describe, it, expect } from 'vitest'
import {
  simTimeFromTick,
  dayPhaseFromTick,
  nextDawnTick,
  DAWN_HOUR,
  MINUTES_PER_DAY,
} from './time.js'

describe('dayPhaseFromTick', () => {
  const at = (h: number, m = 0) => dayPhaseFromTick(h * 60 + m)
  it('walks night into dawn into day into dusk and back', () => {
    expect(at(4, 59)).toBe('night')
    expect(at(5, 0)).toBe('dawn')
    expect(at(6, 59)).toBe('dawn')
    expect(at(7, 0)).toBe('day')
    expect(at(18, 59)).toBe('day')
    expect(at(19, 0)).toBe('dusk')
    expect(at(20, 59)).toBe('dusk')
    expect(at(21, 0)).toBe('night')
  })
  it('reads the clock on any day, not just the first', () => {
    expect(dayPhaseFromTick(9 * MINUTES_PER_DAY + 12 * 60)).toBe('day')
    expect(dayPhaseFromTick(9 * MINUTES_PER_DAY)).toBe('night')
  })
  // The two clocks disagree by design: isNight is the older one and every landed caller keeps it.
  it('leaves SimTime.isNight exactly as it was', () => {
    expect(simTimeFromTick(20 * 60).isNight).toBe(true)
    expect(dayPhaseFromTick(20 * 60)).toBe('dusk')
  })
})

describe('nextDawnTick', () => {
  const DAWN = DAWN_HOUR * 60
  it('is the first dawn strictly after the tick, on any day', () => {
    expect(nextDawnTick(0)).toBe(DAWN)
    expect(nextDawnTick(DAWN - 1)).toBe(DAWN)
    expect(nextDawnTick(DAWN)).toBe(MINUTES_PER_DAY + DAWN)
    expect(nextDawnTick(22 * 60)).toBe(MINUTES_PER_DAY + DAWN)
    expect(nextDawnTick(9 * MINUTES_PER_DAY + 12 * 60)).toBe(10 * MINUTES_PER_DAY + DAWN)
    expect(dayPhaseFromTick(nextDawnTick(0) - 1)).toBe('night')
    expect(dayPhaseFromTick(nextDawnTick(0))).toBe('dawn')
  })
})

describe('simTimeFromTick', () => {
  it('tick 0 is year 0, spring day 1, 00:00, night', () => {
    const t = simTimeFromTick(0)
    expect(t).toMatchObject({
      year: 0,
      season: 'spring',
      dayOfSeason: 1,
      hour: 0,
      minute: 0,
      isNight: true,
    })
  })
  it('noon of day 1', () => {
    const t = simTimeFromTick(12 * 60)
    expect(t.hour).toBe(12)
    expect(t.isNight).toBe(false)
  })
  it('day 92 is summer day 1', () => {
    const t = simTimeFromTick(91 * MINUTES_PER_DAY)
    expect(t.season).toBe('summer')
    expect(t.dayOfSeason).toBe(1)
  })
  it('day 365 is year 1 spring day 1', () => {
    const t = simTimeFromTick(364 * MINUTES_PER_DAY)
    expect(t.year).toBe(1)
    expect(t.season).toBe('spring')
    expect(t.dayOfSeason).toBe(1)
  })
  it('night spans 20:00–05:59', () => {
    expect(simTimeFromTick(20 * 60).isNight).toBe(true)
    expect(simTimeFromTick(6 * 60).isNight).toBe(false)
  })
})
