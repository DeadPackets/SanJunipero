// Fixture code shared by the town tests. Assertions live in the test files.
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, type WorldState } from '@sj/engine'
import { SHOWCASE_CONFIG, devGenesisState, devTerrain } from './devWorld.js'
import {
  type FoundersOpts,
  foundersFor,
  makeFoundersOnTick,
  townStructuresFor,
} from './founders.js'

export type Seen = { type: string; tick: number; payload: Record<string, unknown> }
export type Run = {
  state: WorldState
  events: Seen[]
  store: EventStore
  terrain: ReturnType<typeof devTerrain>
}

/**
 * The showcase founders world through a real TickLoop, as `pnpm stream` boots it minus the HTTP.
 * No policy flag is defaulted: an arm gets exactly the opts its own call site names, so an
 * ablation cannot silently gain a policy it was written to exclude.
 */
export function runFoundersWorld(
  opts: FoundersOpts,
  ticks = 4320,
  rings = 3,
  onAfterTick?: (tick: number, state: WorldState) => void,
): Run {
  const config = SHOWCASE_CONFIG
  const terrain = devTerrain('showcase', rings)
  const structures = townStructuresFor('showcase', rings)
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams('g6')
  const events: Seen[] = []
  const inner = makeFoundersOnTick(config, rng, () => loop.state, {
    structures,
    founders: foundersFor(structures),
    ...opts,
  })
  const loop: TickLoop = new TickLoop({
    store,
    state: devGenesisState(config, terrain, 'showcase', rings),
    rng,
    config,
    snapshotEveryTicks: 720,
    onTick: (ctx) => {
      inner({
        tick: ctx.tick,
        emit: (type, payload) => {
          events.push({ type, tick: ctx.tick, payload: (payload ?? {}) as Record<string, unknown> })
          ctx.emit(type, payload)
        },
      })
      onAfterTick?.(ctx.tick, loop.state)
    },
  })
  for (let t = 0; t < ticks; t++) loop.step()
  return { state: loop.state, events, store, terrain }
}
