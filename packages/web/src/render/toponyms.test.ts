import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { genesisState, type WorldState } from '@sj/engine/state'
import { ZOOM_STOPS } from './camera.js'
import { AA_RATIO, LANDMARK_INK, LANDMARK_PLATE, bandRatios } from './legibility.js'
import { TEXT_MIN_PX } from '../textFloor.js'
import { TOPONYM_LABEL_PX, toponymAlpha, toponymsOf } from './toponyms.js'

function carved(
  id: string,
  x: number,
  y: number,
  inscription?: { text: string; by: string },
  stage: 'construction' | 'complete' = 'complete',
): WorldState['structures'][string] {
  return {
    id,
    kind: 'standing_stone',
    x,
    y,
    w: 1,
    h: 1,
    hp: 10,
    maxHp: 10,
    flammable: false,
    stage,
    progressTicks: 0,
    builtBy: null,
    burning: false,
    burnTicks: 0,
    ...(inscription === undefined ? {} : { inscription }),
  }
}

const town = (structures: WorldState['structures']): WorldState => ({
  ...genesisState(DEFAULT_CONFIG),
  structures,
})

describe('toponymsOf — the names the town cut for itself', () => {
  it('takes the carved words verbatim, and where they were cut', () => {
    const state = town({
      s1: carved('s1', 4, 9, { text: 'the drowned ford', by: 'omar' }),
    })
    expect(toponymsOf(state)).toEqual([{ id: 's1', name: 'the drowned ford', x: 4, y: 9 }])
  })

  it('names nothing unmarked, nothing blank and nothing still going up', () => {
    const state = town({
      bare: carved('bare', 0, 0),
      blank: carved('blank', 1, 1, { text: '   ', by: 'omar' }),
      rising: carved('rising', 2, 2, { text: 'the new wall', by: 'omar' }, 'construction'),
    })
    expect(toponymsOf(state)).toEqual([])
  })

  it('answers in one order, so two calls place the same names in the same slots', () => {
    const state = town({
      z: carved('z', 0, 0, { text: 'last', by: 'o' }),
      a: carved('a', 1, 1, { text: 'first', by: 'o' }),
    })
    expect(toponymsOf(state).map((t) => t.id)).toEqual(['a', 'z'])
  })

  it('has nothing to say before the first snapshot', () => {
    expect(toponymsOf(null)).toEqual([])
  })
})

describe('toponymAlpha — whole or gone, never between', () => {
  it('is gone at the overview and whole from half-size in', () => {
    expect(toponymAlpha(0.25)).toBe(0)
    expect(toponymAlpha(0.5)).toBe(1)
  })

  it('★ is 0 or 1 at every resting stop — a name at 0.5 alpha has no contrast ratio', () => {
    for (const stop of ZOOM_STOPS) expect([0, 1], `stop ${stop}`).toContain(toponymAlpha(stop))
  })
})

describe('a carved name is readable where it is cut', () => {
  it('never renders below the chrome type floor', () => {
    expect(TOPONYM_LABEL_PX).toBeGreaterThanOrEqual(TEXT_MIN_PX)
  })

  it('clears AA against its own halo in both halves of the day', () => {
    const r = bandRatios(LANDMARK_PLATE, LANDMARK_INK)
    expect(r.day).toBeGreaterThanOrEqual(AA_RATIO)
    expect(r.night).toBeGreaterThanOrEqual(AA_RATIO)
  })
})
