import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectObservatory } from './socket.js'
import { createWorldStore } from '../state/worldStore.js'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
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
  drop(): void {
    this.readyState = 3
    this.onclose?.()
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
