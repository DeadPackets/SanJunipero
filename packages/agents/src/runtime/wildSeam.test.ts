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

// The engine composes the deer and the berry bushes; the bridge used to drop them, so no mind
// could name one. These rows walk both verbs from the sentence a mind reads to the thing taken.
const AGENT = 'tamar'

function wild(): { bridge: EngineBridge; step: () => void; loop: TickLoop } {
  const config = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    mystery: { chancePerDay: 0 },
    mapGrowth: { enabled: false },
  })
  const terrain: TileId[][] = Array.from({ length: 16 }, () =>
    Array.from({ length: 16 }, (): TileId => 0),
  )
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams('wild-seam')
  let state = genesisState(config, terrain)
  const put = (type: string, payload: unknown): void => {
    state = fold(state, store.append(state.tick, type, payload), config)
  }
  put('agent_spawned', { id: AGENT, name: 'Tamar', x: 8, y: 8, ageDays: ADULT_AGE_DAYS })
  put('item_spawned', { id: 'item_1', kind: 'knife', qty: 1, loc: { t: 'agent', id: AGENT } })
  put('fauna_spawned', { id: 'fauna_1', kind: 'deer', x: 9, y: 8 })
  put('forageable_spawned', { id: 'node_1', kind: 'berry_bush', x: 7, y: 8, stock: 3 })
  put('structure_planned', {
    id: 'structure_1',
    kind: 'well',
    x: 12,
    y: 8,
    w: 1,
    h: 1,
    maxHp: 40,
    flammable: false,
    builderId: AGENT,
  })
  put('structure_completed', { id: 'structure_1' })
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
    waterAtHand: () => bridge.waterAtHand(AGENT),
    nearestWater: (x, y) => bridge.nearestWater(x, y),
  })

describe('the wild seam — prose, intent, verb, the thing taken', () => {
  it('names the animal and the patch, each with the mark the verb asks for', () => {
    const said = proseFor(wild().bridge)
    expect(said).toContain('A deer (fauna_1) is out at (9, 8).')
    expect(said).toContain('You see berry bushes heavy with fruit (node_1) at (7, 8).')
  })

  it('a mind reads a deer out of its own prose and hunts it', async () => {
    const { bridge, step, loop } = wild()
    const id = /A deer \((fauna_\d+)\)/.exec(proseFor(bridge))![1]!

    const hunting = bridge.submit(AGENT, { verb: 'hunt', params: { faunaId: id } })
    step()
    expect(await hunting).toEqual({ ok: true })
    for (let i = 0; i < 60 && loop.state.agents[AGENT]!.activity !== null; i++) step()
    // A hunt is a roll: it either kills or the deer runs. Neither answer is a refusal.
    const deer = loop.state.fauna?.[id]
    const carried = Object.values(loop.state.items)
      .filter((i) => i.loc.t === 'agent' && i.loc.id === AGENT)
      .map((i) => i.kind)
    if (!deer?.alive) expect(carried).toContain('venison')
    else expect({ x: deer.x, y: deer.y }).not.toEqual({ x: 9, y: 8 })
  })

  it('a mind reads a berry patch out of its own prose and strips it', async () => {
    const { bridge, step, loop } = wild()
    const id = /berry bushes heavy with fruit \((node_\d+)\)/.exec(proseFor(bridge))![1]!

    const picking = bridge.submit(AGENT, { verb: 'forage', params: { nodeId: id } })
    step()
    expect(await picking).toEqual({ ok: true })
    for (let i = 0; i < 60 && loop.state.agents[AGENT]!.activity !== null; i++) step()
    const held = Object.values(loop.state.items).filter(
      (i) => i.loc.t === 'agent' && i.kind === 'berries',
    )
    expect(held).toHaveLength(1)
    expect(loop.state.forageables!.node_1!.stock).toBe(2)
  })

  // Block 1 now teaches `drink` and `fill`, both of which want water at the elbow, and terrain
  // is the one thing perception never projects. A dry throat has to have somewhere to look.
  it('a dry throat is told where the water is, and the well counts as water', async () => {
    const { bridge, step, loop } = wild()
    loop.state.agents[AGENT]!.thirst = 10
    expect(proseFor(bridge)).toContain('The nearest water you know of lies at (12, 8)')

    const walking = bridge.submit(AGENT, { verb: 'walk', params: { x: 11, y: 8 } })
    step()
    expect(await walking).toEqual({ ok: true })
    for (let i = 0; i < 60 && loop.state.agents[AGENT]!.activity !== null; i++) step()
    loop.state.agents[AGENT]!.thirst = 10
    expect(proseFor(bridge)).toContain('Water lies within reach of your hands')

    const drinking = bridge.submit(AGENT, { verb: 'drink', params: {} })
    step()
    expect(await drinking).toEqual({ ok: true })
  })

  // Run E: `Water lies within reach` printed 0 times in 3,343 ticks and `Your mouth is dry`
  // once, four ticks from the end. Thirst decays 1.67x slower than hunger and shared its 30.
  it('opens the water road long before the mouth is dry, and the two are separate', async () => {
    const { bridge, loop } = wild()
    loop.state.agents[AGENT]!.thirst = 45
    const early = proseFor(bridge)
    expect(early).toContain('The nearest water you know of lies at (12, 8)')
    expect(early).not.toContain('Your mouth is dry')

    loop.state.agents[AGENT]!.thirst = 55
    expect(proseFor(bridge)).not.toContain('The nearest water you know of')

    loop.state.agents[AGENT]!.thirst = 25
    expect(proseFor(bridge)).toContain('Your mouth is dry')
  })

  it('reproduces the run: with no node named, forage still needs a wood at the elbow', async () => {
    const { bridge, step } = wild()
    const blind = bridge.submit(AGENT, { verb: 'forage', params: {} })
    step()
    expect(await blind).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^no forest nearby — /) as string,
    })
  })
})
