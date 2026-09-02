import { describe, expect, it } from 'vitest'
import { EventStore, openDb } from '@sj/engine/store'
import {
  RngStreams,
  TickLoop,
  fold,
  foundersKnowTheVillage,
  genesisState,
  makeGenesisWorld,
} from '@sj/engine'
import { ADULT_AGE_DAYS, SimConfigSchema } from '@sj/shared'
import { placesKnownLine } from '../prompt/prose.js'
import { EngineBridge } from './bridge.js'

// World one lost five founders to 41 units of food in a storehouse nobody ever walked past.
// They raised it; the prompt has to say so on the first turn, from wherever they are standing.
const FOUNDER = 'amara'
const NEWBORN = 'child'

function village(): { bridge: EngineBridge; storehouseId: string } {
  const config = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    mystery: { chancePerDay: 0 },
  })
  const genesis = makeGenesisWorld(config)
  const store = new EventStore(openDb(':memory:'))
  let state = genesisState(config, genesis.terrain)
  const emit = (type: string, payload: unknown): void => {
    state = fold(state, store.append(state.tick, type, payload), config)
  }
  for (const e of genesis.events) emit(e.type, e.payload)

  const storehouse = Object.values(state.structures).find((s) => s.kind === 'storehouse')
  if (storehouse === undefined) throw new Error('genesis: no storehouse')
  // Both bodies stand far enough off that nothing below can be explained by eyesight.
  const far = { x: storehouse.x + 40, y: storehouse.y + 40 }
  for (const id of [FOUNDER, NEWBORN])
    emit('agent_spawned', { id, name: id, x: far.x, y: far.y, ageDays: ADULT_AGE_DAYS })
  for (const e of foundersKnowTheVillage([FOUNDER], Object.keys(state.structures)))
    emit(e.type, e.payload)
  // Noon: the sight horizon shrinks with the light, and none of this is about eyesight.
  state = { ...state, tick: 720 }

  // Nothing steps this loop: the bridge is the only thing under test, and it reads state.
  const loop = new TickLoop({
    store,
    state,
    rng: new RngStreams('village-seam'),
    config,
    onTick: () => {},
  })
  return {
    bridge: new EngineBridge({ loop, store, simConfig: config }),
    storehouseId: storehouse.id,
  }
}

describe('★ the village a founder is born knowing', () => {
  it('names the storehouse to a founder who has been shown nothing', () => {
    const { bridge, storehouseId } = village()
    const packet = bridge.perception(FOUNDER)
    expect(packet.visible.structures).toEqual([])

    expect(bridge.knownPlaces(FOUNDER).map((p) => p.id)).toContain(storehouseId)
    const block = placesKnownLine(bridge.knownPlaces(FOUNDER), packet)
    expect(block.split('\n')[0]).toBe('Places you know:')
    expect(block.split('\n')).toContainEqual(
      expect.stringContaining(`the storehouse (${storehouseId})`),
    )
  })

  it('tells a newborn nothing: arrivals still learn by sight and by word of mouth', () => {
    const { bridge, storehouseId } = village()
    expect(bridge.knownPlaces(NEWBORN).map((p) => p.id)).not.toContain(storehouseId)
  })
})
