import { describe, expect, it } from 'vitest'
import { DAYS_PER_SEASON, MINUTES_PER_DAY } from '@sj/shared'
import { tickBadgeState } from '../ui/broadcastReady.js'
import { STAMP_HOLD_MS, stampText, stampWord } from './QuietStamp.js'

const DAY_12 = 12 * MINUTES_PER_DAY + 9 * 60 + 40

describe('the stamp says the day, the season, the time and where the picture came from', () => {
  it('reads DAY n · SEASON · HH:MM · LIVE', () => {
    expect(stampText(DAY_12, 'LIVE')).toBe('DAY 12 · SPRING · 09:40 · LIVE')
  })

  it('pads the clock, so the corner never jitters between 9:40 and 10:40', () => {
    expect(stampText(0, 'LIVE')).toBe('DAY 0 · SPRING · 00:00 · LIVE')
    expect(stampText(23 * 60 + 5, 'LIVE')).toContain('23:05')
  })

  it('turns the season over with the year', () => {
    expect(stampText(DAYS_PER_SEASON * MINUTES_PER_DAY, 'LIVE')).toContain('SUMMER')
    expect(stampText((DAYS_PER_SEASON - 1) * MINUTES_PER_DAY, 'LIVE')).toContain('SPRING')
  })
})

describe('a clock nobody can know is stale says so instead', () => {
  it('is LIVE only when the town is awake and at its edge', () => {
    expect(stampWord(true, true, 'online')).toBe('LIVE')
    expect(stampWord(true, true)).toBe('LIVE')
  })

  it('is REPLAY while a past moment is being watched', () => {
    expect(stampWord(false, true, 'online')).toBe('REPLAY')
  })

  it('is OFFLINE with the socket down or the town not yet woken', () => {
    expect(stampWord(true, true, 'reconnecting')).toBe('OFFLINE')
    expect(stampWord(true, true, 'connecting')).toBe('OFFLINE')
    expect(stampWord(true, false, 'online')).toBe('OFFLINE')
    expect(stampWord(false, false)).toBe('OFFLINE')
  })

  it('is R8’s own badge state, said in three words rather than four', () => {
    expect(stampWord(true, true, 'online')).toBe(
      { live: 'LIVE', past: 'REPLAY', stale: 'OFFLINE', waking: 'OFFLINE' }[
        tickBadgeState('online', true, true)
      ],
    )
  })

  it('holds for three seconds after the last input', () => {
    expect(STAMP_HOLD_MS).toBe(3000)
  })
})
