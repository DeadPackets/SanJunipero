import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, stateHash, type SimEvent } from '@sj/shared'
import { genesisState } from './state.js'
import { fold } from './fold.js'

const ev = (seq: number, type: string, payload: unknown, tick = 0): SimEvent => ({ seq, tick, type, payload })
const spawn = (id: string, x = 0, y = 0) => ev(1, 'agent_spawned', { id, name: id, x, y, ageDays: 7300 })

describe('fold', () => {
  it('spawns, moves, and changes needs', () => {
    let s = genesisState(DEFAULT_CONFIG)
    s = fold(s, ev(1, 'agent_spawned', { id: 'a1', name: 'a1', x: 2, y: 3, ageDays: 7300 }))
    s = fold(s, ev(2, 'agent_moved', { id: 'a1', x: 4, y: 3 }))
    s = fold(s, ev(3, 'need_changed', { id: 'a1', need: 'hunger', delta: -30 }))
    expect(s.agents.a1).toMatchObject({ x: 4, y: 3, needs: { hunger: 70 } })
  })
  it('clamps needs to [0,100]', () => {
    let s = fold(genesisState(DEFAULT_CONFIG), spawn('a1'))
    s = fold(s, ev(2, 'need_changed', { id: 'a1', need: 'energy', delta: -500 }))
    expect(s.agents.a1!.needs.energy).toBe(0)
  })
  it('accepts the two new need kinds: warmth and social', () => {
    let s = fold(genesisState(DEFAULT_CONFIG), spawn('a1'))
    s = fold(s, ev(2, 'need_changed', { id: 'a1', need: 'warmth', delta: -10 }))
    s = fold(s, ev(3, 'need_changed', { id: 'a1', need: 'social', delta: -20 }))
    expect(s.agents.a1!.needs).toEqual({ hunger: 100, energy: 100, warmth: 90, social: 80 })
  })
  it('tick_advanced sets tick from the event', () => {
    const s = fold(genesisState(DEFAULT_CONFIG), ev(1, 'tick_advanced', {}, 42))
    expect(s.tick).toBe(42)
  })
  it('does not mutate its input', () => {
    const s0 = genesisState(DEFAULT_CONFIG)
    fold(s0, spawn('a1'))
    expect(s0.agents).toEqual({})
  })
  it('throws on unknown event type', () => {
    expect(() => fold(genesisState(DEFAULT_CONFIG), ev(1, 'nope', {}))).toThrow(/unknown event/i)
  })

  it('spawn applies the full v2 default body', () => {
    const s = fold(genesisState(DEFAULT_CONFIG), ev(1, 'agent_spawned', { id: 'a1', name: 'Ada', x: 2, y: 3, ageDays: 9125 }))
    expect(s.agents.a1).toEqual({
      id: 'a1', name: 'Ada', x: 2, y: 3, alive: true, asleep: false,
      needs: { hunger: 100, energy: 100, warmth: 100, social: 100 },
      hp: DEFAULT_CONFIG.health.maxHp, injuries: [], ill: false, ageDays: 9125,
      skills: {}, activity: null, collapsedSinceTick: null, zeroHungerSinceTick: null,
    })
  })

  it('never mutates input state on any branch (deep, via stateHash)', () => {
    let s = genesisState(DEFAULT_CONFIG)
    const branches: SimEvent[] = [
      ev(1, 'tick_advanced', {}, 5),
      ev(2, 'agent_spawned', { id: 'a1', name: 'a1', x: 1, y: 1, ageDays: 7300 }),
      ev(3, 'agent_moved', { id: 'a1', x: 2, y: 2 }),
      ev(4, 'need_changed', { id: 'a1', need: 'social', delta: -3 }),
    ]
    for (const e of branches) {
      const before = stateHash(s)
      const next = fold(s, e)
      expect(stateHash(s)).toBe(before)
      s = next
    }
  })

  it('strict payloads reject an extra key on agent_spawned', () => {
    expect(() => fold(genesisState(DEFAULT_CONFIG), ev(1, 'agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 1, sneaky: true }))).toThrow()
  })
  it('strict payloads reject extra keys on the migrated C1 events', () => {
    let s = fold(genesisState(DEFAULT_CONFIG), spawn('a1'))
    expect(() => fold(s, ev(2, 'tick_advanced', { extra: 1 }, 1))).toThrow()
    expect(() => fold(s, ev(2, 'agent_moved', { id: 'a1', x: 1, y: 1, extra: 1 }))).toThrow()
    expect(() => fold(s, ev(2, 'need_changed', { id: 'a1', need: 'hunger', delta: -1, extra: 1 }))).toThrow()
    void s
  })

  it('bumps counters.nextEntityId on spawn and never lowers it', () => {
    let s = fold(genesisState(DEFAULT_CONFIG), spawn('agent_7'))
    expect(s.counters.nextEntityId).toBe(8)
    s = fold(s, spawn('agent_3'))
    expect(s.counters.nextEntityId).toBe(8)
  })
})
