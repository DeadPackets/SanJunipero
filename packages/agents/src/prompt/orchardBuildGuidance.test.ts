import { describe, expect, it } from 'vitest'
import {
  findPath,
  fold,
  genesisState,
  groundForBuilding,
  makeables,
  submitIntent,
  type TileId,
} from '@sj/engine'
import { DEFAULT_CONFIG, TOWN_SQUARE, T_ROAD, type SimConfig } from '@sj/shared'
import { makeablesLine } from './prose.js'

const config: SimConfig = {
  ...DEFAULT_CONFIG,
  world: { ...DEFAULT_CONFIG.world, layout: 'orchard' },
  construction: { ...DEFAULT_CONFIG.construction, plotOpensEveryTicks: 0 },
}

function orchard() {
  const terrain = Array.from({ length: 128 }, () => Array<TileId>(128).fill(0))
  terrain[TOWN_SQUARE.y]![TOWN_SQUARE.x] = T_ROAD
  return genesisState(config, terrain)
}

describe('Orchard building guidance', () => {
  it('omits a universal work coordinate before the building kind is known', () => {
    const line = makeablesLine(makeables(config), groundForBuilding(orchard()))
    expect(line).toContain('a house')
    expect(line).not.toContain('ground for a new building at')
    expect(line).not.toContain('You have to be standing there')
  })

  it.each(['house', 'cottage', 'farmhouse'])(
    'gives a reachable door in the %s refusal and accepts building from there',
    (kind) => {
      let state = fold(orchard(), {
        seq: 1,
        tick: 0,
        type: 'agent_spawned',
        payload: { id: 'builder', name: 'Builder', ...TOWN_SQUARE, ageDays: 10000 },
      })
      state = fold(state, {
        seq: 2,
        tick: 0,
        type: 'item_spawned',
        payload: { id: 'wood', kind: 'wood', qty: 100, loc: { t: 'agent', id: 'builder' } },
      })
      const refused = submitIntent(state, config, 'builder', 'build', { kind })
      expect(refused.ok).toBe(false)
      if (refused.ok) throw new Error('Expected the building to need a walk')
      const coordinate = /go and stand at \((\d+), (\d+)\)/.exec(refused.reason)
      expect(coordinate).not.toBeNull()
      const door = { x: Number(coordinate![1]), y: Number(coordinate![2]) }
      expect(findPath(state, TOWN_SQUARE, door)).not.toBeNull()
      state = {
        ...state,
        agents: { ...state.agents, builder: { ...state.agents.builder!, ...door } },
      }
      const accepted = submitIntent(state, config, 'builder', 'build', { kind })
      expect(accepted.ok, accepted.ok ? '' : accepted.reason).toBe(true)
    },
  )
})
