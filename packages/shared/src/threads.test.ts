import { describe, expect, it } from 'vitest'
import { PEAK_SCORE, SCENE_STAKES_X, STAKE_TERMS, STAKES_BY_KIND } from './stakes.js'
import {
  decayedHeat,
  decayedScreen,
  THREAD_FLOOR,
  THREAD_HALF_LIFE_TICKS,
  THREAD_RANK_COEF,
  VALENCE,
} from './threads.js'
import { MINUTES_PER_DAY } from './time.js'

describe('VALENCE', () => {
  it('★ names every stake term once and nothing that is not one', () => {
    expect(Object.keys(VALENCE).sort()).toEqual([...STAKE_TERMS].sort())
    for (const term of STAKE_TERMS) expect([-1, 0, 1], term).toContain(VALENCE[term])
  })

  it('is ten warm, ten cold and four that are neither', () => {
    const count = (sign: number): number => STAKE_TERMS.filter((t) => VALENCE[t] === sign).length
    expect([count(1), count(-1), count(0)]).toEqual([10, 10, 4])
  })

  // A flipped sign reads as a marriage where the town had a parting, and exhaustiveness alone
  // would not catch it.
  it('★ reads the terms a viewer would argue about', () => {
    expect(VALENCE.partnership_formed).toBe(1)
    expect(VALENCE.partnership_dissolved).toBe(-1)
    expect(VALENCE.give_way).toBe(1)
    expect(VALENCE.invitation_refused_seen).toBe(-1)
    expect(VALENCE.agent_born).toBe(1)
    expect(VALENCE.agent_died).toBe(-1)
    expect(VALENCE.talk).toBe(0)
    expect(VALENCE.council).toBe(0)
  })
})

describe('thread heat', () => {
  it('halves over four sim-days', () => {
    expect(THREAD_HALF_LIFE_TICKS).toBe(4 * MINUTES_PER_DAY)
    expect(decayedHeat(12, 0)).toBe(12)
    expect(decayedHeat(12, THREAD_HALF_LIFE_TICKS)).toBeCloseTo(6, 10)
    expect(decayedHeat(12, 2 * THREAD_HALF_LIFE_TICKS)).toBeCloseTo(3, 10)
  })

  it('leaves a six day old grudge at about a third of its peak', () => {
    expect(decayedHeat(1, 6 * MINUTES_PER_DAY)).toBeCloseTo(0.354, 3)
  })

  it('never reads a tick backwards as growth', () => {
    expect(decayedHeat(9, -MINUTES_PER_DAY)).toBe(9)
  })

  it('★ a payment as light as an attraction is still above the floor a sim day later', () => {
    // The floor is what tells a story nobody touched today from one with nothing left to show.
    expect(decayedHeat(4, MINUTES_PER_DAY)).toBeGreaterThan(THREAD_FLOOR)
  })
})

describe('screen time', () => {
  it('halves over one sim-day, four times faster than a grudge', () => {
    expect(decayedScreen(80, MINUTES_PER_DAY)).toBeCloseTo(40, 10)
    expect(decayedScreen(80, THREAD_HALF_LIFE_TICKS)).toBeCloseTo(5, 10)
  })
})

describe('the story term of the ranking', () => {
  it('★ leaves the hottest story between an idle talk and a live quarrel', () => {
    // The ordering the whole design turns on, in the town's own weights: a talk scene scores
    // STAKES_BY_KIND.talk * SCENE_STAKES_X and a quarrel scores the same for a quarrel. The
    // units changed in round two, so the old 0.35 is not a value this band would have accepted.
    const story = THREAD_RANK_COEF * PEAK_SCORE
    expect(story).toBeGreaterThan(STAKES_BY_KIND.talk * SCENE_STAKES_X)
    expect(story).toBeLessThan(STAKES_BY_KIND.quarrel * SCENE_STAKES_X)
  })
})
