import { EngineBridge, type Intent } from '@sj/agents'
import {
  createWorldTick,
  fold,
  genesisState,
  RngStreams,
  type TickHandler,
  TickLoop,
  type TileId,
} from '@sj/engine'
import { EventStore, openDb } from '@sj/engine/store'
import { ADULT_AGE_DAYS, MINUTES_PER_DAY, SimConfigSchema } from '@sj/shared'
import { expect, it } from 'vitest'

it('records a scripted eight-day food workload without treating it as an autonomous policy comparison', async () => {
  const config = SimConfigSchema.parse({
    needs: { hungerDecayPerTick: 0, energyDecayAwakePerTick: 0 },
    warmth: { enabled: false },
    weather: { hourlyChangeChance: 0 },
    mystery: { chancePerDay: 0 },
    aging: { deathOfOldAgeEnabled: false },
  })
  const terrain: TileId[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0))
  terrain[4]![4] = 6
  terrain[2]![3] = 3
  const db = openDb(':memory:')
  const store = new EventStore(db)
  let state = genesisState(config, terrain)
  const seed = (type: string, payload: unknown) => {
    state = fold(state, store.append(0, type, payload), config)
  }
  seed('agent_spawned', { id: 'forager', name: 'Forager', x: 2, y: 2, ageDays: ADULT_AGE_DAYS })
  seed('agent_spawned', { id: 'farmer', name: 'Farmer', x: 4, y: 4, ageDays: ADULT_AGE_DAYS })
  seed('item_spawned', {
    id: 'starter-bread',
    kind: 'bread',
    qty: 8,
    loc: { t: 'agent', id: 'farmer' },
  })
  const rng = new RngStreams('food-horizon')
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
  const worldTick = createWorldTick(config, rng)
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const event of worldTick(loop.state).events) emit(event.type, event.payload)
  })
  const advance = (tick: number) => {
    while (loop.tick < tick) loop.step()
  }
  const act = async (agentId: string, intent: Intent) => {
    const accepted = bridge.submit(agentId, intent)
    loop.step()
    expect((await accepted).ok).toBe(true)
    for (let i = 0; loop.state.agents[agentId]!.activity !== null && i < 200; i++) loop.step()
    expect(loop.state.agents[agentId]!.activity).toBeNull()
  }
  try {
    await act('farmer', { verb: 'plant', params: { kind: 'wheat', x: 4, y: 4 } })
    for (let day = 0; day < 8; day++) {
      advance(day * MINUTES_PER_DAY + 6 * 60)
      await act('forager', { verb: 'forage', params: {} })
      const berries = Object.values(loop.state.items).findLast(
        (item) => item.kind === 'berries' && item.loc.t === 'agent' && item.loc.id === 'forager',
      )!
      await act('forager', { verb: 'eat', params: { itemId: berries.id } })
      await act('farmer', { verb: 'eat', params: { itemId: 'starter-bread' } })
    }
    advance(8 * MINUTES_PER_DAY + 6 * 60)
    const crop = Object.values(loop.state.crops)[0]!
    expect(crop.stage).toBe(config.crops.wheat!.stages - 1)
    await act('farmer', { verb: 'harvest', params: { cropId: crop.id } })
    const wheat = Object.values(loop.state.items).find((item) => item.kind === 'wheat')!
    await act('farmer', { verb: 'eat', params: { itemId: wheat.id } })
    const completed = store
      .readTypeFrom(0, 'action_completed')
      .map(
        (event) => event.payload as { agentId: string; verb: string; results?: { kind?: string } },
      )
    const count = (verb: string, kind?: string) =>
      completed.filter(
        (event) => event.verb === verb && (kind === undefined || event.results?.kind === kind),
      ).length
    const produced = store
      .readTypeFrom(0, 'item_spawned')
      .map((event) => event.payload as { kind: string; qty: number })
    const yieldOf = (kind: string) =>
      produced.filter((item) => item.kind === kind).reduce((sum, item) => sum + item.qty, 0)
    expect({
      forage: count('forage'),
      plant: count('plant'),
      harvest: count('harvest'),
      berriesEaten: count('eat', 'berries'),
      breadEaten: count('eat', 'bread'),
      wheatEaten: count('eat', 'wheat'),
    }).toEqual({ forage: 8, plant: 1, harvest: 1, berriesEaten: 8, breadEaten: 8, wheatEaten: 1 })
    expect(yieldOf('berries')).toBe(25)
    expect(yieldOf('wheat')).toBe(3)
    expect(loop.state.items[wheat.id]?.qty).toBe(2)
    expect(store.readTypeFrom(0, 'action_refused')).toHaveLength(0)
    expect(store.readTypeFrom(0, 'crop_grew')).toHaveLength(3)
  } finally {
    store.close()
    db.close()
  }
})
