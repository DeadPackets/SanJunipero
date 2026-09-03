import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { connectObservatory } from '../net/socket.js'
import { createWorldStore } from '../state/worldStore.js'
import { cameraClaim } from './DirectorMode.js'
import { pointPlay, watchMomentEnd } from './replayRun.js'

/** The socket the viewer really opens, with the wire in a list instead of on a network. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  readyState = 0
  sent: string[] = []
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(s: string): void {
    this.sent.push(s)
  }
  close(): void {
    this.readyState = 3
  }
  open(): void {
    this.readyState = 1
    this.onopen?.()
  }
}

const GRAVE_TICK = 1500
const LIVE_TICK = 4320 // day 3, so the unbounded replay this replaces was 2,820 minutes long

const body = (id: string, x: number) => ({
  id,
  name: id === 'a1' ? 'Rahel' : 'Tomas',
  x,
  y: 4,
  alive: true,
  hp: 10,
  needs: {},
  inventory: [],
})

const worldAt = (tick: number): unknown => ({
  tick,
  agents: { a1: body('a1', 3), a2: body('a2', 4) },
  structures: {},
  items: {},
})

describe('★ ACCEPTANCE — clicking “the first grave” in the Chronicle', () => {
  let sock: FakeWebSocket
  let store: ReturnType<typeof createWorldStore>
  let handle: ReturnType<typeof connectObservatory>

  const frames = (): { t: string; [k: string]: unknown }[] =>
    sock.sent.map((s) => JSON.parse(s) as { t: string })

  const deliver = (msg: unknown): void => {
    sock.onmessage?.({ data: JSON.stringify(msg) })
  }

  /** One recorded minute, exactly as the hub replays it. */
  const recordedTick = (tick: number, seq: number): void => {
    deliver({
      t: 'tick',
      tick,
      seq,
      events: [{ seq, tick, type: 'tick_advanced', payload: {} }],
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined })
    store = createWorldStore()
    handle = connectObservatory({ url: 'ws://test/ws', store })
    sock = FakeWebSocket.instances[0]!
    sock.open()
    deliver({
      t: 'snapshot',
      tick: LIVE_TICK,
      seq: 900,
      state: worldAt(LIVE_TICK),
      config: DEFAULT_CONFIG,
      laws: {},
      live: true,
    })
  })

  afterEach(() => {
    handle.close()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('★ the whole thing, end to end: it plays, it frames the cast, and it stops', () => {
    expect(store.getMode().live).toBe(true)
    expect(store.liveEdge()).toBe(LIVE_TICK)

    // THE CLICK. A chronicle row at 1500 that names Rahel, played the way App.onPlay plays it.
    const play = pointPlay(GRAVE_TICK, store.liveEdge(), 'A grave was made for Rahel.', ['a1'])
    expect(play).toEqual({
      from: 1497,
      until: 1510,
      cast: ['a1'],
      title: 'A grave was made for Rahel.',
      tick: 1500,
    })

    const ended: number[] = []
    const off = watchMomentEnd(store, play, (until) => {
      handle.scrub(until)
      ended.push(until)
    })
    handle.replay(play.from)

    // IT ASKS TO PLAY, NOT TO FREEZE. This is the bug: the old path sent `scrub` here.
    expect(frames().at(-1)).toEqual({ t: 'replay', from: 1497, reqId: 1 })

    // THE CAMERA IS ON THE CAST, and the heat round is not consulted for a tick it cannot score.
    expect(cameraClaim(null, null, new Set(), 'a2', play.cast)).toEqual({
      by: 'moment',
      cast: ['a1'],
    })

    // The hub answers with the one fold a replay pays for...
    deliver({ t: 'replaying', reqId: 1, tick: 1497, seq: 300, state: worldAt(1497) })
    expect(store.getMode()).toEqual({ live: false, replaying: true, tick: 1497 })
    expect(store.getTick()).toBe(1497)

    // ...and then the recorded minutes walk forward. THE BODIES MOVE: time is moving.
    let seq = 301
    for (let t = 1498; t <= 1509; t++, seq++) {
      recordedTick(t, seq)
      expect(store.timeMoving(), `tick ${t}`).toBe(true)
      expect(ended, `tick ${t}`).toEqual([])
    }

    // THE VIEW SAYS IT IS A REPLAY for every one of those minutes.
    expect(store.getMode().live).toBe(false)

    // TEN MINUTES AFTER THE GRAVE, it ends — on a still, not on a run at the live edge.
    recordedTick(1510, seq)
    expect(ended).toEqual([1510])
    expect(frames().at(-1)).toEqual({ t: 'scrub', tick: 1510, reqId: 2 })

    deliver({ t: 'scrubbed', reqId: 2, tick: 1510, state: worldAt(1510) })
    expect(store.getMode()).toEqual({ live: false, replaying: false, tick: 1510 })
    expect(store.timeMoving()).toBe(false)
    expect(store.liveEdge()).toBe(LIVE_TICK) // and the live town was never walked in

    // It fires once. A still parked on the end tick is not a second arrival.
    off()
    expect(ended).toEqual([1510])
  })

  it('★ unbounded, this same click was a 2,820-minute sit', () => {
    const play = pointPlay(GRAVE_TICK, store.liveEdge(), 'A grave was made for Rahel.', ['a1'])
    expect(LIVE_TICK - play.from).toBe(2823)
    expect(play.until - play.from).toBe(13)
  })

  it('a replayed minute never moves the watermark the next visit reads', () => {
    const play = pointPlay(GRAVE_TICK, store.liveEdge(), 'x')
    watchMomentEnd(store, play, () => undefined)
    handle.replay(play.from)
    deliver({ t: 'replaying', reqId: 1, tick: 1497, seq: 300, state: worldAt(1497) })
    recordedTick(1498, 301)
    expect(store.liveEdge()).toBe(LIVE_TICK)
  })
})
