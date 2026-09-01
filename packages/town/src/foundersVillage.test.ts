import { describe, expect, it } from 'vitest'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, type TickHandler } from '@sj/engine'
import { SHOWCASE_CONFIG, devGenesisState, devTerrain } from './devWorld.js'
import { foundersFor, makeFoundersOnTick, townStructuresFor } from './founders.js'

// World one: 41 units of food sat in `structure_storehouse_44_13` for 12,416 ticks and the
// building appears in no founder's knownPlaces and no places_seen event in the whole run.
const STOREHOUSE = 'structure_storehouse_44_13'

function showcaseAtTick1(): TickLoop {
  const config = SHOWCASE_CONFIG
  const terrain = devTerrain('showcase')
  const structures = townStructuresFor('showcase')
  let handler: TickHandler | null = null
  const loop = new TickLoop({
    store: new EventStore(openDb(':memory:')),
    state: devGenesisState(config, terrain, 'showcase'),
    rng: new RngStreams('g6'),
    config,
    onTick: (ctx) => {
      handler?.(ctx)
    },
  })
  handler = makeFoundersOnTick(config, new RngStreams('g6'), () => loop.state, {
    laws: [],
    structures,
    founders: foundersFor(structures),
    holdings: true,
    // The live cast: no patrols, no top-ups — exactly the arm world one ran.
    minds: true,
  })
  loop.step()
  return loop
}

describe('a founder knows the village they founded', () => {
  it('hands all five the whole town on tick 1, storehouse included', () => {
    const loop = showcaseAtTick1()
    const ids = Object.keys(loop.state.structures).sort()
    expect(ids).toContain(STOREHOUSE)
    for (const f of foundersFor(townStructuresFor('showcase'))) {
      expect(loop.state.agents[f.id]?.knownPlaces, f.id).toEqual(ids)
    }
  })

  // A place with no name cannot be said aloud, and `earshot` only carries places it can name.
  it('carries the template name through, so the storehouse can be spoken of', () => {
    expect(showcaseAtTick1().state.structures[STOREHOUSE]?.name).toBe('the storehouse')
  })
})
