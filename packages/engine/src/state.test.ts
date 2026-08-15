import { describe, it, expect } from 'vitest'
import { genesisState, fold } from './state.js'
import type { SimEvent } from '@sj/shared'

const ev = (seq: number, type: string, payload: unknown, tick = 0): SimEvent => ({ seq, tick, type, payload })

describe('fold', () => {
  it('spawns, moves, and changes needs', () => {
    let s = genesisState()
    s = fold(s, ev(1, 'agent_spawned', { id: 'a1', x: 2, y: 3 }))
    s = fold(s, ev(2, 'agent_moved', { id: 'a1', x: 4, y: 3 }))
    s = fold(s, ev(3, 'need_changed', { id: 'a1', need: 'hunger', delta: -30 }))
    expect(s.agents.a1).toMatchObject({ x: 4, y: 3, needs: { hunger: 70 } })
  })
  it('clamps needs to [0,100]', () => {
    let s = fold(genesisState(), ev(1, 'agent_spawned', { id: 'a1', x: 0, y: 0 }))
    s = fold(s, ev(2, 'need_changed', { id: 'a1', need: 'energy', delta: -500 }))
    expect(s.agents.a1!.needs.energy).toBe(0)
  })
  it('tick_advanced sets tick from the event', () => {
    const s = fold(genesisState(), ev(1, 'tick_advanced', {}, 42))
    expect(s.tick).toBe(42)
  })
  it('does not mutate its input', () => {
    const s0 = genesisState()
    fold(s0, ev(1, 'agent_spawned', { id: 'a1', x: 0, y: 0 }))
    expect(s0.agents).toEqual({})
  })
  it('throws on unknown event type', () => {
    expect(() => fold(genesisState(), ev(1, 'nope', {}))).toThrow(/unknown event/i)
  })
})
