import { describe, it, expect } from 'vitest'
import { DAYS_PER_YEAR, SimConfigSchema, type SimConfig } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { fold } from '../fold.js'
import { RngStreams } from '../rng.js'
import { createWorldTick, type WorldTickResult } from '../worldTick.js'
import { ageBand } from './aging.js'
import { ev, roundTrips } from '../testutil/world.js'

const CFG: SimConfig = SimConfigSchema.parse({})
const MIDNIGHT = 1440 // day 1, hour 0, minute 0

function makeWorld(ageDays: number): WorldState {
  let s = genesisState(
    CFG,
    Array.from({ length: 16 }, () => Array.from({ length: 16 }, (): TileId => 0)),
  )
  s = fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays }), CFG)
  return s
}
function tickTo(s: WorldState, tick: number, rng = new RngStreams('t')): WorldTickResult {
  const wt = createWorldTick(CFG, rng)
  return wt(fold(s, ev('tick_advanced', {}, tick), CFG))
}
describe('ageBand', () => {
  it('bands child/adult/elder on the config year boundaries', () => {
    expect(ageBand(CFG, 0)).toBe('child')
    expect(ageBand(CFG, 16 * DAYS_PER_YEAR - 1)).toBe('child')
    expect(ageBand(CFG, 16 * DAYS_PER_YEAR)).toBe('adult')
    expect(ageBand(CFG, 60 * DAYS_PER_YEAR - 1)).toBe('adult')
    expect(ageBand(CFG, 60 * DAYS_PER_YEAR)).toBe('elder')
  })
})

describe('fold: agent_aged', () => {
  it('increments ageDays by exactly 1', () => {
    let s = makeWorld(7300)
    s = fold(s, ev('agent_aged', { agentId: 'a1' }), CFG)
    expect(s.agents.a1!.ageDays).toBe(7301)
    expect(() => fold(s, ev('agent_aged', { agentId: 'ghost' }), CFG)).toThrow(/unknown agent/i)
  })
})

describe('worldTick: aging at midnight', () => {
  it('ages exactly at the midnight tick, not before or after', () => {
    const at = tickTo({ ...makeWorld(7300), tick: MIDNIGHT - 1 }, MIDNIGHT)
    expect(at.events).toContainEqual({ type: 'agent_aged', payload: { agentId: 'a1' } })
    expect(at.state.agents.a1!.ageDays).toBe(7301)

    const before = tickTo({ ...makeWorld(7300), tick: MIDNIGHT - 2 }, MIDNIGHT - 1)
    expect(before.events.map((e) => e.type)).not.toContain('agent_aged')
    const after = tickTo({ ...makeWorld(7300), tick: MIDNIGHT }, MIDNIGHT + 1)
    expect(after.events.map((e) => e.type)).not.toContain('agent_aged')
    expect(after.state.agents.a1!.ageDays).toBe(7300)
  })

  it('dead agents do not age', () => {
    let s = makeWorld(7300)
    s = fold(s, ev('agent_died', { agentId: 'a1', cause: 'health' }), CFG)
    const r = tickTo({ ...s, tick: MIDNIGHT - 1 }, MIDNIGHT)
    expect(r.events.map((e) => e.type)).not.toContain('agent_aged')
  })
})

describe('worldTick: natural death', () => {
  // seed ag5294: first 'aging' draw ≈ 0.0024647
  it('a 70-year-old dies when chance = base + perYearOver×10 = 0.0025 beats the roll', () => {
    const r = tickTo(
      { ...makeWorld(70 * DAYS_PER_YEAR), tick: MIDNIGHT - 1 },
      MIDNIGHT,
      new RngStreams('ag5294'),
    )
    expect(r.events).toContainEqual({
      type: 'agent_died',
      payload: { agentId: 'a1', cause: 'old_age' },
    })
    expect(r.state.agents.a1!.alive).toBe(false)
  })

  it('a 69-year-old survives the same roll: chance = 0.0023 is under it', () => {
    const r = tickTo(
      { ...makeWorld(69 * DAYS_PER_YEAR), tick: MIDNIGHT - 1 },
      MIDNIGHT,
      new RngStreams('ag5294'),
    )
    expect(r.events.map((e) => e.type)).not.toContain('agent_died')
    expect(r.state.agents.a1!.alive).toBe(true)
  })

  // seed ag87: first 'aging' draw ≈ 0.000223, under the base chance itself
  it('a 60-year-old rolls at base chance; a 59-year-old never rolls', () => {
    const elder = tickTo(
      { ...makeWorld(60 * DAYS_PER_YEAR), tick: MIDNIGHT - 1 },
      MIDNIGHT,
      new RngStreams('ag87'),
    )
    expect(elder.events).toContainEqual({
      type: 'agent_died',
      payload: { agentId: 'a1', cause: 'old_age' },
    })
    const adult = tickTo(
      { ...makeWorld(59 * DAYS_PER_YEAR), tick: MIDNIGHT - 1 },
      MIDNIGHT,
      new RngStreams('ag87'),
    )
    expect(adult.events.map((e) => e.type)).not.toContain('agent_died')
    expect(adult.state.agents.a1!.alive).toBe(true)
  })

  it('old-age death drops held items onto the death tile', () => {
    let s = makeWorld(70 * DAYS_PER_YEAR)
    s = fold(
      s,
      ev('item_spawned', { id: 'item_1', kind: 'wood', qty: 3, loc: { t: 'agent', id: 'a1' } }),
      CFG,
    )
    const r = tickTo({ ...s, tick: MIDNIGHT - 1 }, MIDNIGHT, new RngStreams('ag5294'))
    expect(r.events).toContainEqual({
      type: 'agent_died',
      payload: { agentId: 'a1', cause: 'old_age' },
    })
    expect(r.events).toContainEqual({
      type: 'item_moved',
      payload: { id: 'item_1', loc: { t: 'tile', x: 0, y: 0 } },
    })
    expect(r.state.items.item_1!.loc).toEqual({ t: 'tile', x: 0, y: 0 })
  })

  it('folding the returned events over the input reproduces the returned state', () => {
    const s = { ...makeWorld(70 * DAYS_PER_YEAR), tick: MIDNIGHT - 1 }
    const { replayed, out } = roundTrips(s, CFG, 'ag5294')
    expect(out.events.length).toBeGreaterThan(0)
    expect(replayed).toEqual(out.state)
  })
})
