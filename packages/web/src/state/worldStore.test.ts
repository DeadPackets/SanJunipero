import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, stateHash, type AssetRecord, type SimEvent } from '@sj/shared'
import { fold, genesisState, type TileId } from '@sj/engine'
import { createWorldStore } from './worldStore.js'

const GRASS: TileId[][] = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 0 as TileId))

const spawn: SimEvent = {
  seq: 1, tick: 1, type: 'agent_spawned',
  payload: { id: 'walker', name: 'Walker', x: 0, y: 0, ageDays: 7300 },
} as SimEvent

function makeSnapshot() {
  const state = fold(genesisState(DEFAULT_CONFIG, GRASS), spawn, DEFAULT_CONFIG)
  return {
    t: 'snapshot' as const, tick: state.tick, seq: 1,
    state: JSON.parse(JSON.stringify(state)), config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)), laws: {}, live: true,
  }
}

const record: AssetRecord = {
  id: 'asset_1', seq: 1, class: 'building', desc: 'house: timber', kind: 'house', footprint: { w: 2, h: 2 },
  widthPx: 4, heightPx: 4, status: 'placeholder', score: null, attempts: 1, costUsd: 0,
  createdAt: '2026-08-16 00:00:00', meta: null,
}

describe('worldStore', () => {
  it('snapshot sets state and adopts the carried config strictly', () => {
    const store = createWorldStore()
    expect(store.getState()).toBeNull()
    const snap = makeSnapshot()
    store.applyServer(snap)
    expect(stateHash(store.getState())).toBe(stateHash(snap.state))
    expect(store.getMode()).toEqual({ live: true })

    const bad = { ...makeSnapshot(), config: { ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)), mystery: 1 } }
    expect(() => store.applyServer(bad)).toThrow()
  })

  it('tick messages fold with the adopted config, bit-identical to the engine fold', () => {
    const store = createWorldStore()
    const snap = makeSnapshot()
    store.applyServer(snap)
    // a real delta always leads with tick_advanced, then the tick's events
    const adv: SimEvent = { seq: 2, tick: 2, type: 'tick_advanced', payload: {} } as SimEvent
    const ev: SimEvent = { seq: 3, tick: 2, type: 'agent_moved', payload: { id: 'walker', x: 1, y: 2 } } as SimEvent
    store.applyServer({ t: 'tick', tick: 2, events: [adv, ev] })
    const reference = fold(fold(snap.state, adv, DEFAULT_CONFIG), ev, DEFAULT_CONFIG)
    expect(stateHash(store.getState())).toBe(stateHash(JSON.parse(JSON.stringify(reference))))
    expect(store.getTick()).toBe(2)
  })

  it('scrubbed pauses at the past moment; a live snapshot resumes', () => {
    const store = createWorldStore()
    const snap = makeSnapshot()
    store.applyServer(snap)
    store.applyServer({ t: 'scrubbed', reqId: 1, tick: 1, state: snap.state })
    expect(store.getMode()).toEqual({ live: false, tick: 1 })
    expect(store.getTick()).toBe(1)
    store.applyServer(makeSnapshot())
    expect(store.getMode()).toEqual({ live: true })
  })

  it('thoughts feed latestThought and a 200-entry capped log', () => {
    const store = createWorldStore()
    store.applyServer({ t: 'thought', agentId: 'walker', tick: 3, text: 'First.' })
    store.applyServer({ t: 'thought', agentId: 'walker', tick: 4, text: 'Second.' })
    expect(store.latestThought('walker')).toEqual({ tick: 4, text: 'Second.' })
    expect(store.latestThought('nobody')).toBeNull()
    for (let i = 0; i < 205; i++) store.applyServer({ t: 'thought', agentId: 'other', tick: 5 + i, text: `t${i}` })
    expect(store.thoughtsLog()).toHaveLength(200)
    expect(store.thoughtsLog()[0]!.text).toBe('t5') // oldest 7 dropped (2 walker + t0..t4)
  })

  it('asset pushes bump assetsSeq and accumulate records', () => {
    const store = createWorldStore()
    expect(store.assetsSeq()).toBe(0)
    store.applyServer({ t: 'asset', record })
    expect(store.assetsSeq()).toBe(1)
    expect(store.assetRecords()).toEqual([record])
  })

  it('onEvents fires per delta and recentEvents keeps the last 400', () => {
    const store = createWorldStore()
    store.applyServer(makeSnapshot())
    const seen: SimEvent[][] = []
    store.onEvents(evts => seen.push(evts))
    const events: SimEvent[] = Array.from({ length: 401 }, (_, i) => ({
      seq: 2 + i, tick: 2, type: 'agent_spoke', payload: { agentId: 'walker', text: 'hm', x: 0, y: 0 },
    }) as SimEvent)
    store.applyServer({ t: 'tick', tick: 2, events })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toHaveLength(401)
    expect(store.recentEvents()).toHaveLength(400)
    expect(store.recentEvents()[0]!.seq).toBe(3)
  })

  // M1: the ring was ~95% need_changed, so the Chronicle badge counted 400 while the panel
  // it labels could render none of them. The ring now holds only what the chronicle narrates.
  it('keeps only narratable events in the ring, while every event still folds and fans out', () => {
    const store = createWorldStore()
    store.applyServer(makeSnapshot())
    const seen: SimEvent[][] = []
    store.onEvents(evts => seen.push(evts))
    const noise: SimEvent[] = Array.from({ length: 20 }, (_, i) => ({
      seq: 10 + i, tick: 3, type: 'need_changed', payload: { id: 'walker', need: 'hunger', delta: -1 },
    }) as SimEvent)
    const spoke = { seq: 40, tick: 3, type: 'agent_spoke', payload: { agentId: 'walker', text: 'hm', x: 0, y: 0 } } as SimEvent
    const advanced = { seq: 41, tick: 3, type: 'tick_advanced', payload: {} } as SimEvent
    store.applyServer({ t: 'tick', tick: 3, events: [advanced, ...noise, spoke] })

    expect(seen[0]).toHaveLength(22)                       // the raw delta is untouched
    expect(store.recentEvents().map(e => e.type)).toEqual(['agent_spoke'])
  })

  it('subscribe notifies with no frame to wait for, and unsubscribes cleanly', () => {
    const store = createWorldStore()
    let n = 0
    const off = store.subscribe(() => n++)
    store.applyServer(makeSnapshot())
    expect(n).toBe(1)
    off()
    store.applyServer({ t: 'thought', agentId: 'a', tick: 1, text: 'x' })
    expect(n).toBe(1)
  })

  it('coalesces a burst of messages into ONE subscriber pass per frame', () => {
    const frames: Array<() => void> = []
    const g = globalThis as { requestAnimationFrame?: unknown }
    const had = 'requestAnimationFrame' in g
    const prev = g.requestAnimationFrame
    g.requestAnimationFrame = (fn: () => void) => { frames.push(fn); return frames.length }
    try {
      const store = createWorldStore()
      let n = 0
      store.subscribe(() => n++)
      store.applyServer(makeSnapshot())
      for (let i = 0; i < 40; i++) {
        store.applyServer({ t: 'thought', agentId: 'a', tick: 1, text: `t${i}` })
      }
      expect(n).toBe(0)                    // nothing has been drawn yet
      expect(frames).toHaveLength(1)       // one frame asked for, not forty-one
      frames.pop()!()
      expect(n).toBe(1)
      expect(store.thoughtsLog()).toHaveLength(40)   // every message still applied
      store.applyServer({ t: 'thought', agentId: 'a', tick: 2, text: 'next' })
      expect(frames).toHaveLength(1)       // the next burst asks for the next frame
    } finally {
      if (had) g.requestAnimationFrame = prev
      else delete g.requestAnimationFrame
    }
  })
})
