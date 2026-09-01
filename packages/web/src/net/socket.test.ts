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

describe('connectObservatory link status', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
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
    const snapshot = {
      t: 'snapshot',
      tick: 0,
      seq: 1,
      state: {},
      config: { mystery: 1 },
      laws: {},
      live: true,
    }
    FakeWebSocket.instances[0]!.onmessage?.({ data: JSON.stringify(snapshot) })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  /** A delta that will not fold leaves a half-folded town; only the server's own state is one. */
  it('★ asks to go live again when the store cannot take a delta', () => {
    const store = createWorldStore()
    connectObservatory({ url: 'ws://test/ws', store })
    const sock = FakeWebSocket.instances[0]!
    sock.open()
    const ghost = { seq: 1, tick: 1, type: 'agent_moved', payload: { id: 'ghost', x: 1, y: 1 } }
    const snapshot = {
      t: 'snapshot',
      tick: 0,
      seq: 0,
      state: { tick: 0, agents: {}, structures: {}, items: {} },
      config: DEFAULT_CONFIG,
      laws: {},
      live: true,
    }
    sock.onmessage?.({ data: JSON.stringify(snapshot) })
    sock.onmessage?.({ data: JSON.stringify({ t: 'tick', tick: 1, seq: 1, events: [ghost] }) })
    expect(sock.sent.at(-1)).toBe('{"t":"live"}')
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
