import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, MINUTES_PER_DAY, SimConfigSchema, type SimConfig } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { fold } from '../fold.js'
import { composePerception } from '../perception.js'
import { RngStream, RngStreams } from '../rng.js'
import { VERBS } from '../verbs/index.js'
import { createWorldTick } from '../worldTick.js'
import { spoilageFor } from './spoilage.js'
import { ev } from '../testutil/world.js'

// Food is a countdown. The storehouse is worth arguing over because it slows the clock.

const OFF: SimConfig = SimConfigSchema.parse({ spoilage: { enabled: false } })
const RNG = RngStream.seed('spoilage-test', 'actions')

const CHAR_TILE: Record<string, TileId> = { '.': 0, '~': 2, '#': 3 }
const ROWS = ['..###...', '........', '........', '..~~....', '........', '........']

function world(config = DEFAULT_CONFIG): WorldState {
  const s = genesisState(
    config,
    ROWS.map((row) => Array.from(row).map((c) => CHAR_TILE[c]!)),
  )
  return fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 1, y: 1, ageDays: 7300 }), config)
}

function withStorehouse(s: WorldState, config = DEFAULT_CONFIG): WorldState {
  const planned = fold(
    s,
    ev('structure_planned', {
      id: 'structure_1',
      kind: 'storehouse',
      x: 4,
      y: 4,
      w: 2,
      h: 1,
      maxHp: 20,
      flammable: true,
      builderId: 'a1',
    }),
    config,
  )
  return fold(planned, ev('structure_completed', { id: 'structure_1' }), config)
}

type Loc =
  | { t: 'tile'; x: number; y: number }
  | { t: 'agent'; id: string }
  | { t: 'structure'; id: string }

function withFood(
  s: WorldState,
  kind: string,
  loc: Loc,
  spawnDay = 0,
  config = DEFAULT_CONFIG,
): WorldState {
  const days = config.spoilage.days[kind]
  return fold(
    s,
    ev('item_spawned', {
      id: 'item_1',
      kind,
      qty: 1,
      loc,
      ...(days === undefined ? {} : { spoilage: { spawnDay, days } }),
    }),
    config,
  )
}

// Run the midnight that opens `day`.
function midnight(s: WorldState, day: number, config = DEFAULT_CONFIG): WorldState {
  const tick = day * MINUTES_PER_DAY
  const advanced = fold({ ...s, tick: tick - 1 }, ev('tick_advanced', {}, tick), config)
  return createWorldTick(config, new RngStreams('spoilage'))(advanced).state
}

function midnightEvents(
  s: WorldState,
  day: number,
  config = DEFAULT_CONFIG,
): { type: string; payload: unknown }[] {
  const tick = day * MINUTES_PER_DAY
  const advanced = fold({ ...s, tick: tick - 1 }, ev('tick_advanced', {}, tick), config)
  return createWorldTick(
    config,
    new RngStreams('spoilage'),
  )(advanced).events.filter((e) => e.type === 'item_spoiled')
}

// Walk every midnight from day 1 to `through`, so the deadline is re-read at each one.
function liveThrough(s: WorldState, through: number, config = DEFAULT_CONFIG): WorldState {
  let acc = s
  for (let day = 1; day <= through; day++) acc = midnight(acc, day, config)
  return acc
}

describe('the midnight spoilage check', () => {
  it('takes the fish at the midnight that ends its second day', () => {
    const s = withFood(world(), 'fish', { t: 'agent', id: 'a1' })
    expect(liveThrough(s, 1).items.item_1).toBeDefined()
    expect(midnightEvents(liveThrough(s, 1), 2)).toEqual([
      { type: 'item_spoiled', payload: { id: 'item_1' } },
    ])
    expect(liveThrough(s, 2).items.item_1).toBeUndefined()
  })

  it('lets a loaf keep twelve days on a storehouse shelf instead of six', () => {
    const s = withFood(withStorehouse(world()), 'bread', { t: 'structure', id: 'structure_1' })
    expect(liveThrough(s, 11).items.item_1).toBeDefined()
    expect(liveThrough(s, 12).items.item_1).toBeUndefined()
  })

  it('reads the multiplier from where the loaf sits now, not from where it was baked', () => {
    const held = withFood(withStorehouse(world()), 'bread', { t: 'agent', id: 'a1' })
    const shelved = fold(
      liveThrough(held, 5),
      ev('item_moved', { id: 'item_1', loc: { t: 'structure', id: 'structure_1' } }),
    )
    expect(liveThrough(shelved, 11).items.item_1).toBeDefined()

    const kept = withFood(withStorehouse(world()), 'bread', { t: 'structure', id: 'structure_1' })
    const pocketed = fold(
      liveThrough(kept, 6),
      ev('item_moved', { id: 'item_1', loc: { t: 'agent', id: 'a1' } }),
    )
    expect(liveThrough(pocketed, 7).items.item_1).toBeUndefined()
  })

  it('lets seed wheat survive fifty-nine days', () => {
    const s = withFood(world(), 'wheat', { t: 'agent', id: 'a1' })
    expect(liveThrough(s, 59).items.item_1).toBeDefined()
  })

  it('never touches a thing that is not food', () => {
    const s = withFood(world(), 'wood', { t: 'tile', x: 2, y: 2 })
    expect(s.items.item_1).not.toHaveProperty('spoilage')
    expect(liveThrough(s, 70).items.item_1).toBeDefined()
  })

  it('only fires at midnight', () => {
    const s = withFood(world(), 'fish', { t: 'agent', id: 'a1' })
    const noon = fold(
      { ...s, tick: 2 * MINUTES_PER_DAY + 719 },
      ev('tick_advanced', {}, 2 * MINUTES_PER_DAY + 720),
    )
    expect(
      createWorldTick(
        DEFAULT_CONFIG,
        new RngStreams('spoilage'),
      )(noon).events.filter((e) => e.type === 'item_spoiled'),
    ).toEqual([])
  })

  it('stops the clock entirely with the flag off', () => {
    const s = withFood(world(OFF), 'fish', { t: 'agent', id: 'a1' }, 0, OFF)
    expect(midnightEvents(liveThrough(s, 1, OFF), 2, OFF)).toEqual([])
    expect(liveThrough(s, 4, OFF).items.item_1).toBeDefined()
  })
})

describe('what leaves the hand with a shelf life', () => {
  it('stamps only the kinds the table names', () => {
    const s = world()
    expect(spoilageFor(s, 'fish', DEFAULT_CONFIG)).toEqual({ spoilage: { spawnDay: 0, days: 2 } })
    expect(spoilageFor(s, 'wood', DEFAULT_CONFIG)).toEqual({})
    expect(spoilageFor({ ...s, tick: 3 * MINUTES_PER_DAY }, 'bread', DEFAULT_CONFIG)).toEqual({
      spoilage: { spawnDay: 3, days: 6 },
    })
  })

  it('carries the shelf life out of the woods on foraged berries', () => {
    const s = { ...world(), tick: MINUTES_PER_DAY }
    const spawned = VERBS.forage!.onComplete(s, DEFAULT_CONFIG, 'a1', {}, RNG).find(
      (e) => e.type === 'item_spawned',
    )!
    expect(spawned.payload).toMatchObject({ kind: 'berries', spoilage: { spawnDay: 1, days: 3 } })
  })

  it('leaves a written note out of it — paper is not food', () => {
    const spawned = VERBS.write!.onComplete(
      world(),
      DEFAULT_CONFIG,
      'a1',
      { text: 'hello' },
      RNG,
    )[0]!
    expect(spawned.payload).not.toHaveProperty('spoilage')
  })

  it('stamps nothing with the flag off', () => {
    expect(spoilageFor(world(OFF), 'fish', OFF)).toEqual({})
  })
})

describe('perception smells it coming', () => {
  const perceive = (s: WorldState, config = DEFAULT_CONFIG) =>
    composePerception(s, config, 'a1', [])

  it('flags a fish only on its final day', () => {
    const s = withFood(world(), 'fish', { t: 'tile', x: 1, y: 1 })
    expect(perceive(s).visible.items[0]).not.toHaveProperty('spoiling')
    expect(perceive({ ...s, tick: MINUTES_PER_DAY }).visible.items[0]!.spoiling).toBe(true)
  })

  it('flags the fish in your own hands too', () => {
    const s = withFood(world(), 'fish', { t: 'agent', id: 'a1' })
    expect(perceive({ ...s, tick: MINUTES_PER_DAY }).self.inventory[0]!.spoiling).toBe(true)
  })

  it('says nothing about a loaf that the storehouse is still holding back', () => {
    const s = withFood(withStorehouse(world()), 'bread', { t: 'structure', id: 'structure_1' })
    expect(perceive({ ...s, tick: 5 * MINUTES_PER_DAY }).visible.items).toEqual([])
    const near = {
      ...s,
      agents: { a1: { ...s.agents.a1!, x: 4, y: 3 } },
      tick: 5 * MINUTES_PER_DAY,
    }
    expect(perceive(near).visible.items[0]).not.toHaveProperty('spoiling')
    expect(perceive({ ...near, tick: 11 * MINUTES_PER_DAY }).visible.items[0]!.spoiling).toBe(true)
  })

  it('goes quiet with the flag off', () => {
    const s = withFood(world(), 'fish', { t: 'tile', x: 1, y: 1 })
    expect(perceive({ ...s, tick: MINUTES_PER_DAY }, OFF).visible.items[0]).not.toHaveProperty(
      'spoiling',
    )
  })
})
