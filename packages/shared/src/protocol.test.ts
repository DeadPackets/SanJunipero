import { describe, expect, it } from 'vitest'
import { ClientMsg, ServerMsg, momentToTick, tickToMoment, PROTOCOL_VERSION } from './protocol.js'

describe('protocol', () => {
  it('round-trips a tick message', () => {
    const msg = {
      t: 'tick',
      tick: 42,
      seq: 7,
      events: [{ seq: 7, tick: 42, type: 'agent_moved', payload: { id: 'a', x: 1, y: 2 } }],
    }
    expect(ServerMsg.parse(msg)).toEqual(msg)
    // The invalidation signal: a tick with no `seq` leaves a read model nothing to key on.
    const { seq: _seq, ...noSeq } = msg
    expect(() => ServerMsg.parse(noSeq)).toThrow()
  })

  it('★ hands a greeted socket the codex in one frame, not one frame per record', () => {
    const record = {
      id: 'house-1',
      seq: 1,
      class: 'building',
      desc: 'a house',
      kind: 'house',
      meta: null,
      footprint: { w: 2, h: 2 },
      widthPx: 4,
      heightPx: 4,
      status: 'placeholder',
      score: null,
      attempts: 1,
      costUsd: 0,
      createdAt: '2026-01-01',
    }
    const records = [record, { ...record, id: 'house-2', seq: 2 }]
    expect(ServerMsg.parse({ t: 'assets', records })).toEqual({ t: 'assets', records })
    expect(() => ServerMsg.parse({ t: 'asset', record })).toThrow()
  })
  it('rejects unknown keys and unknown discriminants', () => {
    expect(() =>
      ClientMsg.parse({ t: 'hello', v: PROTOCOL_VERSION, lastSeenTick: null, extra: 1 }),
    ).toThrow()
    expect(() => ServerMsg.parse({ t: 'mutate_world' })).toThrow()
  })

  // ★ Nobody reads it, and a hello without it was closed as a version mismatch.
  it('★ takes a hello that has drawn nothing yet, with or without the mark', () => {
    expect(ClientMsg.parse({ t: 'hello', v: PROTOCOL_VERSION })).toEqual({
      t: 'hello',
      v: PROTOCOL_VERSION,
    })
    expect(ClientMsg.parse({ t: 'hello', v: PROTOCOL_VERSION, lastSeenTick: 12 })).toEqual({
      t: 'hello',
      v: PROTOCOL_VERSION,
      lastSeenTick: 12,
    })
  })
  it('carries a scene as state, and closes one with a summary', () => {
    const open = {
      t: 'scene',
      scene: {
        id: 's1',
        kind: 'quarrel',
        participants: ['kamal', 'leyla'],
        topic: 'the fire pit',
        stakes: 7,
        open: true,
      },
    }
    expect(ServerMsg.parse(open)).toEqual(open)
    const closed = { ...open, scene: { ...open.scene, open: false, summary: 'They settled it.' } }
    expect(ServerMsg.parse(closed)).toEqual(closed)
    expect(() => ServerMsg.parse({ ...open, scene: { ...open.scene, kind: 'gossip' } })).toThrow()
    expect(() => ServerMsg.parse({ ...open, scene: { ...open.scene, stakes: 11 } })).toThrow()
  })
  it('★ a thought travels with the weight the mind gave it, so the viewer can gate on it', () => {
    const msg = { t: 'thought', agentId: 'omar', tick: 400, text: 'The wall leans.', importance: 7 }
    expect(ServerMsg.parse(msg)).toEqual(msg)
    // Unweighed is not a thought this protocol carries: the gate would have nothing to read.
    const { importance: _i, ...noWeight } = msg
    expect(() => ServerMsg.parse(noWeight)).toThrow()
    expect(() => ServerMsg.parse({ ...msg, importance: 0 })).toThrow()
    expect(() => ServerMsg.parse({ ...msg, importance: 11 })).toThrow()
  })

  it('is at version 8: a v7 viewer polls a heat the town no longer keeps', () => {
    expect(PROTOCOL_VERSION).toBe(8)
    const snapshot = { t: 'snapshot', tick: 0, seq: 0, state: {}, config: {}, live: true }
    expect(() => ServerMsg.parse(snapshot)).toThrow()
    expect(ServerMsg.parse({ ...snapshot, laws: {} })).toEqual({ ...snapshot, laws: {} })
  })

  it('carries the cut and the act, and refuses a cut with nobody in it', () => {
    const cut = {
      t: 'director',
      tick: 850,
      cut: {
        sceneId: 'scene_850_abcd1234',
        agentIds: ['nadia'],
        score: 24,
        why: 'Nadia — a slight',
      },
      quiet: false,
      act: 'II',
    }
    expect(ServerMsg.parse(cut)).toEqual(cut)
    // The quiet round turns on this, so the shape must allow it.
    expect(ServerMsg.parse({ ...cut, cut: null, act: null })).toEqual({
      ...cut,
      cut: null,
      act: null,
    })
    expect(() => ServerMsg.parse({ ...cut, cut: { ...cut.cut, agentIds: [] } })).toThrow()
    expect(() => ServerMsg.parse({ ...cut, cut: { ...cut.cut, why: '' } })).toThrow()
    expect(() => ServerMsg.parse({ ...cut, act: 'IV' })).toThrow()
    // A body-level cut belongs to nobody's scene, and says so rather than inventing one.
    expect(ServerMsg.parse({ ...cut, cut: { ...cut.cut, sceneId: null } })).toBeTruthy()
  })

  it('carries a replay: the ask names a minute, the answer names the log head at it', () => {
    const ask = { t: 'replay', from: 41 * 1440, reqId: 3 }
    expect(ClientMsg.parse(ask)).toEqual(ask)
    expect(() => ClientMsg.parse({ ...ask, from: -1 })).toThrow()
    const opened = { t: 'replaying', reqId: 3, tick: 41 * 1440, seq: 900, state: {} }
    expect(ServerMsg.parse(opened)).toEqual(opened)
    // the seq is what the viewer winds its guard back to, so it may not be left off
    const { seq: _seq, ...noSeq } = opened
    expect(() => ServerMsg.parse(noSeq)).toThrow()
  })
  it('moment math: day 41 14:30 ↔ tick', () => {
    expect(momentToTick(41, '14:30')).toBe(41 * 1440 + 14 * 60 + 30)
    expect(tickToMoment(41 * 1440 + 870)).toEqual({ day: 41, time: '14:30' })
    expect(momentToTick(41, '24:00')).toBeNaN() // invalid time → NaN, caller rejects
  })
})
