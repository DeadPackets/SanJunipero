import { describe, expect, it } from 'vitest'
import { ClientMsg, ServerMsg, momentToTick, tickToMoment, PROTOCOL_VERSION } from './protocol.js'

describe('protocol', () => {
  it('round-trips a tick message', () => {
    const msg = { t: 'tick', tick: 42, events: [{ seq: 7, tick: 42, type: 'agent_moved', payload: { id: 'a', x: 1, y: 2 } }] }
    expect(ServerMsg.parse(msg)).toEqual(msg)
  })
  it('rejects unknown keys and unknown discriminants', () => {
    expect(() => ClientMsg.parse({ t: 'hello', v: PROTOCOL_VERSION, lastSeenTick: null, extra: 1 })).toThrow()
    expect(() => ServerMsg.parse({ t: 'mutate_world' })).toThrow()
  })
  it('is at version 2: the snapshot requires laws, so a v1 client cannot be served', () => {
    expect(PROTOCOL_VERSION).toBe(2)
    const snapshot = { t: 'snapshot', tick: 0, seq: 0, state: {}, config: {}, live: true }
    expect(() => ServerMsg.parse(snapshot)).toThrow()
    expect(ServerMsg.parse({ ...snapshot, laws: {} })).toEqual({ ...snapshot, laws: {} })
  })
  it('moment math: day 41 14:30 ↔ tick', () => {
    expect(momentToTick(41, '14:30')).toBe(41 * 1440 + 14 * 60 + 30)
    expect(tickToMoment(41 * 1440 + 870)).toEqual({ day: 41, time: '14:30' })
    expect(momentToTick(41, '24:00')).toBeNaN() // invalid time → NaN, caller rejects
  })
})
