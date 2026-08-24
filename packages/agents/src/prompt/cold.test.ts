import { describe, expect, it } from 'vitest'
import {
  createWorldTick, doorTile, EventStore, fold, genesisState, isExposed, makeGenesisWorld, openDb,
  RngStreams, TickLoop, type LawQueue, type TickHandler, type WorldState,
} from '@sj/engine'
import { DEFAULT_CONFIG, MINUTES_PER_DAY, type SimEvent } from '@sj/shared'
import { EngineBridge } from '../runtime/bridge.js'
import { perceptionToProse, type PerceptionPacket } from './prose.js'

// ★ THE ROOF THAT READ AS A CAGE.
//
// Measured on `645a8d9`, on the genesis town, on one spring night: a body left under the sky
// went from warmth 57.4 at 20:00 to 0.0 by midnight and then burned energy at twice the rate;
// a body under a roof held 38.4 through the same hours. The roof is worth the whole of a
// body's warmth and the engine has always known it.
//
// What the two bodies READ differed by exactly two sentences, and neither was about the cold:
// the outdoor one got "You shiver against the cold", the indoor one got "Four walls are
// around you; step out under the sky before you can go anywhere else". The sky read as
// freedom and the roof read as a cage — the exact inverse of what the mechanics do. A mind
// cannot want what it cannot perceive, so these rows make the cold, and the thing that
// answers it, facts a mind reads off its own body.

const CFG = DEFAULT_CONFIG

let seq = 0
const ev = (type: string, payload: unknown): SimEvent =>
  ({ seq: ++seq, tick: 0, type, payload } as unknown as SimEvent)

const WORLD = {
  isWalkable: () => true,
  isEdible: () => false,
  waterAtHand: () => false,
  nearestWater: () => null,
  nearestFood: () => null,
}

// The genesis town with two founders at their own doorways, wired through a real bridge — the
// same object the runtime reads its packets from, so nothing here is a hand-built fixture.
function town(
  startTick: number, extraItems: Array<Record<string, unknown>> = [],
): { bridge: EngineBridge; loop: TickLoop; homes: Record<string, string> } {
  const db = openDb(':memory:')
  const g = makeGenesisWorld(CFG)
  const store = new EventStore(db)
  const rng = new RngStreams('cold-test')
  let state: WorldState = genesisState(CFG, g.terrain)
  for (const e of g.events) state = fold(state, store.append(state.tick, e.type, e.payload), CFG)
  // ★ THE VALLEY'S HOUSES STAND ROOFLESS NOW — the abandoned village is abandoned — so the body
  // that goes indoors goes into the cabin, which is one of the two roofs that held. Amara still
  // wakes at her own (roofless) doorway, out under the sky, which is the half this test needs.
  const homes: Record<string, string> = {}
  const cabin = Object.values(state.structures).find((s) => s.kind === 'cabin')!
  for (const id of ['amara', 'yusuf']) {
    const house = id === 'yusuf' ? cabin
      : Object.values(state.structures).find((s) => s.kind === 'house' && s.owner === id)!
    const door = doorTile(state, house)!
    homes[id] = house.id
    state = fold(state, store.append(state.tick, 'agent_spawned',
      { id, name: id, x: door.x, y: door.y, ageDays: 30 * 364, sex: 'f' }), CFG)
  }
  // Spawned at tick zero on purpose: a shelf life is dated from the moment a thing is made.
  for (const item of extraItems) {
    state = fold(state, store.append(state.tick, 'item_spawned',
      { ...item, spoilage: { spawnDay: 0, days: CFG.spoilage.days['fish'] } }), CFG)
  }
  const lawQueue: LawQueue = []
  const worldTick = createWorldTick(CFG, rng, lawQueue)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({ store, state, rng, config: CFG, startTick, realMsPerTick: 0, onTick: (c) => handler(c) })
  const bridge = new EngineBridge({ loop, store, simConfig: CFG })
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
  })
  return { bridge, loop, homes }
}

const proseFor = (bridge: EngineBridge, id: string): string =>
  perceptionToProse(bridge.perception(id), () => {}, { ...WORLD, waterAtHand: () => false })

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
    void bridge.submit('yusuf', { verb: 'enter', params: { structureId: homes['yusuf']! } })
    loop.step()
    loop.step()
    expect(isExposed(loop.state, CFG, 'yusuf')).toBe(false)
    const prose = proseFor(bridge, 'yusuf')
    expect(prose).toContain('these walls are holding it off you')
    expect(prose).not.toContain('The cold is getting into you')
  })

  it('the two bodies read different sentences on the same night — the pair is the whole lesson', () => {
    const { bridge, loop, homes } = town(COLD_HOUR - 2)
    void bridge.submit('yusuf', { verb: 'enter', params: { structureId: homes['yusuf']! } })
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
    const prose = proseFor(bridge, 'amara')
    for (const hint of ['build', 'raise a', 'you should', 'you must build', 'a roof would', 'go inside']) {
      expect(prose.toLowerCase()).not.toContain(hint)
    }
  })
})

describe('food that is turning', () => {
  // The engine has composed `spoiling` since the spoilage system landed; `reconcile` dropped it
  // on the floor, so no mind was ever told its fish was going over. Same shape as the fauna and
  // forageable channels the batch-7 lane found dead in the same function.
  it('a mind is told when what it carries is on its last day', () => {
    const packet = {
      time: { tick: 0, year: 0, season: 'spring', dayOfSeason: 1, dayOfYear: 0, hour: 12, minute: 0, isNight: false },
      self: {
        body: { needs: { hunger: 90, energy: 90, warmth: 90, social: 90 }, hp: 100, injuries: [], ill: false },
        x: 0, y: 0, asleep: false, collapsed: false, activity: null,
        inventory: [{ id: 'item_1', kind: 'fish', qty: 2, loc: { t: 'agent', id: 'a' }, spoiling: true as const }],
      },
      weather: { kind: 'sunny', temperatureC: 14 },
      visible: { agents: [], structures: [], items: [], crops: [] },
      heard: [], seen: [], feltEvents: [],
    } as unknown as PerceptionPacket
    expect(perceptionToProse(packet, () => {}, WORLD)).toContain('it is turning')
  })

  it('fresh food reads exactly as it always did', () => {
    const packet = {
      time: { tick: 0, year: 0, season: 'spring', dayOfSeason: 1, dayOfYear: 0, hour: 12, minute: 0, isNight: false },
      self: {
        body: { needs: { hunger: 90, energy: 90, warmth: 90, social: 90 }, hp: 100, injuries: [], ill: false },
        x: 0, y: 0, asleep: false, collapsed: false, activity: null,
        inventory: [{ id: 'item_1', kind: 'fish', qty: 2, loc: { t: 'agent', id: 'a' } }],
      },
      weather: { kind: 'sunny', temperatureC: 14 },
      visible: { agents: [], structures: [], items: [], crops: [] },
      heard: [], seen: [], feltEvents: [],
    } as unknown as PerceptionPacket
    expect(perceptionToProse(packet, () => {}, WORLD)).not.toContain('turning')
  })

  it('the bridge carries the flag the engine composes, all the way to the sentence', () => {
    // A fish caught on day zero is on its last day once day one begins: `spoilage.days.fish`
    // is 2 and `isSpoiling` fires a whole day before the deadline. Start the clock there.
    const { bridge, loop } = town(MINUTES_PER_DAY + 8 * 60, [
      { id: 'item_fresh_fish', kind: 'fish', qty: 1, loc: { t: 'agent', id: 'amara' }, owner: 'amara' },
    ])
    loop.step()
    const packet = bridge.perception('amara')
    const carried = packet.self.inventory.find((i) => i.id === 'item_fresh_fish')
    expect(carried?.spoiling).toBe(true)
    expect(proseFor(bridge, 'amara')).toContain('1 fish (item_fresh_fish) — it is turning')
  })
})
