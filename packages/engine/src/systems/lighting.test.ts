import { describe, it, expect } from 'vitest'
import { SimConfigSchema, type SimConfig, type SimEvent } from '@sj/shared'
import { fold } from '../fold.js'
import { submitIntent } from '../intent.js'
import { RngStreams } from '../rng.js'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { VERBS } from '../verbs.js'
import { createWorldTick, type WorldTickResult } from '../worldTick.js'

const quiet = {
  weather: { hourlyChangeChance: 0 }, mystery: { chancePerDay: 0 },
  mapGrowth: { enabled: false }, fauna: { enabled: false }, desirePaths: { enabled: false },
}
const CFG: SimConfig = SimConfigSchema.parse(quiet)
const OFF: SimConfig = SimConfigSchema.parse({ ...quiet, light: { enabled: false } })
const BURN = CFG.light.torchBurnTicks
const FUEL = CFG.light.fuelBurnTicks

let seq = 97000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })
const map = (): TileId[][] => Array.from({ length: 12 }, () => Array.from({ length: 12 }, (): TileId => 0))

function bodyAt(tick: number, config = CFG): WorldState {
  let s = genesisState(config, map())
  s = fold(s, ev('tick_advanced', {}, tick), config)
  return fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 4, y: 4, ageDays: 7300 }, tick), config)
}
const holding = (s: WorldState, id: string, kind: string, config = CFG): WorldState =>
  fold(s, ev('item_spawned', { id, kind, qty: 1, loc: { t: 'agent', id: 'a1' } }, s.tick), config)

function apply(s: WorldState, verb: string, params: Record<string, unknown>, config = CFG): WorldState {
  const r = submitIntent(s, config, 'a1', verb, params)
  if (!r.ok) throw new Error(r.reason)
  const done = VERBS[verb]!.onComplete(s, config, 'a1', params, new RngStreams('li').get('actions'))
  let out = s
  for (const e of [...r.events, { type: 'action_completed', payload: { agentId: 'a1', verb } }, ...done]) {
    out = fold(out, ev(e.type, e.payload, s.tick), config)
  }
  return out
}
function tickOnce(s: WorldState, config = CFG): WorldTickResult {
  return createWorldTick(config, new RngStreams('li'))(fold(s, ev('tick_advanced', {}, s.tick + 1), config))
}

describe('kindle: a torch burns for exactly as long as it has fuel', () => {
  it('lights for torchBurnTicks and burns out on the tick after the last one', () => {
    const lit = apply(holding(bodyAt(0), 'item_1', 'torch'), 'kindle', { itemId: 'item_1' })
    expect(lit.items.item_1!.litUntilTick).toBe(BURN)

    const last = tickOnce({ ...lit, tick: BURN - 1 })
    expect(last.events.some((e) => e.type === 'item_burned_out')).toBe(false)
    expect(last.state.items.item_1).toBeDefined()

    const out = tickOnce({ ...lit, tick: BURN })
    expect(out.events).toContainEqual({ type: 'item_burned_out', payload: { itemId: 'item_1' } })
    expect(out.state.items.item_1).toBeUndefined()
  })

  it('snuffing keeps what is left, and re-kindling burns exactly that much more', () => {
    const lit = apply(holding(bodyAt(0), 'item_1', 'torch'), 'kindle', { itemId: 'item_1' })
    const out = apply({ ...lit, tick: 100 }, 'snuff', { itemId: 'item_1' })
    expect(out.items.item_1!.litUntilTick).toBeUndefined()
    expect(out.items.item_1!.fuelTicks).toBe(BURN - 100)

    const again = apply({ ...out, tick: 1000 }, 'kindle', { itemId: 'item_1' })
    expect(again.items.item_1!.litUntilTick).toBe(1000 + (BURN - 100))
    expect(again.items.item_1!.fuelTicks).toBeUndefined()
  })

  it('refuses what will not take a flame, what is already lit, and what is spent', () => {
    const wood = submitIntent(holding(bodyAt(0), 'item_1', 'wood'), CFG, 'a1', 'kindle', { itemId: 'item_1' })
    expect(wood.ok).toBe(false)
    if (!wood.ok) expect(wood.reason).toBe('that will not take a flame')

    const lit = apply(holding(bodyAt(0), 'item_1', 'torch'), 'kindle', { itemId: 'item_1' })
    const twice = submitIntent(lit, CFG, 'a1', 'kindle', { itemId: 'item_1' })
    expect(twice.ok).toBe(false)
    if (!twice.ok) expect(twice.reason).toBe('it is already lit')

    const spent = apply({ ...lit, tick: BURN }, 'snuff', { itemId: 'item_1' })
    expect(spent.items.item_1!.fuelTicks).toBe(0)
    const dead = submitIntent(spent, CFG, 'a1', 'kindle', { itemId: 'item_1' })
    expect(dead.ok).toBe(false)
    if (!dead.ok) expect(dead.reason).toBe('it is burnt out')

    const idle = submitIntent(holding(bodyAt(0), 'item_1', 'torch'), CFG, 'a1', 'snuff', { itemId: 'item_1' })
    expect(idle.ok).toBe(false)
    if (!idle.ok) expect(idle.reason).toBe('it is not lit')
  })
})

describe('stoke: a fire is warm for as long as somebody feeds it', () => {
  const withPit = (config = CFG): WorldState => {
    let s = bodyAt(0, config)
    s = fold(s, ev('structure_planned', {
      id: 'structure_1', kind: 'fire_pit', x: 5, y: 4, w: 1, h: 1, maxHp: 10, flammable: false, builderId: 'a1',
    }, s.tick), config)
    return fold(s, ev('structure_completed', { id: 'structure_1' }, s.tick), config)
  }

  it('costs one wood and buys fuelBurnTicks of fire', () => {
    const fed = apply(holding(withPit(), 'item_1', 'wood'), 'stoke', { structureId: 'structure_1' })
    expect(fed.structures.structure_1!.fueledUntilTick).toBe(FUEL)
    expect(fed.items.item_1).toBeUndefined()
  })

  it('refuses with no wood, at a distance, and at something that is not a fire', () => {
    const empty = submitIntent(withPit(), CFG, 'a1', 'stoke', { structureId: 'structure_1' })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.reason).toMatch(/^not enough wood — /)

    const far = holding(withPit(), 'item_1', 'wood')
    const away = { ...far, agents: { ...far.agents, a1: { ...far.agents.a1!, x: 0, y: 0 } } }
    const r = submitIntent(away, CFG, 'a1', 'stoke', { structureId: 'structure_1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('not close enough to the fire')

    let house = holding(bodyAt(0), 'item_1', 'wood')
    house = fold(house, ev('structure_planned', {
      id: 'structure_2', kind: 'house', x: 5, y: 4, w: 2, h: 2, maxHp: 50, flammable: true, builderId: 'a1',
    }, house.tick), CFG)
    house = fold(house, ev('structure_completed', { id: 'structure_2' }, house.tick), CFG)
    const wrong = submitIntent(house, CFG, 'a1', 'stoke', { structureId: 'structure_2' })
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.reason).toBe('there is no fire there to feed')
  })
})

describe('the lighting law', () => {
  it('does nothing at all when the world says light is off', () => {
    const lit = apply(holding(bodyAt(0, OFF), 'item_1', 'torch', OFF), 'kindle', { itemId: 'item_1' }, OFF)
    const out = tickOnce({ ...lit, tick: BURN + 10 }, OFF)
    expect(out.events.some((e) => e.type === 'item_burned_out')).toBe(false)
    expect(out.state.items.item_1).toBeDefined()
  })

  it('folding the tick\'s own events reproduces the state it returned', () => {
    const lit = apply(holding(bodyAt(0), 'item_1', 'torch'), 'kindle', { itemId: 'item_1' })
    const start = { ...lit, tick: BURN }
    const out = tickOnce(start)
    let replayed = fold(start, ev('tick_advanced', {}, start.tick + 1), CFG)
    for (const e of out.events) replayed = fold(replayed, ev(e.type, e.payload, start.tick + 1), CFG)
    expect(replayed.items).toEqual(out.state.items)
  })
})
