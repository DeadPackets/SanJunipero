import { describe, expect, it } from 'vitest'
import {
  createWorldTick,
  EventStore,
  fold,
  genesisState,
  openDb,
  RngStreams,
  TickLoop,
  type TickHandler,
  type TileId,
} from '@sj/engine'
import { SimConfigSchema } from '@sj/shared'
import { perceptionToProse } from '../prompt/prose.js'
import { EngineBridge } from './bridge.js'

// The mini-rehearsal's worst causal chain, walked end to end: prose names a doorway, the mind
// reads the tile out of the words it was given, walks there, and `enter` lets it in. Nothing in
// this test knows the door tile except the sentence the mind read.
const AGENT = 'tamar'
const HUT = 'structure_1'

function town(): { bridge: EngineBridge; step: () => void; loop: TickLoop } {
  const config = SimConfigSchema.parse({ weather: { hourlyChangeChance: 0 }, mystery: { chancePerDay: 0 } })
  const terrain: TileId[][] = Array.from({ length: 16 }, () => Array.from({ length: 16 }, (): TileId => 0))
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams('door-seam')
  let state = genesisState(config, terrain)
  const put = (type: string, payload: unknown): void => {
    state = fold(state, store.append(state.tick, type, payload), config)
  }
  put('agent_spawned', { id: AGENT, name: 'Tamar', x: 10, y: 10, ageDays: 7300 })
  put('structure_planned', {
    id: HUT, kind: 'hut', x: 5, y: 5, w: 2, h: 2, maxHp: 50, flammable: true, builderId: AGENT,
  })
  put('structure_completed', { id: HUT })
  // Noon: after C11 Task 26 the sight horizon shrinks with the light, and a hut seven tiles
  // off is a shape in the dark at midnight.
  state = { ...state, tick: 720 }

  const worldTick = createWorldTick(config, rng)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({ store, state, rng, config, onTick: (ctx) => handler(ctx) })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
  })
  return { bridge, step: () => loop.step(), loop }
}

const proseFor = (bridge: EngineBridge): string =>
  perceptionToProse(bridge.perception(AGENT), undefined, {
    isWalkable: (x, y) => bridge.isWalkable(x, y),
    isEdible: (kind) => bridge.isEdible(kind),
  })

describe('the door seam — prose, intent, verb, interior', () => {
  it('a mind reads the doorway out of its own prose, walks there and goes in', async () => {
    const { bridge, step, loop } = town()

    const said = proseFor(bridge)
    const door = /doorway is at \((\d+), (\d+)\)/.exec(said)
    expect(door).not.toBeNull()
    const x = Number(door![1])
    const y = Number(door![2])

    const walking = bridge.submit(AGENT, { verb: 'walk', params: { x, y } })
    step()
    expect(await walking).toEqual({ ok: true })
    for (let i = 0; i < 200 && loop.state.agents[AGENT]!.activity !== null; i++) step()
    expect({ x: loop.state.agents[AGENT]!.x, y: loop.state.agents[AGENT]!.y }).toEqual({ x, y })

    const entering = bridge.submit(AGENT, { verb: 'enter', params: { structureId: HUT } })
    step()
    expect(await entering).toEqual({ ok: true })
    for (let i = 0; i < 20 && loop.state.agents[AGENT]!.insideId === undefined; i++) step()
    expect(loop.state.agents[AGENT]!.insideId).toBe(HUT)
  })

  it('never offers a tile beside the wall for a building it could walk into', () => {
    const { bridge } = town()
    const said = proseFor(bridge)
    expect(said).toContain('stand there and you can go in')
    expect(said).not.toContain('you could stand beside it at')
  })
})
