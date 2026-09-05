import { describe, expect, it } from 'vitest'
import { EventStore, openDb } from '@sj/engine/store'
import {
  fold,
  genesisState,
  RngStreams,
  TickLoop,
  type TickHandler,
  type TileId,
  type WorldState,
} from '@sj/engine'
import { MINUTES_PER_DAY, POPULATION_MAX_DEFAULT, SimConfigSchema } from '@sj/shared'
import { EngineBridge } from './bridge.js'

const DAY = MINUTES_PER_DAY
type Put = (tick: number, type: string, payload: unknown) => void

/** A whole log, written before the loop opens over it: the bridge reads the world the loop
 *  holds, so a fold after that is a fold into nothing. */
function road(build: (put: Put) => void = () => {}): EngineBridge {
  const config = SimConfigSchema.parse({})
  const terrain: TileId[][] = Array.from({ length: 12 }, () =>
    Array.from({ length: 12 }, (): TileId => 0),
  )
  const store = new EventStore(openDb(':memory:'))
  let state: WorldState = genesisState(config, terrain)
  const put: Put = (tick, type, payload) => {
    state = fold(state, store.append(tick, type, payload), config)
  }
  for (const [i, id] of ['amara', 'yusuf', 'nadia'].entries()) {
    put(0, 'agent_spawned', { id, name: id, x: 3 + i, y: 3, ageDays: 9000 })
  }
  build(put)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store,
    state,
    startTick: state.tick,
    rng: new RngStreams('bridge-road'),
    config,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  handler = bridge.wrapTickHandler(() => {})
  return bridge
}

const partedAndGone = (put: Put, byId: string, tick: number): void => {
  put(0, 'partnership_formed', { aId: 'amara', bId: 'yusuf' })
  put(tick, 'partnership_dissolved', { aId: 'amara', bId: 'yusuf', byId })
  put(tick, 'agent_departed', { agentId: byId })
}

describe('★ the numbers the road is measured against', () => {
  it('counts the valley, and takes neither the dead nor the departed with it', () => {
    expect(road().headcount()).toBe(3)
    expect(
      road((put) => {
        put(1, 'agent_departed', { agentId: 'nadia' })
        put(1, 'agent_died', { agentId: 'yusuf', cause: 'hunger' })
      }).headcount(),
    ).toBe(1)
  })

  it('reads the ceiling off the world’s own laws, not off a runtime opinion', () => {
    expect(road().maxMinds()).toBe(POPULATION_MAX_DEFAULT)
    expect(
      road((put) => {
        put(1, 'config_changed', { path: 'population.maxMinds', value: 4 })
      }).maxMinds(),
    ).toBe(4)
  })

  it('knows a body it holds from one it has never had', () => {
    const b = road((put) => {
      put(1, 'agent_died', { agentId: 'amara', cause: 'hunger' })
    })
    // A dead body is still a body: the road must not bring the same person back.
    expect(b.hasBody('amara')).toBe(true)
    expect(b.isAlive('amara')).toBe(false)
    expect(b.hasBody('mira')).toBe(false)
  })

  it('mints an id before the fold has seen the one before it', () => {
    const b = road()
    const next = b.nextEntityId()
    expect(b.mintId('agent')).toBe(`agent_${next}`)
    expect(b.mintId('item', 1)).toBe(`item_${next + 1}`)
  })

  it('has no road out of a world with no town', () => {
    expect(road().roadRim()).toBeNull()
  })
})

describe('★ a partner who took the road first', () => {
  it('is named to the one left behind, and only inside the window', () => {
    const b = road((put) => {
      partedAndGone(put, 'yusuf', 2 * DAY)
    })
    expect(b.partnersGoneSince('amara', 0)).toEqual([{ name: 'yusuf', day: 2 }])
    expect(b.partnersGoneSince('amara', 3 * DAY)).toEqual([])
  })

  it('is not named to somebody who was never theirs', () => {
    const b = road((put) => {
      partedAndGone(put, 'yusuf', DAY)
    })
    expect(b.partnersGoneSince('nadia', 0)).toEqual([])
  })

  it('is not a leaving at all when nobody walked out of the valley', () => {
    const b = road((put) => {
      put(0, 'partnership_formed', { aId: 'amara', bId: 'yusuf' })
      put(DAY, 'partnership_dissolved', { aId: 'amara', bId: 'yusuf', byId: 'yusuf' })
    })
    expect(b.partnersGoneSince('amara', 0)).toEqual([])
  })
})

describe('★ what the town has watched somebody do', () => {
  const breach = (agentId: string, witnesses: string[]) => ({
    lawId: 'law_1',
    agentId,
    verb: 'take',
    witnesses,
  })

  it('counts the breaches it saw, and none it did not', () => {
    const b = road((put) => {
      put(DAY, 'law_broken', breach('nadia', ['amara']))
      put(DAY, 'law_broken', breach('nadia', []))
      put(DAY, 'law_broken', breach('amara', ['nadia']))
    })
    expect(b.breachesOf('nadia', 0)).toBe(1)
    expect(b.breachesOf('amara', 0)).toBe(1)
    expect(b.breachesOf('nadia', 2 * DAY)).toBe(0)
  })
})

describe('★ who the town has not properly met', () => {
  const came = (id: string, name: string) => ({
    id,
    name,
    sex: 'f' as const,
    ageDays: 868,
    x: 0,
    y: 0,
  })

  it('is everyone off the road who has not stood in a talk', () => {
    const b = road((put) => {
      put(DAY, 'agent_arrived', came('mira', 'Mira'))
      put(DAY, 'agent_arrived', came('zeynep', 'Zeynep'))
    })
    expect(b.strangersSoFar().sort()).toEqual(['mira', 'zeynep'])
    const met = road((put) => {
      put(DAY, 'agent_arrived', came('mira', 'Mira'))
      put(DAY, 'agent_arrived', came('zeynep', 'Zeynep'))
      put(2 * DAY, 'scene_opened', {
        id: 'scene_1',
        kind: 'telling',
        participants: ['amara', 'mira'],
        topic: null,
        stakes: 6,
      })
    })
    expect(met.strangersSoFar()).toEqual(['zeynep'])
  })
})

describe('★ the presence events reach the reader that ties are written from', () => {
  it('comes through the same tail as a partnership', () => {
    const b = road((put) => {
      put(0, 'agent_arrived', {
        id: 'mira',
        name: 'Mira',
        sex: 'f',
        ageDays: 868,
        x: 0,
        y: 0,
      })
      put(0, 'agent_departed', { agentId: 'nadia' })
    })
    const types = b.relationshipEventsSince(0).map((e) => e.type)
    expect(types).toContain('agent_arrived')
    expect(types).toContain('agent_departed')
  })
})
