import { describe, expect, it } from 'vitest'
import type { SimEvent } from '@sj/shared'
import { AFTERMATH_HOLD_TICKS, GRAVE_HOLD_TICKS, isGrave, toneReducer } from './tone.js'

const ev = (type: string, tick: number): SimEvent => ({
  seq: 1,
  tick,
  type,
  payload: { agentId: 'a' },
})

describe('toneReducer', () => {
  it('a death at tick 100 stills the town until 160', () => {
    expect(GRAVE_HOLD_TICKS).toBe(60)
    expect(toneReducer({ graveUntil: 0 }, [ev('agent_died', 100)], 100)).toEqual({
      graveUntil: 160,
    })
  })
  it('overlapping deaths extend to the max, never shorten', () => {
    expect(toneReducer({ graveUntil: 190 }, [ev('agent_died', 100)], 100)).toEqual({
      graveUntil: 190,
    })
    expect(toneReducer({ graveUntil: 120 }, [ev('agent_died', 100)], 100)).toEqual({
      graveUntil: 160,
    })
  })
  it('injury alone holds a shorter beat', () => {
    expect(AFTERMATH_HOLD_TICKS).toBe(15)
    expect(toneReducer({ graveUntil: 0 }, [ev('agent_injured', 100)], 100)).toEqual({
      graveUntil: 115,
    })
  })
  it('no grave events → unchanged', () => {
    expect(
      toneReducer({ graveUntil: 42 }, [ev('agent_moved', 100), ev('tick_advanced', 100)], 100),
    ).toEqual({ graveUntil: 42 })
  })
})

describe('isGrave', () => {
  it('boundary exact: 159 grave, 160 not', () => {
    expect(isGrave({ graveUntil: 160 }, 159)).toBe(true)
    expect(isGrave({ graveUntil: 160 }, 160)).toBe(false)
  })
})
