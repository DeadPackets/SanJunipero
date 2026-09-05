import { describe, expect, it } from 'vitest'
import { ADULT_AGE_DAYS, DEFAULT_CONFIG, MINUTES_PER_DAY } from '@sj/shared'
import { fold } from './fold.js'
import { composePerception, STRANGER_DAYS } from './perception.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { ev } from './testutil/world.js'

const NOON = 720

function world(): WorldState {
  let s = genesisState(
    DEFAULT_CONFIG,
    Array.from({ length: 64 }, () => Array.from({ length: 64 }, (): TileId => 0)),
  )
  s = fold(
    s,
    ev('agent_spawned', { id: 'a1', name: 'Amara', x: 10, y: 10, ageDays: ADULT_AGE_DAYS }),
    DEFAULT_CONFIG,
  )
  s = fold(
    s,
    ev('agent_spawned', { id: 'a2', name: 'Yusuf', x: 40, y: 40, ageDays: ADULT_AGE_DAYS }),
    DEFAULT_CONFIG,
  )
  return { ...s, tick: NOON }
}

const atDay = (s: WorldState, day: number): WorldState => ({
  ...s,
  tick: day * MINUTES_PER_DAY + NOON,
})

describe('★ a face the valley has only just seen', () => {
  const arrived = (): WorldState =>
    fold(
      world(),
      ev('agent_arrived', { id: 'mira', name: 'Mira', sex: 'f', ageDays: 868, x: 11, y: 10 }, NOON),
      DEFAULT_CONFIG,
    )

  it('reads as a stranger for three days, and as one of the town on the fourth', () => {
    const s = arrived()
    for (const day of [0, 1, STRANGER_DAYS]) {
      const p = composePerception(atDay(s, day), DEFAULT_CONFIG, 'a1', [])
      expect(p.visible.agents.find((g) => g.id === 'mira')?.stranger, `day ${day}`).toBe(true)
    }
    const later = composePerception(atDay(s, STRANGER_DAYS + 1), DEFAULT_CONFIG, 'a1', [])
    expect(later.visible.agents.find((g) => g.id === 'mira')?.stranger).toBeUndefined()
  })

  it('never says it of somebody born here', () => {
    const p = composePerception(arrived(), DEFAULT_CONFIG, 'mira', [])
    expect(p.visible.agents.find((g) => g.id === 'a1')?.stranger).toBeUndefined()
  })
})

describe('★ watching somebody come up the road', () => {
  const coming = ev(
    'agent_arrived',
    { id: 'mira', name: 'Mira', sex: 'f', ageDays: 868, x: 11, y: 10 },
    NOON,
  )

  it('reaches whoever had that stretch of the edge in sight, and nobody else', () => {
    const s = fold(world(), coming, DEFAULT_CONFIG)
    const near = composePerception(s, DEFAULT_CONFIG, 'a1', [coming])
    expect(near.seen).toContainEqual({ kind: 'stranger_arrived', name: 'Mira' })
    const far = composePerception(s, DEFAULT_CONFIG, 'a2', [coming])
    expect(far.seen).toEqual([])
  })

  it('is not told to the one who walked in', () => {
    const s = fold(world(), coming, DEFAULT_CONFIG)
    expect(composePerception(s, DEFAULT_CONFIG, 'mira', [coming]).seen).toEqual([])
  })
})
