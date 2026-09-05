import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLOSE_BAD_HELLO, DEFAULT_CONFIG } from '@sj/shared'
import { connectObservatory } from './socket.js'
import { createWorldStore } from '../state/worldStore.js'

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
  drop(code = 1006): void {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

const SNAPSHOT = {
  t: 'snapshot',
  tick: 0,
  seq: 0,
  state: { tick: 0, agents: {}, structures: {}, items: {} },
  config: DEFAULT_CONFIG,
  laws: {},
  live: true,
}

describe('connectObservatory link status', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
    })
    const session = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => session.get(k) ?? null,
      setItem: (k: string, v: string) => void session.set(k, v),
      removeItem: (k: string) => void session.delete(k),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('reports connecting → online → reconnecting → online across a drop', () => {
    const statuses: string[] = []
    const handle = connectObservatory({
      url: 'ws://test/ws',
      store: createWorldStore(),
      onStatus: (s) => statuses.push(s),
    })
    expect(statuses).toEqual(['connecting'])

    FakeWebSocket.instances[0]!.open()
    expect(statuses).toEqual(['connecting', 'online'])

    FakeWebSocket.instances[0]!.drop()
    expect(statuses).toEqual(['connecting', 'online', 'reconnecting'])

    // retry attempts stay 'reconnecting' — no flicker back to 'connecting'
    vi.advanceTimersByTime(1_000)
    expect(FakeWebSocket.instances).toHaveLength(2)
    FakeWebSocket.instances[1]!.drop()
    expect(statuses).toEqual(['connecting', 'online', 'reconnecting'])

    vi.advanceTimersByTime(2_000)
    FakeWebSocket.instances[2]!.open()
    expect(statuses).toEqual(['connecting', 'online', 'reconnecting', 'online'])
    handle.close()
  })

  /** The server closes a hello it does not know; reconnecting with the same one loops forever
   *  and the tab renders a town that stopped moving. */
  it('★ reloads on a refused hello instead of reconnect-looping', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    const statuses: string[] = []
    connectObservatory({
      url: 'ws://test/ws',
      store: createWorldStore(),
      onStatus: (s) => statuses.push(s),
    })
    FakeWebSocket.instances[0]!.open()
    FakeWebSocket.instances[0]!.drop(CLOSE_BAD_HELLO)

    expect(reload).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30_000)
    expect(FakeWebSocket.instances, 'it reconnected into the same refusal').toHaveLength(1)
    expect(statuses).toEqual(['connecting', 'online'])
  })

  /** No protocol version bump, so a tab from before a frame changed keeps its socket. It must
   *  ignore what it cannot read rather than throw out of onmessage. */
  it('★ ignores a frame it cannot read instead of taking the viewer down', () => {
    const store = createWorldStore()
    connectObservatory({ url: 'ws://test/ws', store })
    FakeWebSocket.instances[0]!.open()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(() => {
      FakeWebSocket.instances[0]!.onmessage?.({ data: '{"t":"from_the_future","x":1}' })
      FakeWebSocket.instances[0]!.onmessage?.({ data: 'not json at all' })
    }).not.toThrow()
    expect(store.getState()).toBeNull()
    expect(warn, 'a bad frame per tick is a console nobody can read').toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  /** The store cannot reload the page; the socket already knows how, for the same reason. */
  it('★ reloads on a snapshot this bundle cannot read', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    const store = createWorldStore()
    connectObservatory({ url: 'ws://test/ws', store })
    FakeWebSocket.instances[0]!.open()
    const snapshot = { ...SNAPSHOT, config: { mystery: 1 } }
    FakeWebSocket.instances[0]!.onmessage?.({ data: JSON.stringify(snapshot) })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  /** A bundle Cloudflare still serves after a protocol bump refuses the SAME hello after the
   *  reload; without a guard every open tab fetches it again about once a second, forever. */
  it('★ reloads once for a refusal, then reconnects instead of looping', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    connectObservatory({ url: 'ws://test/ws', store: createWorldStore() })
    FakeWebSocket.instances[0]!.open()
    FakeWebSocket.instances[0]!.drop(CLOSE_BAD_HELLO)
    expect(reload).toHaveBeenCalledTimes(1)

    // the reload happened: the same bundle comes back up and is refused again
    FakeWebSocket.instances = []
    const statuses: string[] = []
    connectObservatory({
      url: 'ws://test/ws',
      store: createWorldStore(),
      onStatus: (s) => statuses.push(s),
    })
    FakeWebSocket.instances[0]!.open()
    FakeWebSocket.instances[0]!.drop(CLOSE_BAD_HELLO)
    expect(reload, 'a second refusal must not fetch the bundle again').toHaveBeenCalledTimes(1)
    expect(statuses.at(-1)).toBe('reconnecting')
  })

  it('★ reloads once for a snapshot this bundle cannot read, and not again', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    const bad = JSON.stringify({ ...SNAPSHOT, config: { mystery: 1 } })
    for (const _ of [0, 1]) {
      FakeWebSocket.instances = []
      connectObservatory({ url: 'ws://test/ws', store: createWorldStore() })
      FakeWebSocket.instances[0]!.open()
      FakeWebSocket.instances[0]!.onmessage?.({ data: bad })
    }
    expect(reload).toHaveBeenCalledTimes(1)
  })

  /** A tab that came back and READ the town is not out of date; the next real mismatch must
   *  still be allowed its one reload. */
  it('★ a snapshot the bundle can read clears the once-guard', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    const bad = JSON.stringify({ ...SNAPSHOT, config: { mystery: 1 } })
    connectObservatory({ url: 'ws://test/ws', store: createWorldStore() })
    FakeWebSocket.instances[0]!.open()
    FakeWebSocket.instances[0]!.onmessage?.({ data: bad })
    expect(reload).toHaveBeenCalledTimes(1)

    FakeWebSocket.instances = []
    const store = createWorldStore()
    connectObservatory({ url: 'ws://test/ws', store })
    FakeWebSocket.instances[0]!.open()
    FakeWebSocket.instances[0]!.onmessage?.({ data: JSON.stringify(SNAPSHOT) })
    expect(store.getState()).not.toBeNull()
    FakeWebSocket.instances[0]!.onmessage?.({ data: bad })
    expect(reload).toHaveBeenCalledTimes(2)
  })

  /** A delta that will not fold leaves a half-folded town; only the server's own state is one. */
  it('★ asks to go live again when the store cannot take a delta', () => {
    const store = createWorldStore()
    connectObservatory({ url: 'ws://test/ws', store })
    const sock = FakeWebSocket.instances[0]!
    sock.open()
    const ghost = { seq: 1, tick: 1, type: 'agent_moved', payload: { id: 'ghost', x: 1, y: 1 } }
    sock.onmessage?.({ data: JSON.stringify(SNAPSHOT) })
    sock.onmessage?.({ data: JSON.stringify({ t: 'tick', tick: 1, seq: 1, events: [ghost] }) })
    expect(sock.sent.at(-1)).toBe('{"t":"live"}')
  })

  /** The server defers a scrub asked inside its coalescing window; press Live in that window
   *  and the answer lands after the snapshot. */
  it('★ drops a scrub answered after the viewer went back to the live edge', () => {
    const store = createWorldStore()
    const handle = connectObservatory({ url: 'ws://test/ws', store })
    const sock = FakeWebSocket.instances[0]!
    sock.open()
    sock.onmessage?.({ data: JSON.stringify(SNAPSHOT) })
    handle.scrub(5)
    handle.goLive()
    sock.onmessage?.({
      data: JSON.stringify({ t: 'scrubbed', reqId: 1, tick: 5, state: SNAPSHOT.state }),
    })
    expect(store.getMode()).toEqual({ live: true })
  })

  /** The same reqId ladder a scrub climbs: an answer for a moment the viewer has left is stale
   *  whichever frame carries it. */
  it('★ asks for a replay, and drops one answered after the viewer went back to now', () => {
    const store = createWorldStore()
    const handle = connectObservatory({ url: 'ws://test/ws', store })
    const sock = FakeWebSocket.instances[0]!
    sock.open()
    sock.onmessage?.({ data: JSON.stringify(SNAPSHOT) })

    handle.replay(7)
    expect(sock.sent.at(-1)).toBe('{"t":"replay","from":7,"reqId":1}')
    sock.onmessage?.({
      data: JSON.stringify({ t: 'replaying', reqId: 1, tick: 7, seq: 3, state: SNAPSHOT.state }),
    })
    expect(store.getMode()).toEqual({ live: false, replaying: true, tick: 7 })

    handle.goLive()
    sock.onmessage?.({
      data: JSON.stringify({ t: 'replaying', reqId: 1, tick: 7, seq: 3, state: SNAPSHOT.state }),
    })
    expect(store.getMode()).toEqual({ live: false, replaying: true, tick: 7 })
    sock.onmessage?.({ data: JSON.stringify(SNAPSHOT) })
    expect(store.getMode()).toEqual({ live: true })
  })

  /** `sj:lastSeenTick` is what decides whether the next visit is offered a digest of the days it
   *  missed. A replayed minute is one this viewer is watching, not one it slept through. */
  it('★ never stores a replayed minute as the last minute this viewer saw', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem })
    const store = createWorldStore()
    const handle = connectObservatory({ url: 'ws://test/ws', store })
    const sock = FakeWebSocket.instances[0]!
    sock.open()
    sock.onmessage?.({ data: JSON.stringify(SNAPSHOT) })
    setItem.mockClear()

    handle.replay(1)
    sock.onmessage?.({
      data: JSON.stringify({ t: 'replaying', reqId: 1, tick: 1, seq: 0, state: SNAPSHOT.state }),
    })
    const adv = { seq: 1, tick: 1, type: 'tick_advanced', payload: {} }
    sock.onmessage?.({ data: JSON.stringify({ t: 'tick', tick: 1, seq: 1, events: [adv] }) })
    expect(store.getTick(), 'the replayed minute did land').toBe(1)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('a deliberate close() never reports reconnecting', () => {
    const statuses: string[] = []
    const handle = connectObservatory({
      url: 'ws://test/ws',
      store: createWorldStore(),
      onStatus: (s) => statuses.push(s),
    })
    FakeWebSocket.instances[0]!.open()
    handle.close()
    FakeWebSocket.instances[0]!.drop()
    expect(statuses).toEqual(['connecting', 'online'])
  })
})
