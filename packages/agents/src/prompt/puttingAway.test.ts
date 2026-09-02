import { describe, expect, it } from 'vitest'
import { EventStore, openDb } from '@sj/engine/store'
import { fold, genesisState, type TileId, type WorldState } from '@sj/engine'
import { ADULT_AGE_DAYS, DEFAULT_CONFIG } from '@sj/shared'
import { perceptionToProse } from './prose.js'
import { wireTown } from '../testutil/fixtures.js'
import type { EngineBridge } from '../runtime/bridge.js'

// Owner, 2026-09-02: "agents just end up leaving things in front of their houses (they don't
// even take them inside)". What a mind is told about its shelves, and about its own doorstep.

const AGENT = 'tamar'
const HOUSE = 'structure_house'
const STORE = 'structure_store'
const OTHER = 'structure_other'

type Shelved = { id: string; kind: string; qty: number; into: string }

function town(shelved: Shelved[] = []): EngineBridge {
  const config = DEFAULT_CONFIG
  const terrain: TileId[][] = Array.from({ length: 32 }, () =>
    Array.from({ length: 32 }, (): TileId => 0),
  )
  const store = new EventStore(openDb(':memory:'))
  let state: WorldState = genesisState(config, terrain)
  const put = (type: string, payload: unknown): void => {
    state = fold(state, store.append(state.tick, type, payload), config)
  }
  const raise = (id: string, kind: string, x: number, owner: string): void => {
    put('structure_planned', {
      id,
      kind,
      x,
      y: 2,
      w: 2,
      h: 2,
      maxHp: 50,
      flammable: true,
      builderId: AGENT,
      ...(owner === '' ? {} : { owner }),
    })
    put('structure_completed', { id })
  }
  put('agent_spawned', { id: AGENT, name: 'Tamar', x: 16, y: 16, ageDays: ADULT_AGE_DAYS })
  put('agent_spawned', { id: 'omar', name: 'Omar', x: 26, y: 16, ageDays: ADULT_AGE_DAYS })
  raise(HOUSE, 'house', 2, AGENT)
  raise(STORE, 'storehouse', 12, '')
  raise(OTHER, 'house', 22, 'omar')
  for (const s of shelved) {
    put('item_spawned', {
      id: s.id,
      kind: s.kind,
      qty: s.qty,
      loc: { t: 'structure', id: s.into },
      owner: AGENT,
    })
  }
  const { bridge } = wireTown({ state, store, seed: 'put-away', startTick: 720 })
  return bridge
}

const proseFor = (bridge: EngineBridge): string =>
  perceptionToProse(bridge.perception(AGENT), undefined, {
    isWalkable: (x, y) => bridge.isWalkable(x, y),
    isEdible: (kind) => bridge.isEdible(kind),
  })

describe('the shelves a mind knows it has', () => {
  it('says its own roof first, the town store after, and never a neighbour’s house', () => {
    const said = proseFor(
      town([
        { id: 'item_1', kind: 'plank', qty: 3, into: HOUSE },
        { id: 'item_2', kind: 'bread', qty: 2, into: HOUSE },
        { id: 'item_3', kind: 'wood', qty: 60, into: STORE },
        { id: 'item_4', kind: 'fish', qty: 1, into: OTHER },
      ]),
    )
    expect(said).toContain('Your house holds plank ×3, bread ×2.')
    expect(said).toContain('The storehouse holds wood ×60.')
    expect(said).not.toContain('fish')
  })

  it('says nothing about a shelf standing empty', () => {
    expect(proseFor(town())).not.toContain('holds')
  })

  it('folds the tail of a long shelf into a count of kinds', () => {
    const kinds = [
      'wood',
      'plank',
      'stone',
      'clay',
      'reed',
      'bread',
      'fish',
      'berries',
      'herb',
      'wheat',
      'hide',
      'cloth',
      'rope',
      'bucket',
      'torch',
    ]
    const said = proseFor(
      town(kinds.map((k, i) => ({ id: `item_${i}`, kind: k, qty: 15 - i, into: STORE }))),
    )
    const line = said.split(/(?<=\.)\s+/).find((s) => s.startsWith('The storehouse holds'))!
    expect(line).toContain('wood ×15')
    expect(line).toMatch(/and \d other kinds\.$/)
    expect(line.length / 3.3).toBeLessThanOrEqual(40)
  })
})
