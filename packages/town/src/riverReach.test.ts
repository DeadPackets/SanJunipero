import { describe, expect, it } from 'vitest'
import { isWet, SimConfigSchema, type SimConfig } from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import {
  fold,
  isPassable,
  naturalPlaces,
  walkDestination,
  type WorldState,
} from '@sj/engine'
import { devGenesisState, devTerrain } from './devWorld.js'

// The map rehearsal 5 ran on: ring 1 of the showcase grammar, whose window crops the channel to
// array rows 8..67 and leaves dry corners north and south of it.
const config: SimConfig = SimConfigSchema.parse({})
const genesis = devGenesisState(config, devTerrain('showcase', 1), 'showcase', 1) as WorldState

const AGENT = 'p'

function bodyAt(x: number, y: number): WorldState {
  const store = new EventStore(openDb(':memory:'))
  return fold(
    genesis,
    store.append(genesis.tick, 'agent_spawned', { id: AGENT, name: 'P', x, y, ageDays: 7300 }),
    config,
  )
}

const touchesWater = (state: WorldState, p: { x: number; y: number }): boolean => {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = state.terrain[p.y + dy]?.[p.x + dx]
      if (t !== undefined && isWet(t)) return true
    }
  }
  return false
}

// The southwest corner three minds camped in, the last column world A parked Nadia against, and
// two rows that do hold water, so a fix that only helped the dead zone would still be caught.
const FROM: readonly (readonly [number, number])[] = [
  [1, 70],
  [0, 75],
  [2, 62],
  [40, 74],
  [70, 5],
  [75, 44],
  [75, 8],
  [2, 65],
]

describe('★ the river a ring-1 body can actually get to', () => {
  it('★ lands every body on ground at the water, from the dead corners too', () => {
    for (const [x, y] of FROM) {
      const state = bodyAt(x, y)
      expect(naturalPlaces(state, x, y).map((p) => p.id)).toContain('river')
      const to = walkDestination(state, config, AGENT, { structureId: 'river' })
      expect(to, `from (${x}, ${y})`).not.toHaveProperty('refusal')
      const bank = to as { x: number; y: number }
      expect(isPassable(state, bank.x, bank.y), `bank for (${x}, ${y})`).toBe(true)
      expect(touchesWater(state, bank), `water at the bank for (${x}, ${y})`).toBe(true)
    }
  })

  it('picks the nearer bank when the body stands on one side of the channel', () => {
    const west = bodyAt(2, 40)
    const east = bodyAt(75, 40)
    expect((walkDestination(west, config, AGENT, { structureId: 'river' }) as { x: number }).x)
      .toBeLessThan(13)
    expect((walkDestination(east, config, AGENT, { structureId: 'river' }) as { x: number }).x)
      .toBeGreaterThan(15)
  })
})
