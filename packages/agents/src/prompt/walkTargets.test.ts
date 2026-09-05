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
import { SimConfigSchema, simTimeFromTick } from '@sj/shared'
import { EngineBridge } from '../runtime/bridge.js'
import { walkTargetsLine, type PerceptionPacket, type ProseWorld } from './prose.js'

// A twelve by twelve meadow with a river down column 8, so everything east of it is out of
// reach on foot and everything west of it is one plain walk away.
const WATER_COLUMN = 8

type Put = (tick: number, type: string, payload: unknown) => void

function valley(build: (put: Put) => void = () => {}): EngineBridge {
  const config = SimConfigSchema.parse({})
  const terrain: TileId[][] = Array.from({ length: 12 }, () =>
    Array.from({ length: 12 }, (): TileId => 0),
  )
  for (const row of terrain) row[WATER_COLUMN] = 2
  const store = new EventStore(openDb(':memory:'))
  let state: WorldState = genesisState(config, terrain)
  const put: Put = (tick, type, payload) => {
    state = fold(state, store.append(tick, type, payload), config)
  }
  put(0, 'agent_spawned', { id: 'amara', name: 'Amara', x: 3, y: 3, ageDays: 9000 })
  build(put)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store,
    state,
    startTick: state.tick,
    rng: new RngStreams('walk-targets'),
    config,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  handler = bridge.wrapTickHandler(() => {})
  return bridge
}

const worldOf = (bridge: EngineBridge): ProseWorld => ({
  canWalkTo: (mark) => bridge.canWalkTo('amara', mark),
  footingNear: (x, y) => bridge.footingNear('amara', x, y),
})

const packetAt = (over: Partial<PerceptionPacket['visible']> = {}): PerceptionPacket => ({
  time: simTimeFromTick(10 * 60),
  self: {
    body: {
      needs: { hunger: 62, energy: 78, warmth: 71, social: 55 },
      hp: 100,
      injuries: [],
      ill: false,
    },
    x: 3,
    y: 3,
    asleep: false,
    collapsed: false,
    activity: null,
    inventory: [],
  },
  weather: { kind: 'sunny', temperatureC: 18 },
  visible: { agents: [], structures: [], items: [], crops: [], ...over },
  heard: [],
  seen: [],
  feltEvents: [],
})

const seenBody = (
  id: string,
  name: string,
  x: number,
  y: number,
): PerceptionPacket['visible']['agents'][number] => ({
  id,
  name,
  x,
  y,
  asleep: false,
  collapsed: false,
  activityVerb: null,
})

describe('★ the walk targets a mind can actually name and reach', () => {
  it('names a body in sight and never one the eyes cannot reach', () => {
    const bridge = valley((put) => {
      put(0, 'agent_spawned', { id: 'yusuf', name: 'Yusuf', x: 5, y: 3, ageDays: 9000 })
      put(0, 'agent_spawned', { id: 'nadia', name: 'Nadia', x: 11, y: 11, ageDays: 9000 })
    })
    // Only what the packet shows is a candidate, which is the whole of "you cannot see them
    // from here" answered before it is spent.
    const line = walkTargetsLine(
      [],
      packetAt({ agents: [seenBody('yusuf', 'Yusuf', 5, 3)] }),
      worldOf(bridge),
    )
    expect(line).toContain('Yusuf (yusuf)')
    expect(line).not.toContain('Nadia')
  })

  it('drops a body it is already standing beside, which the walk verb turns away as no walk', () => {
    const bridge = valley((put) => {
      put(0, 'agent_spawned', { id: 'yusuf', name: 'Yusuf', x: 4, y: 3, ageDays: 9000 })
    })
    const line = walkTargetsLine(
      [],
      packetAt({ agents: [seenBody('yusuf', 'Yusuf', 4, 3)] }),
      worldOf(bridge),
    )
    expect(line).not.toContain('Yusuf')
  })

  it('names a known place this side of the water and drops the one across it', () => {
    const bridge = valley((put) => {
      for (const [id, x] of [
        ['hut_w', 2],
        ['hut_e', 10],
      ] as const) {
        put(0, 'structure_planned', {
          id,
          kind: 'hut',
          x,
          y: 6,
          w: 1,
          h: 1,
          maxHp: 10,
          flammable: false,
          builderId: 'amara',
        })
        put(0, 'structure_completed', { id })
      }
      put(0, 'places_seen', { agentId: 'amara', structureIds: ['hut_w', 'hut_e'] })
    })
    const known = bridge.knownPlaces('amara')
    expect(known.map((p) => p.id).sort()).toEqual(['hut_e', 'hut_w'])
    const line = walkTargetsLine(known, packetAt(), worldOf(bridge))
    expect(line).toContain('hut_w')
    // "no path to that spot" was 30 of rehearsal 13's 178 refusals; a mark across the river is
    // exactly one of them, and it never reaches the page.
    expect(line).not.toContain('hut_e')
  })

  it('points at the bank a foot can hold, never at the water itself', () => {
    const bridge = valley()
    const line = walkTargetsLine([], packetAt(), {
      ...worldOf(bridge),
      nearestWater: () => ({ x: WATER_COLUMN, y: 3 }),
    })
    expect(line).toContain(`(${WATER_COLUMN - 1}, 3) for water`)
    expect(line).not.toContain(`(${WATER_COLUMN}, 3)`)
  })

  it('says nothing indoors, where the doorway is the only walk there is', () => {
    const bridge = valley()
    const packet = packetAt()
    const indoors: PerceptionPacket = {
      ...packet,
      self: { ...packet.self, inside: { id: 'hut_w', kind: 'hut' } },
    }
    expect(walkTargetsLine([], indoors, worldOf(bridge))).toBe('')
  })

  it('says nothing at all when no world answers it, so an older packet reads as it always did', () => {
    expect(walkTargetsLine([], packetAt(), undefined)).toBe('')
  })

  it('closes on the guess the whole line exists to stop', () => {
    const bridge = valley((put) => {
      put(0, 'agent_spawned', { id: 'yusuf', name: 'Yusuf', x: 5, y: 3, ageDays: 9000 })
    })
    const line = walkTargetsLine(
      [],
      packetAt({ agents: [seenBody('yusuf', 'Yusuf', 5, 3)] }),
      worldOf(bridge),
    )
    expect(line).toContain('Any other spot you name by two numbers may have no way through to it.')
  })
})
