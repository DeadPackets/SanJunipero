import { describe, expect, it } from 'vitest'
import { EventStore, openDb } from '@sj/engine/store'
import {
  createWorldTick,
  fold,
  genesisState,
  RngStreams,
  TickLoop,
  type TickHandler,
  type TileId,
} from '@sj/engine'
import { ADULT_AGE_DAYS, SimConfigSchema } from '@sj/shared'
import { perceptionToProse } from '../prompt/prose.js'
import { EngineBridge } from './bridge.js'

// Walked end to end: prose names a doorway and the roof it belongs to, the mind reads the MARK
// out of the words, walks by it, and `enter` lets it in. No tile is read from the prose at all —
// there is none in it to read.
const AGENT = 'tamar'
const HOUSE = 'structure_1'

function town(): { bridge: EngineBridge; step: () => void; loop: TickLoop } {
  const config = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    mystery: { chancePerDay: 0 },
  })
  const terrain: TileId[][] = Array.from({ length: 16 }, () =>
    Array.from({ length: 16 }, (): TileId => 0),
  )
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams('door-seam')
  let state = genesisState(config, terrain)
  const put = (type: string, payload: unknown): void => {
    state = fold(state, store.append(state.tick, type, payload), config)
  }
  put('agent_spawned', { id: AGENT, name: 'Tamar', x: 10, y: 10, ageDays: ADULT_AGE_DAYS })
  put('structure_planned', {
    id: HOUSE,
    kind: 'house',
    x: 5,
    y: 5,
    w: 2,
    h: 2,
    maxHp: 50,
    flammable: true,
    builderId: AGENT,
  })
  put('structure_completed', { id: HOUSE })
  // Noon: the sight horizon shrinks with the light, and a house seven tiles
  // off is a shape in the dark at midnight.
  state = { ...state, tick: 720 }

  const worldTick = createWorldTick(config, rng)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store,
    state,
    rng,
    config,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
  })
  return {
    bridge,
    step: () => {
      loop.step()
    },
    loop,
  }
}

const proseFor = (bridge: EngineBridge): string =>
  perceptionToProse(bridge.perception(AGENT), undefined, {
    isWalkable: (x, y) => bridge.isWalkable(x, y),
    isEdible: (kind) => bridge.isEdible(kind),
  })

describe('the door seam — prose, intent, verb, interior', () => {
  it('a mind reads the mark out of its own prose, walks by it and goes in', async () => {
    const { bridge, step, loop } = town()
    // A place is known once the eyes have reached it, and sight lands at the end of a tick.
    step()

    const said = proseFor(bridge)
    const mark = /\((structure_\d+)\) stands/.exec(said)
    expect(mark).not.toBeNull()
    const structureId = mark![1]!

    const walking = bridge.submit(AGENT, { verb: 'walk', params: { structureId } })
    step()
    expect(await walking).toEqual({ ok: true })
    for (let i = 0; i < 200 && loop.state.agents[AGENT]!.activity !== null; i++) step()

    const entering = bridge.submit(AGENT, { verb: 'enter', params: { structureId: HOUSE } })
    step()
    expect(await entering).toEqual({ ok: true })
    for (let i = 0; i < 20 && loop.state.agents[AGENT]!.insideId === undefined; i++) step()
    expect(loop.state.agents[AGENT]!.insideId).toBe(HOUSE)
  })

  it('names the doorway for a building it could walk into, and no tile for either', () => {
    const { bridge } = town()
    const said = proseFor(bridge)
    expect(said).toContain('it has a doorway; walk to it and you can go in')
    expect(said).not.toContain('no open ground lies beside it')
    expect(said).not.toMatch(new RegExp(`${HOUSE}[^.]*\\(\\d+, ?\\d+\\)`))
  })
})
