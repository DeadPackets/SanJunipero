import { describe, expect, it } from 'vitest'
import { MAX_BUFFERED, OPEN, RESUME_BELOW, SocketHub, type HubSocket } from './hub.js'

function fakeSocket(opts: { buffered?: number; readyState?: number } = {}) {
  const sock = {
    sent: [] as string[],
    bufferedAmount: opts.buffered ?? 0,
    readyState: opts.readyState ?? OPEN,
    send(data: string) { this.sent.push(data) },
  }
  return sock as typeof sock & HubSocket
}

describe('SocketHub', () => {
  it('healthy socket receives every broadcast in order', () => {
    const hub = new SocketHub()
    const s = fakeSocket()
    hub.add(s, () => '{"t":"snapshot"}')
    hub.broadcast('a')
    hub.broadcast('b')
    hub.broadcast('c')
    expect(s.sent).toEqual(['a', 'b', 'c'])
    expect(hub.size()).toBe(1)
    expect(hub.laggingCount()).toBe(0)
  })

  it('a buffered-up socket is marked lagging and receives nothing', () => {
    const hub = new SocketHub()
    const s = fakeSocket({ buffered: 2 * 1024 * 1024 })
    expect(s.bufferedAmount).toBeGreaterThan(MAX_BUFFERED)
    hub.add(s, () => 'SNAP')
    hub.broadcast('a')
    hub.broadcast('b')
    expect(s.sent).toEqual([])
    expect(hub.laggingCount()).toBe(1)
  })

  it('drained lagging socket gets onResync() first, then the current delta, and lagging clears', () => {
    const hub = new SocketHub()
    const s = fakeSocket({ buffered: 2 * 1024 * 1024 })
    hub.add(s, () => 'SNAP')
    hub.broadcast('a')            // marks lagging, drops
    expect(s.sent).toEqual([])
    s.bufferedAmount = 0
    expect(s.bufferedAmount).toBeLessThan(RESUME_BELOW)
    hub.broadcast('b')
    expect(s.sent).toEqual(['SNAP', 'b'])
    expect(hub.laggingCount()).toBe(0)
    hub.broadcast('c')
    expect(s.sent).toEqual(['SNAP', 'b', 'c'])
  })

  it('still-buffered lagging socket keeps dropping', () => {
    const hub = new SocketHub()
    const s = fakeSocket({ buffered: 2 * 1024 * 1024 })
    hub.add(s, () => 'SNAP')
    hub.broadcast('a')
    s.bufferedAmount = RESUME_BELOW + 1   // not drained enough
    hub.broadcast('b')
    expect(s.sent).toEqual([])
    expect(hub.laggingCount()).toBe(1)
  })

  it('closed socket is skipped and removed on next broadcast', () => {
    const hub = new SocketHub()
    const s = fakeSocket({ readyState: 3 })
    hub.add(s, () => 'SNAP')
    expect(hub.size()).toBe(1)
    hub.broadcast('a')
    expect(s.sent).toEqual([])
    expect(hub.size()).toBe(0)
  })

  it('remove() unsubscribes', () => {
    const hub = new SocketHub()
    const s = fakeSocket()
    const remove = hub.add(s, () => 'SNAP')
    hub.broadcast('a')
    remove()
    hub.broadcast('b')
    expect(s.sent).toEqual(['a'])
    expect(hub.size()).toBe(0)
  })
})
