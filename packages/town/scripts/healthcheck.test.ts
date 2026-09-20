import { describe, expect, it } from 'vitest'
import { nextProgress } from './healthcheck.js'

describe('container health follows the town clock', () => {
  it('records the first tick and advances its deadline only when the tick changes', () => {
    const first = nextProgress(null, 20, 1_000)
    expect(nextProgress(first, 20, 10_000)).toEqual(first)
    expect(nextProgress(first, 21, 10_000)).toEqual({ tick: 21, advancedAt: 10_000 })
  })

  it('refuses a town that answers HTTP but stays on the same tick for 15 minutes', () => {
    const previous = { tick: 20, advancedAt: 1_000 }
    expect(() => nextProgress(previous, 20, 900_999)).not.toThrow()
    expect(() => nextProgress(previous, 20, 901_000)).toThrow('has not advanced')
  })

  it('recovers after a new world or a backwards wall-clock correction', () => {
    const previous = { tick: 20, advancedAt: 10_000 }
    expect(nextProgress(previous, 1, 1_000_000)).toEqual({ tick: 1, advancedAt: 1_000_000 })
    expect(nextProgress(previous, 20, 1_000)).toEqual({ tick: 20, advancedAt: 1_000 })
  })

  it.each([undefined, null, -1, 1.5, Number.NaN, '20'])(
    'refuses an invalid clock value: %s',
    (tick) => {
      expect(() => nextProgress(null, tick as number, 1_000)).toThrow('Invalid town tick')
    },
  )
})
