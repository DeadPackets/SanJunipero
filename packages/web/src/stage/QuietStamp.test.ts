import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DAYS_PER_SEASON, MINUTES_PER_DAY } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import { tickBadgeState, type LinkState } from '../ui/broadcastReady.js'
import { createWorldStore, type WorldStore } from '../state/worldStore.js'
import { QuietStamp, STAMP_HOLD_MS, stampText, stampWord } from './QuietStamp.js'

const DAY_12 = 12 * MINUTES_PER_DAY + 9 * 60 + 40

describe('the stamp says the day, the season, the time and where the picture came from', () => {
  it('reads DAY n · SEASON · HH:MM · LIVE', () => {
    expect(stampText(DAY_12, 'LIVE')).toBe('DAY 12 · SUMMER · 09:40 · LIVE')
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
  })

  it('is REPLAY while a past moment is being watched', () => {
    expect(stampWord(false, true, 'online')).toBe('REPLAY')
  })

  it('is OFFLINE with the socket down or the town not yet woken', () => {
    expect(stampWord(true, true, 'reconnecting')).toBe('OFFLINE')
    expect(stampWord(true, true, 'connecting')).toBe('OFFLINE')
    expect(stampWord(true, false, 'online')).toBe('OFFLINE')
    expect(stampWord(false, false, 'online')).toBe('OFFLINE')
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

// The word the viewer reads is the one the PROP carries, not the one a unit test hands the pure
// function: the stamp said LIVE over frozen figures for as long as `link` went unpassed.
describe('★ the word the corner actually renders', () => {
  const awakeStore = (): WorldStore => ({
    ...createWorldStore(),
    getState: () => ({ tick: 0 }) as unknown as WorldState,
  })
  const corner = (link: LinkState): string =>
    renderToStaticMarkup(createElement(QuietStamp, { store: awakeStore(), link }))

  it('says OFFLINE while the socket is down and LIVE only while it is up', () => {
    expect(corner('online')).toContain('LIVE')
    expect(corner('reconnecting')).toContain('OFFLINE')
    expect(corner('connecting')).toContain('OFFLINE')
  })

  // `link` being required makes the compiler insist the app pass SOMETHING; only this says the
  // something is the socket's own status rather than a constant.
  it('is handed the socket’s status by the app', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    expect(app).toContain('onStatus: setLink')
    expect(app).toMatch(/<QuietStamp[^>]*link=\{link\}/)
  })
})
