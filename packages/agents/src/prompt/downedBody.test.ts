import { describe, expect, it } from 'vitest'
import { EventStore, openDb } from '@sj/engine/store'
import { fold, genesisState, type TileId } from '@sj/engine'
import { DEFAULT_CONFIG } from '@sj/shared'
import { perceptionToProse } from './prose.js'
import { wireTown } from '../testutil/fixtures.js'
import { FLAT_WORLD } from '../testutil/fixtures.js'

// Two bodies on adjacent tiles, so whatever befalls the second is inside the first one's eyes.
const WATCHER = 'tamar'
const OTHER = 'amara'

function pair(): { prose: () => string; state: () => ReturnType<typeof genesisState> } {
  const terrain: TileId[][] = Array.from({ length: 16 }, () =>
    Array.from({ length: 16 }, (): TileId => 0),
  )
  const store = new EventStore(openDb(':memory:'))
  let seed = genesisState(DEFAULT_CONFIG, terrain)
  const put = (type: string, payload: unknown): void => {
    seed = fold(seed, store.append(seed.tick, type, payload), DEFAULT_CONFIG)
  }
  put('agent_spawned', { id: WATCHER, name: 'Tamar', x: 8, y: 8, ageDays: 7300 })
  put('agent_spawned', { id: OTHER, name: 'Amara', x: 9, y: 8, ageDays: 7300 })
  // Noon, so the other body is inside the sight horizon.
  const { bridge, loop } = wireTown({ state: seed, store, seed: 'downed', startTick: 720 })
  return {
    prose: () => perceptionToProse(bridge.perception(WATCHER), undefined, FLAT_WORLD),
    state: () => loop.state,
  }
}

describe('a body that has gone down is seen to have gone down', () => {
  it('on its feet it stands', () => {
    expect(pair().prose()).toContain('Amara (amara) stands at (9, 8)')
  })

  it('merely asleep it sleeps', () => {
    const t = pair()
    t.state().agents[OTHER]!.asleep = true
    const said = t.prose()
    expect(said).toContain('Amara (amara) sleeps at (9, 8)')
    expect(said).not.toContain('lies collapsed')
  })

  it('collapsed while awake it lies collapsed', () => {
    const t = pair()
    t.state().agents[OTHER]!.collapsedSinceTick = 700
    expect(t.prose()).toContain('Amara (amara) lies collapsed at (9, 8)')
  })

  // Hunger keeps falling through the night, so `collapseDeathSystem` fires on a sleeping body and
  // leaves both flags standing. Sleep-first read that as rest: two founders went down on one tile
  // in world one and neither mind was ever told the other was down.
  it('collapsed in its sleep it still lies collapsed, not merely sleeps', () => {
    const t = pair()
    t.state().agents[OTHER]!.asleep = true
    t.state().agents[OTHER]!.collapsedSinceTick = 700
    const said = t.prose()
    expect(said).toContain('Amara (amara) lies collapsed at (9, 8)')
    expect(said).not.toContain('sleeps at')
  })
})
