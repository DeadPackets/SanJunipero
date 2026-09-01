import { describe, expect, it } from 'vitest'
import { SimConfigSchema } from '@sj/shared'
import { fold } from '../fold.js'
import { genesisState } from '../state.js'
import { EventStore, openDb } from '../store.js'
import { replayLatest } from '../replay.js'
import { foundersKnowTheVillage, makeGenesisWorld } from './world.js'

describe('the village its founders raised', () => {
  it('gives every founder every genesis roof', () => {
    expect(foundersKnowTheVillage(['amara', 'omar'], ['s_1', 's_2'])).toEqual([
      { type: 'places_seen', payload: { agentId: 'amara', structureIds: ['s_1', 's_2'] } },
      { type: 'places_seen', payload: { agentId: 'omar', structureIds: ['s_1', 's_2'] } },
    ])
  })

  // `PlacesSeen` refuses an empty array, so an empty village must emit nothing at all.
  it('emits nothing for a village with no roofs', () => {
    expect(foundersKnowTheVillage(['amara'], [])).toEqual([])
  })

  it('folds onto a genesis world and survives a replay', () => {
    const config = SimConfigSchema.parse({})
    const genesis = makeGenesisWorld(config)
    const store = new EventStore(openDb(':memory:'))
    let s = genesisState(config, genesis.terrain)
    const emit = (type: string, payload: unknown): void => {
      s = fold(s, store.append(s.tick, type, payload), config)
    }
    for (const e of genesis.events) emit(e.type, e.payload)
    emit('agent_spawned', { id: 'amara', name: 'Amara', x: 2, y: 2, ageDays: 7300 })
    const storehouse = Object.values(s.structures).find((x) => x.kind === 'storehouse')
    if (storehouse === undefined) throw new Error('genesis: no storehouse')
    for (const e of foundersKnowTheVillage(['amara'], Object.keys(s.structures)))
      emit(e.type, e.payload)

    expect(s.agents.amara?.knownPlaces).toContain(storehouse.id)
    const replayed = replayLatest(store, config, genesis.terrain, 'g6')
    expect(replayed?.state.agents.amara?.knownPlaces).toEqual(s.agents.amara?.knownPlaces)
  })
})
