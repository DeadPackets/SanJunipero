import { describe, it, expect } from 'vitest'
import { SimConfigSchema, stateHash, thirstDecayPerTick, type SimConfig } from '@sj/shared'
import { fold } from '../fold.js'
import { composePerception } from '../perception.js'
import { submitIntent } from '../intent.js'
import { RngStreams } from '../rng.js'
import { genesisState, thirstOf, type TileId, type WorldState } from '../state.js'
import { createWorldTick, type WorldTickResult } from '../worldTick.js'
import { ev, needChanges, roundTrips } from '../testutil/world.js'

const quiet = { weather: { hourlyChangeChance: 0 }, mystery: { chancePerDay: 0 } }
const CFG: SimConfig = SimConfigSchema.parse(quiet)
const OFF: SimConfig = SimConfigSchema.parse({ ...quiet, thirst: { enabled: false } })
const DECAY = thirstDecayPerTick(CFG)

// A pond at (4,4) and a dug channel at (6,6); everything else is grass.
function map(): TileId[][] {
  const t = Array.from({ length: 12 }, () => Array.from({ length: 12 }, (): TileId => 0))
  t[4]![4] = 2
  t[6]![6] = 10
  return t
}

function body(config = CFG, x = 3, y = 4): WorldState {
  return fold(
    genesisState(config, map()),
    ev('agent_spawned', { id: 'a1', name: 'a1', x, y, ageDays: 7300 }),
    config,
  )
}
function tickOnce(s: WorldState, config = CFG): WorldTickResult {
  return createWorldTick(
    config,
    new RngStreams('th'),
  )(fold(s, ev('tick_advanced', {}, s.tick + 1), config))
}
const thirsts = (r: WorldTickResult) =>
  needChanges(r.events)
    .filter((c) => c.need === 'thirst')
    .map((c) => c.delta)
const parch = (s: WorldState, thirst: number): WorldState => ({
  ...s,
  agents: { ...s.agents, a1: { ...s.agents.a1!, thirst } },
})

describe('thirst: absent means full', () => {
  it('reads 100 off a body that has never been thirsty, and leaves its hash alone', () => {
    const clean = body()
    expect(clean.agents.a1!.thirst).toBeUndefined()
    expect(thirstOf(clean.agents.a1!)).toBe(100)
    expect(stateHash(clean)).toBe(stateHash(body()))
    expect(composePerception(clean, CFG, 'a1', []).self.body.thirst).toBe(100)
  })

  it('decays at 0.6x the hunger rate, per tick, and not at all when the world says so', () => {
    expect(DECAY).toBe(CFG.needs.hungerDecayPerTick * 0.6)
    expect(thirsts(tickOnce(body()))).toEqual([-DECAY])
    expect(tickOnce(body()).state.agents.a1!.thirst).toBe(100 - DECAY)
    expect(thirsts(tickOnce(body(OFF), OFF))).toEqual([])
    expect(tickOnce(body(OFF), OFF).state.agents.a1!.thirst).toBeUndefined()
  })

  it('stops at zero and never goes under', () => {
    const r = tickOnce(parch(body(), DECAY / 2))
    expect(r.state.agents.a1!.thirst).toBe(0)
    expect(tickOnce(r.state).state.agents.a1!.thirst).toBe(0)
  })

  it('a dry body loses hp at the thirst rate and dies naming thirst', () => {
    const dry = parch(body(), 0)
    expect(tickOnce(dry).events).toContainEqual({
      type: 'hp_changed',
      payload: { agentId: 'a1', delta: -CFG.mortality.thirstHpDrainPerTick },
    })
    const nearly = fold(
      parch(body(), 0),
      ev('agent_harmed', { agentId: 'a1', amount: 99.9, source: 'accident' }),
      CFG,
    )
    expect(tickOnce(nearly).events.find((e) => e.type === 'agent_died')?.payload).toEqual({
      agentId: 'a1',
      cause: 'thirst',
    })
  })

  it('leaves the dead alone', () => {
    const dead = fold(parch(body(), 50), ev('agent_died', { agentId: 'a1', cause: 'hunger' }), CFG)
    expect(thirsts(tickOnce(dead))).toEqual([])
  })
})

describe('drink: four ways to answer it', () => {
  const drank = (s: WorldState, params: Record<string, unknown> = {}) => {
    const r = submitIntent(s, CFG, 'a1', 'drink', params)
    if (!r.ok) throw new Error(r.reason)
    let out = s
    for (const e of r.events) out = fold(out, ev(e.type, e.payload, s.tick), CFG)
    return tickOnce(out)
  }
  const skin = (s: WorldState, charges: number) =>
    fold(
      s,
      ev('item_spawned', {
        id: 'item_1',
        kind: 'waterskin',
        qty: 1,
        loc: { t: 'agent', id: 'a1' },
        charges,
      }),
      CFG,
    )

  it('is a Tier-1 verb that takes one tick', () => {
    const r = submitIntent(parch(body(), 10), CFG, 'a1', 'drink', {})
    expect(r.ok).toBe(true)
    if (r.ok)
      expect(r.events[0]).toEqual({
        type: 'action_started',
        payload: { agentId: 'a1', verb: 'drink', params: {}, duration: 1 },
      })
  })

  it('restores drinkRestore from a pond, from a dug channel, and from a well', () => {
    const pond = drank(parch(body(), 10))
    expect(pond.events).toContainEqual({
      type: 'agent_drank',
      payload: { agentId: 'a1', source: 'water_tile' },
    })
    expect(pond.state.agents.a1!.thirst).toBe(10 + CFG.thirst.drinkRestore - DECAY)

    const channel = drank(parch(body(CFG, 5, 6), 10))
    expect(channel.events).toContainEqual({
      type: 'agent_drank',
      payload: { agentId: 'a1', source: 'water_tile' },
    })

    let well = parch(body(CFG, 1, 1), 10)
    well = fold(
      well,
      ev('structure_planned', {
        id: 'structure_1',
        kind: 'well',
        x: 2,
        y: 1,
        w: 1,
        h: 1,
        maxHp: 30,
        flammable: false,
        builderId: 'a1',
      }),
      CFG,
    )
    well = fold(well, ev('structure_completed', { id: 'structure_1' }), CFG)
    expect(drank(well).events).toContainEqual({
      type: 'agent_drank',
      payload: { agentId: 'a1', source: 'well' },
    })
  })

  it('drains a charge out of a waterskin, and refuses one that is empty', () => {
    const r = drank(skin(parch(body(CFG, 1, 1), 10), 2), { itemId: 'item_1' })
    expect(r.events).toContainEqual({
      type: 'agent_drank',
      payload: { agentId: 'a1', source: 'item', itemId: 'item_1' },
    })
    expect(r.state.items.item_1!.charges).toBe(1)
    expect(r.state.agents.a1!.thirst).toBe(10 + CFG.thirst.drinkRestore - DECAY)

    const empty = submitIntent(skin(parch(body(CFG, 1, 1), 10), 0), CFG, 'a1', 'drink', {
      itemId: 'item_1',
    })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.reason).toBe('the skin is empty')
  })

  it('walks the two tiles to the water, and refuses a body with nothing to drink from', () => {
    expect(submitIntent(parch(body(CFG, 2, 4), 10), CFG, 'a1', 'drink', {}).ok).toBe(true)
    const notAVessel = fold(
      parch(body(CFG, 1, 1), 10),
      ev('item_spawned', {
        id: 'item_1',
        kind: 'wood',
        qty: 1,
        loc: { t: 'agent', id: 'a1' },
      }),
      CFG,
    )
    const wrong = submitIntent(notAVessel, CFG, 'a1', 'drink', { itemId: 'item_1' })
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.reason).toBe('nothing to drink from')
  })

  it("folding the tick's own events reproduces the state it returned", () => {
    const { replayed, out } = roundTrips(parch(body(), 10), CFG, 'th')
    expect(stateHash(replayed)).toBe(stateHash(out.state))
  })
})
