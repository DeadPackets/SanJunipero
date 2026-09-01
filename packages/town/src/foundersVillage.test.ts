import { describe, expect, it } from 'vitest'
import { TOWN_RINGS_GENESIS } from '@sj/shared'
import { SHOWCASE_CONFIG } from './devWorld.js'
import { runFoundersWorld } from './testutil.js'

// World one: 41 units of food sat in `structure_storehouse_44_13` for 12,416 ticks and the
// building appears in no founder's knownPlaces and no places_seen event in the whole run.
const STOREHOUSE = 'structure_storehouse_44_13'

// `minds: true` is the live-cast arm world one ran: no patrols, no scripted need top-ups.
const run = runFoundersWorld(
  { laws: [], holdings: true, minds: true },
  1,
  TOWN_RINGS_GENESIS,
  undefined,
  SHOWCASE_CONFIG,
)

describe('a founder knows the village they founded', () => {
  it('hands all five the whole town on tick 1, storehouse included', () => {
    const ids = Object.keys(run.state.structures).sort()
    expect(ids).toContain(STOREHOUSE)
    const founders = Object.keys(run.state.agents)
    expect(founders).toHaveLength(5)
    for (const id of founders) expect(run.state.agents[id]?.knownPlaces, id).toEqual(ids)
  })

  // A place with no name cannot be said aloud, and `earshot` only carries places it can name.
  it('carries the template name through, so the storehouse can be spoken of', () => {
    expect(run.state.structures[STOREHOUSE]?.name).toBe('the storehouse')
  })
})
