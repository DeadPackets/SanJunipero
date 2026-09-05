import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WAKE_HOUR, simTimeFromTick, MINUTES_PER_DAY } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import { createWorldStore, type WorldStore } from '../state/worldStore.js'
import { SLEEP_COPY, SleepCard, wakeTime } from './SleepCard.js'

const SRC = readFileSync(new URL('./SleepCard.tsx', import.meta.url), 'utf8')
const TIME = readFileSync(new URL('../../../shared/src/time.ts', import.meta.url), 'utf8')

const body = (alive: boolean, asleep: boolean) => ({ alive, asleep })
const townOf = (agents: Record<string, { alive: boolean; asleep: boolean }>): WorldStore => ({
  ...createWorldStore(),
  getState: () => ({ tick: 3 * 60, agents }) as unknown as WorldState,
})
const html = (store: WorldStore): string =>
  renderToStaticMarkup(createElement(SleepCard, { store }))

describe('★ the one honest empty frame', () => {
  it('★ stands only when every living body is asleep', () => {
    expect(html(townOf({ a: body(true, true), b: body(true, true) }))).toContain(SLEEP_COPY.head)
  })

  it('★ is gone the moment anybody is up — one mind at 03:00 is a town worth watching', () => {
    expect(html(townOf({ a: body(true, true), b: body(true, false) }))).toBe('')
  })

  it('★ never stands over a town with nobody in it', () => {
    expect(html(townOf({}))).toBe('')
    expect(html(townOf({ a: body(false, false) }))).toBe('')
  })

  it('★ says when the wait ends, and reads that hour off the world’s own clock', () => {
    expect(wakeTime()).toBe('06:00')
    expect(SLEEP_COPY.head).toBe('The town sleeps until 06:00.')
    expect(SLEEP_COPY.note).toBe('It wakes with the light; the camera waits with it.')
    // ...the same hour `isNight` turns back over on, so the card and the light cannot disagree
    expect(WAKE_HOUR).toBe(6)
    expect(TIME).toContain('hour >= NIGHT_HOUR || hour < WAKE_HOUR')
    expect(simTimeFromTick(WAKE_HOUR * 60).isNight).toBe(false)
    expect(simTimeFromTick(WAKE_HOUR * 60 - 1).isNight).toBe(true)
    expect(simTimeFromTick(MINUTES_PER_DAY + WAKE_HOUR * 60).isNight).toBe(false)
  })

  it('★ asks the town, never the clock: it is a fact about bodies, not about the hour', () => {
    expect(SRC).toContain('townAsleep(store.getState()?.agents)')
    // nothing in it reads the clock: an hour is not a reason to stop showing the town
    expect(SRC).not.toMatch(/simTimeFromTick|dayPhaseFromTick|getTick/)
  })
})
