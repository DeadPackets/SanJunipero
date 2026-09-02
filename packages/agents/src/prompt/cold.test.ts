import { describe, expect, it } from 'vitest'
import { EventStore, openDb } from '@sj/engine/store'
import {
  doorTile,
  fold,
  genesisState,
  isExposed,
  makeGenesisWorld,
  type TickLoop,
  type WorldState,
} from '@sj/engine'
import {
  DAYS_PER_YEAR,
  DAYS_PER_SEASON,
  DEFAULT_CONFIG,
  MINUTES_PER_DAY,
  scanForDirective,
  simTimeFromTick,
} from '@sj/shared'
import { FLAT_WORLD, quietMeadowPacket, wireTown } from '../testutil/fixtures.js'
import { makeables } from '@sj/engine'
import type { EngineBridge } from '../runtime/bridge.js'
import { perceptionToProse, roadLine, type PerceptionPacket, type ProseWorld } from './prose.js'

// A roof is worth the whole of a body's warmth (57.4 -> 0.0 under the sky by midnight, 38.4 held
// indoors), and the prose used to say the opposite: the sky as freedom, the roof as a cage.

const CFG = DEFAULT_CONFIG

// The genesis town with two founders at their own doorways, wired through a real bridge — the
// same object the runtime reads its packets from, so nothing here is a hand-built fixture.
function town(
  startTick: number,
  extraItems: Record<string, unknown>[] = [],
): { bridge: EngineBridge; loop: TickLoop; homes: Record<string, string> } {
  const db = openDb(':memory:')
  const g = makeGenesisWorld(CFG)
  const store = new EventStore(db)
  let state: WorldState = genesisState(CFG, g.terrain)
  for (const e of g.events) state = fold(state, store.append(state.tick, e.type, e.payload), CFG)
  // The valley's houses stand roofless, so the body that goes indoors goes into the cabin.
  const homes: Record<string, string> = {}
  const cabin = Object.values(state.structures).find((s) => s.kind === 'cabin')!
  for (const id of ['amara', 'yusuf']) {
    const house =
      id === 'yusuf'
        ? cabin
        : Object.values(state.structures).find((s) => s.kind === 'house' && s.owner === id)!
    const door = doorTile(state, house)!
    homes[id] = house.id
    state = fold(
      state,
      store.append(state.tick, 'agent_spawned', {
        id,
        name: id,
        x: door.x,
        y: door.y,
        ageDays: 30 * DAYS_PER_YEAR,
        sex: 'f',
      }),
      CFG,
    )
  }
  // Spawned at tick zero on purpose: a shelf life is dated from the moment a thing is made.
  for (const item of extraItems) {
    state = fold(
      state,
      store.append(state.tick, 'item_spawned', {
        ...item,
        spoilage: { spawnDay: 0, days: CFG.spoilage.days.fish },
      }),
      CFG,
    )
  }
  return { ...wireTown({ state, store, seed: 'cold-test', startTick }), homes }
}

const proseFor = (bridge: EngineBridge, id: string): string =>
  perceptionToProse(bridge.perception(id), () => {}, { ...FLAT_WORLD, waterAtHand: () => false })

// 21:00 on day 1: the first hour of the run in which `isExposed` is true for a body outdoors.
const COLD_HOUR = 21 * 60

describe('the cold a body can feel, and the thing that answers it', () => {
  it('a body out under the sky is told the cold is getting into it', () => {
    const { bridge, loop } = town(COLD_HOUR - 1)
    loop.step()
    expect(isExposed(loop.state, CFG, 'amara')).toBe(true)
    expect(proseFor(bridge, 'amara')).toContain('The cold is getting into you out here')
  })

  it('a body under a roof on the same cold night is told the walls are holding it off', () => {
    const { bridge, loop, homes } = town(COLD_HOUR - 2)
    void bridge.submit('yusuf', { verb: 'enter', params: { structureId: homes.yusuf! } })
    loop.step()
    loop.step()
    expect(isExposed(loop.state, CFG, 'yusuf')).toBe(false)
    const prose = proseFor(bridge, 'yusuf')
    expect(prose).toContain('these walls are holding it off you')
    expect(prose).not.toContain('The cold is getting into you')
  })

  it('the two bodies read different sentences on the same night — the pair is the whole lesson', () => {
    const { bridge, loop, homes } = town(COLD_HOUR - 2)
    void bridge.submit('yusuf', { verb: 'enter', params: { structureId: homes.yusuf! } })
    loop.step()
    loop.step()
    const outside = proseFor(bridge, 'amara')
    const inside = proseFor(bridge, 'yusuf')
    expect(outside).toContain('The cold is getting into you out here')
    expect(inside).toContain('these walls are holding it off you')
  })

  it('a mild afternoon says nothing about the cold at all', () => {
    const { bridge, loop } = town(13 * 60)
    loop.step()
    expect(isExposed(loop.state, CFG, 'amara')).toBe(false)
    const prose = proseFor(bridge, 'amara')
    expect(prose).not.toContain('cold is getting into you')
    expect(prose).not.toContain('holding it off you')
  })

  it('the sentence never tells a mind what to do about it', () => {
    const { bridge, loop } = town(COLD_HOUR - 1)
    loop.step()
    const prose = proseFor(bridge, 'amara').toLowerCase()
    expect(scanForDirective(prose)).toEqual([])
    for (const hint of ['build', 'raise a', 'a roof would']) {
      expect(prose).not.toContain(hint)
    }
  })
})

describe('food that is turning', () => {
  // The engine composes `spoiling`, and `reconcile` used to drop it on the floor.
  it('a mind is told when what it carries is on its last day', () => {
    const packet = {
      time: {
        tick: 0,
        year: 0,
        season: 'spring',
        dayOfSeason: 1,
        dayOfYear: 0,
        hour: 12,
        minute: 0,
        isNight: false,
      },
      self: {
        body: {
          needs: { hunger: 90, energy: 90, warmth: 90, social: 90 },
          hp: 100,
          injuries: [],
          ill: false,
        },
        x: 0,
        y: 0,
        asleep: false,
        collapsed: false,
        activity: null,
        inventory: [
          {
            id: 'item_1',
            kind: 'fish',
            qty: 2,
            loc: { t: 'agent', id: 'a' },
            spoiling: true as const,
          },
        ],
      },
      weather: { kind: 'sunny', temperatureC: 14 },
      visible: { agents: [], structures: [], items: [], crops: [] },
      heard: [],
      seen: [],
      feltEvents: [],
    } as unknown as PerceptionPacket
    expect(perceptionToProse(packet, () => {}, FLAT_WORLD)).toContain('it is turning')
  })

  it('fresh food reads exactly as it always did', () => {
    const packet = {
      time: {
        tick: 0,
        year: 0,
        season: 'spring',
        dayOfSeason: 1,
        dayOfYear: 0,
        hour: 12,
        minute: 0,
        isNight: false,
      },
      self: {
        body: {
          needs: { hunger: 90, energy: 90, warmth: 90, social: 90 },
          hp: 100,
          injuries: [],
          ill: false,
        },
        x: 0,
        y: 0,
        asleep: false,
        collapsed: false,
        activity: null,
        inventory: [{ id: 'item_1', kind: 'fish', qty: 2, loc: { t: 'agent', id: 'a' } }],
      },
      weather: { kind: 'sunny', temperatureC: 14 },
      visible: { agents: [], structures: [], items: [], crops: [] },
      heard: [],
      seen: [],
      feltEvents: [],
    } as unknown as PerceptionPacket
    expect(perceptionToProse(packet, () => {}, FLAT_WORLD)).not.toContain('turning')
  })

  it('the bridge carries the flag the engine composes, all the way to the sentence', () => {
    // A fish caught on day zero is on its last day once day one begins: `spoilage.days.fish`
    // is 2 and `isSpoiling` fires a whole day before the deadline. Start the clock there.
    const { bridge, loop } = town(MINUTES_PER_DAY + 8 * 60, [
      {
        id: 'item_fresh_fish',
        kind: 'fish',
        qty: 1,
        loc: { t: 'agent', id: 'amara' },
        owner: 'amara',
      },
    ])
    loop.step()
    const packet = bridge.perception('amara')
    const carried = packet.self.inventory.find((i) => i.id === 'item_fresh_fish')
    expect(carried?.spoiling).toBe(true)
    expect(proseFor(bridge, 'amara')).toContain('1 fish (item_fresh_fish); it is turning')
  })
})

// The cold is real: warmth zero burns energy at twice the rate, and that is the collapse ladder.
// It was never illegible either — what it lacked was a road opened while there was still light.
describe('the road to a fed fire, opened before the light goes', () => {
  const evening = (
    hour: number,
    hearth?: 'lit' | 'cold',
    carried: { kind: string; qty: number }[] = [],
  ): PerceptionPacket => ({
    ...quietMeadowPacket,
    time: simTimeFromTick(hour * 60),
    self: {
      ...quietMeadowPacket.self,
      inventory: carried.map((c, n) => ({
        id: `i${n}`,
        ...c,
        loc: { t: 'agent' as const, id: 'a' },
      })),
    },
    visible: {
      ...quietMeadowPacket.visible,
      structures:
        hearth === undefined
          ? []
          : [
              {
                id: 'structure_fire_pit_12_11',
                kind: 'fire_pit',
                x: 12,
                y: 11,
                w: 1,
                h: 1,
                burning: false,
                stage: 'complete' as const,
                hearth,
              },
            ],
    },
  })
  const coldNight: ProseWorld = {
    ...FLAT_WORLD,
    nightWillBeCold: () => true,
    nearestSource: (kind) => (kind === 'wood' ? { x: 31, y: 44, from: 'tree' } : null),
  }
  const NEEDS_WOOD =
    'The night will be cold; the hearth in the fire pit at (12, 11) is cold and wants wood.'
  const cold = (packet: PerceptionPacket, world = coldNight): string =>
    roadLine(makeables(CFG), packet, world)

  it('names the unlit fire, and where the wood for it stands', () => {
    expect(cold(evening(17, 'cold'))).toBe(
      `${NEEDS_WOOD} The nearest standing tree is at (31, 44).`,
    )
  })

  it('sends nobody to a tree who is already carrying the wood', () => {
    expect(cold(evening(17, 'cold', [{ kind: 'wood', qty: 3 }]))).toBe(NEEDS_WOOD)
  })

  it('names the fire alone when no wood is anywhere in sight', () => {
    // Both a world that cannot be asked and one that answers nothing leave the fire named.
    expect(cold(evening(17, 'cold'), { ...FLAT_WORLD, nightWillBeCold: () => true })).toBe(
      NEEDS_WOOD,
    )
    expect(
      cold(evening(17, 'cold'), {
        ...FLAT_WORLD,
        nightWillBeCold: () => true,
        nearestSource: () => null,
      }),
    ).toBe(NEEDS_WOOD)
  })

  it('★ the cold outranks a project: only one road is spoken, and survival takes it', () => {
    // The same packet with no cold night to answer falls through to the makeables road.
    const warm: ProseWorld = { ...coldNight, nightWillBeCold: () => false }
    expect(cold(evening(17, 'cold'))).toContain('The night will be cold')
    expect(cold(evening(17, 'cold'), warm)).toBe(
      'Plank wants 1 wood; the nearest standing tree is at (31, 44).',
    )
  })

  it('says nothing at noon: a road opened all day is a sentence nobody reads', () => {
    expect(cold(evening(12, 'cold'))).not.toContain('The night will be cold')
  })

  it('says nothing about a fire somebody is already feeding', () => {
    expect(cold(evening(17, 'lit'))).not.toContain('wants wood')
  })

  it('says nothing when no hearth is in sight — a want with no road is not spoken', () => {
    expect(cold(evening(17))).not.toContain('The night will be cold')
  })

  it('says nothing on a night the cold never gets into', () => {
    expect(cold(evening(17, 'cold'), { ...coldNight, nightWillBeCold: () => false })).not.toContain(
      'The night will be cold',
    )
  })

  it('is silent for a world that cannot answer, so an older packet reads as it always did', () => {
    expect(roadLine(makeables(CFG), evening(17, 'cold'), FLAT_WORLD)).toBe('')
  })

  it("names no act and gives no counsel — the inference stays the mind's", () => {
    expect(scanForDirective(NEEDS_WOOD)).toEqual([])
  })

  it('the bridge prices the coming night off the season band the body will actually lose to', () => {
    // Spring nights sit at 5 against a comfort band of 8; summer nights at 15 and never bite.
    const asked = (startTick: number): boolean => {
      const { bridge, loop } = town(startTick)
      loop.step()
      return bridge.nightWillBeCold('amara')
    }
    expect(asked(17 * 60)).toBe(true)
    expect(asked(DAYS_PER_SEASON * MINUTES_PER_DAY + 17 * 60)).toBe(false)
  })
})
