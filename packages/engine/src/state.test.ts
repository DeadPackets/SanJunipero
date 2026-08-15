import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { genesisState, mintId, type TileId } from './state.js'

describe('genesisState', () => {
  it('produces the exact v2 genesis shape and defaults', () => {
    const s = genesisState(DEFAULT_CONFIG)
    expect(s).toEqual({
      tick: 0,
      terrain: Array.from({ length: 32 }, () => Array.from({ length: 32 }, () => 0)),
      weather: { kind: 'sunny', temperatureC: DEFAULT_CONFIG.weather.seasonTemps.spring },
      agents: {},
      structures: {},
      items: {},
      crops: {},
      wildlife: { fish: DEFAULT_CONFIG.wildlife.fishMax, deer: DEFAULT_CONFIG.wildlife.deerMax },
      counters: { nextEntityId: 1 },
    })
    expect(s.terrain).toHaveLength(32)
    expect(s.terrain.every(row => row.length === 32 && row.every(t => t === 0))).toBe(true)
    expect(s.wildlife).toEqual({ fish: 100, deer: 20 })
    expect(s.weather.temperatureC).toBe(14)
  })
  it('uses a provided terrain grid as-is', () => {
    const terrain: TileId[][] = [[2, 3], [0, 4]]
    const s = genesisState(DEFAULT_CONFIG, terrain)
    expect(s.terrain).toBe(terrain)
  })
})

describe('mintId', () => {
  it('formats as prefix_nextEntityId and does not mutate state', () => {
    const s = genesisState(DEFAULT_CONFIG)
    expect(mintId(s, 'agent')).toBe('agent_1')
    expect(s.counters.nextEntityId).toBe(1)
    const s2 = { ...s, counters: { nextEntityId: 42 } }
    expect(mintId(s2, 'item')).toBe('item_42')
  })
})
