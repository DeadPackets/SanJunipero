import { afterEach, describe, it, expect, vi } from 'vitest'
import { endpoint } from './useEndpoint.js'

/** One reply per read, the last one repeating; `null` is a read the gateway refused. */
const answers = (bodies: unknown[]): ReturnType<typeof vi.fn> => {
  let i = 0
  return vi.fn(() => {
    const body = bodies[Math.min(i++, bodies.length - 1)]
    return Promise.resolve(
      body === null ? { ok: false } : { ok: true, json: () => Promise.resolve(body) },
    )
  })
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('endpoint', () => {
  it('reads once a subscriber arrives, and hands back the body', async () => {
    const fetchFn = answers([{ n: 1 }])
    vi.stubGlobal('fetch', fetchFn)
    const feed = endpoint<{ n: number }>('/api/thing')
    expect(feed.get()).toEqual({ data: null, loaded: false })

    feed.subscribe(() => {})
    await settle()
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(feed.get()).toEqual({ data: { n: 1 }, loaded: true })
  })

  it('★ serves every subscriber from ONE read — the point of a shared feed', async () => {
    const fetchFn = answers([{ n: 1 }])
    vi.stubGlobal('fetch', fetchFn)
    const feed = endpoint('/api/bonds')
    const woken: number[] = []
    feed.subscribe(() => woken.push(1))
    feed.subscribe(() => woken.push(2))
    await settle()
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(woken).toEqual([1, 2])
  })

  it('★ re-reads on the beat, and stops when the last subscriber leaves', async () => {
    vi.useFakeTimers()
    const fetchFn = answers([{ n: 1 }])
    vi.stubGlobal('fetch', fetchFn)
    const feed = endpoint('/api/bonds', undefined, 1000)
    const off = feed.subscribe(() => {})
    await settle()
    expect(fetchFn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2000)
    expect(fetchFn).toHaveBeenCalledTimes(3)
    off()
    vi.advanceTimersByTime(5000)
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('reads once and never again when given no beat', async () => {
    vi.useFakeTimers()
    const fetchFn = answers([{ n: 1 }])
    vi.stubGlobal('fetch', fetchFn)
    endpoint('/api/lineage').subscribe(() => {})
    await settle()
    vi.advanceTimersByTime(120_000)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('★ keeps the last good answer when a read fails', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', answers([{ n: 1 }, null]))
    const feed = endpoint<{ n: number }>('/api/thing', undefined, 1000)
    feed.subscribe(() => {})
    await settle()
    expect(feed.get()).toEqual({ data: { n: 1 }, loaded: true })

    vi.advanceTimersByTime(1000)
    await settle()
    expect(feed.get()).toEqual({ data: { n: 1 }, loaded: true })
  })

  it('★ wakes its readers on EVERY settled read, refused ones included', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', answers([{ n: 1 }, null]))
    const feed = endpoint<{ n: number }>('/api/heat', undefined, 1000)
    let woken = 0
    feed.subscribe(() => {
      woken++
    })
    await settle()
    expect(woken).toBe(1)

    // the last good answer is kept, and its identity with it — a memo over it must not restart
    const good = feed.get().data
    vi.advanceTimersByTime(1000)
    await settle()
    expect(feed.get().data).toBe(good)
    expect(woken).toBe(2)

    // ★ but the beat still lands, so the round DirectorMode cuts on keeps turning while it is down
    vi.advanceTimersByTime(1000)
    await settle()
    expect(woken).toBe(3)
  })

  it('★ settles `loaded` even when the FIRST read fails — an empty state must print', async () => {
    vi.stubGlobal('fetch', answers([null]))
    const feed = endpoint('/api/chronicle')
    feed.subscribe(() => {})
    await settle()
    expect(feed.get()).toEqual({ data: null, loaded: true })
  })

  it('does not publish a body the parser rejects', async () => {
    vi.stubGlobal('fetch', answers([{ wrong: true }]))
    const feed = endpoint<number>('/api/thing', () => null)
    feed.subscribe(() => {})
    await settle()
    expect(feed.get()).toEqual({ data: null, loaded: true })
  })

  it('never reads at all when there is nothing to read', async () => {
    const fetchFn = answers([{ n: 1 }])
    vi.stubGlobal('fetch', fetchFn)
    const feed = endpoint(null)
    feed.subscribe(() => {})
    await settle()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(feed.get()).toEqual({ data: null, loaded: false })
  })

  it('hands back the SAME read object until a new answer lands', async () => {
    vi.stubGlobal('fetch', answers([{ n: 1 }]))
    const feed = endpoint('/api/thing')
    feed.subscribe(() => {})
    await settle()
    expect(feed.get()).toBe(feed.get())
  })
})
