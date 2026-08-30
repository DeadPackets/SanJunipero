import { afterEach, describe, it, expect, vi } from 'vitest'
import { endpoint, feedFor, type Read } from './useEndpoint.js'

/** One reply per read, the last one repeating; `null` is a read the gateway refused. */
const answers = (bodies: unknown[]): ReturnType<typeof vi.fn> => {
  let i = 0
  return vi.fn(() => {
    const body = bodies[Math.min(i++, bodies.length - 1)]
    return Promise.resolve(
      body === null
        ? { ok: false }
        : { ok: true, text: () => Promise.resolve(JSON.stringify(body)) },
    )
  })
}

const good = <T>(data: T): Read<T> => ({ data, loaded: true, failed: false })
const refused = <T>(data: T | null): Read<T> => ({ data, loaded: true, failed: true })

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
    expect(feed.get()).toEqual({ data: null, loaded: false, failed: false })

    feed.subscribe(() => {})
    await settle()
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(feed.get()).toEqual(good({ n: 1 }))
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

    for (const n of [2, 3]) {
      vi.advanceTimersByTime(1000)
      await settle()
      expect(fetchFn).toHaveBeenCalledTimes(n)
    }
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
    expect(feed.get()).toEqual(good({ n: 1 }))

    vi.advanceTimersByTime(1000)
    await settle()
    expect(feed.get()).toEqual(refused({ n: 1 }))
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
    expect(feed.get()).toEqual(refused(null))
  })

  it('does not publish a body the parser rejects', async () => {
    vi.stubGlobal('fetch', answers([{ wrong: true }]))
    const feed = endpoint<number>('/api/thing', () => null)
    feed.subscribe(() => {})
    await settle()
    // a body that arrived is not a refused read: the wire is fine, this panel has nothing
    expect(feed.get()).toEqual({ data: null, loaded: true, failed: false })
  })

  it('never reads at all when there is nothing to read', async () => {
    const fetchFn = answers([{ n: 1 }])
    vi.stubGlobal('fetch', fetchFn)
    const feed = endpoint(null)
    feed.subscribe(() => {})
    await settle()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(feed.get()).toEqual({ data: null, loaded: false, failed: false })
  })

  it('hands back the SAME read object until a new answer lands', async () => {
    vi.stubGlobal('fetch', answers([{ n: 1 }]))
    const feed = endpoint('/api/thing')
    feed.subscribe(() => {})
    await settle()
    expect(feed.get()).toBe(feed.get())
  })
})

describe('the third read state — a refused wire is not an empty town', () => {
  it('★ says a read FAILED, so a page can stop printing its empty state as a fact', async () => {
    vi.stubGlobal('fetch', answers([null]))
    const feed = endpoint('/api/bonds')
    feed.subscribe(() => {})
    await settle()
    expect(feed.get().failed).toBe(true)
    expect(feed.get().loaded).toBe(true)
  })

  it('★ clears it on the next good answer, and keeps the last good one meanwhile', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', answers([{ n: 1 }, null, { n: 2 }]))
    const feed = endpoint<{ n: number }>('/api/bonds', undefined, 1000)
    feed.subscribe(() => {})
    await settle()
    expect(feed.get()).toEqual(good({ n: 1 }))

    vi.advanceTimersByTime(1000)
    await settle()
    expect(feed.get()).toEqual(refused({ n: 1 }))

    vi.advanceTimersByTime(1000)
    await settle()
    expect(feed.get()).toEqual(good({ n: 2 }))
  })

  it('★ reads again on demand — the viewer who asks after the wire dropped', async () => {
    const fetchFn = answers([null, { n: 7 }])
    vi.stubGlobal('fetch', fetchFn)
    const feed = endpoint<{ n: number }>('/api/found')
    feed.subscribe(() => {})
    await settle()
    expect(feed.get().failed).toBe(true)

    feed.retry()
    await settle()
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(feed.get()).toEqual(good({ n: 7 }))
  })
})

describe('a poll over an unchanged answer', () => {
  it('★ hands back the SAME read, so an unchanged body re-renders nothing', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', answers([{ n: 1 }]))
    const feed = endpoint<{ n: number }>('/api/heat', undefined, 1000)
    feed.subscribe(() => {})
    await settle()
    const first = feed.get()

    vi.advanceTimersByTime(1000)
    await settle()
    expect(feed.get()).toBe(first)
  })

  it('★ still lands as a BEAT, so a round driven by the poll keeps turning', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', answers([{ n: 1 }]))
    const feed = endpoint('/api/heat', undefined, 1000)
    feed.subscribe(() => {})
    await settle()
    expect(feed.beat()).toBe(1)

    for (const n of [2, 3]) {
      vi.advanceTimersByTime(1000)
      await settle()
      expect(feed.beat()).toBe(n)
    }
  })

  it('parses a changed body and hands back a new read', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', answers([{ n: 1 }, { n: 2 }]))
    const feed = endpoint<{ n: number }>('/api/heat', undefined, 1000)
    feed.subscribe(() => {})
    await settle()
    const first = feed.get()

    vi.advanceTimersByTime(1000)
    await settle()
    expect(feed.get()).not.toBe(first)
    expect(feed.get()).toEqual(good({ n: 2 }))
  })
})

describe('one read at a time', () => {
  /** A read that only answers when the test says so. */
  const held = (): { fetchFn: ReturnType<typeof vi.fn>; answer: (n: number) => void } => {
    const waiting: ((v: unknown) => void)[] = []
    const fetchFn = vi.fn(() => new Promise((ok) => waiting.push(ok)))
    return {
      fetchFn,
      answer: (n) => {
        waiting.shift()?.({ ok: true, text: () => Promise.resolve(JSON.stringify({ n })) })
      },
    }
  }

  it('★ a beat that lands while a read is in the air waits its turn, never races it', async () => {
    vi.useFakeTimers()
    const { fetchFn, answer } = held()
    vi.stubGlobal('fetch', fetchFn)
    const feed = endpoint<{ n: number }>('/api/thing', undefined, 1000)
    feed.subscribe(() => {})
    vi.advanceTimersByTime(3000)
    expect(fetchFn).toHaveBeenCalledTimes(1)

    answer(1)
    await settle()
    expect(feed.get()).toEqual(good({ n: 1 }))

    vi.advanceTimersByTime(1000)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('abandons the read in the air when the last subscriber leaves', async () => {
    const aborted: boolean[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: { signal: AbortSignal }) => {
        init.signal.addEventListener('abort', () => aborted.push(true))
        return new Promise(() => {})
      }),
    )
    const off = endpoint('/api/thing').subscribe(() => {})
    off()
    expect(aborted).toEqual([true])
  })
})

describe('feedFor — one reader per url, for the life of the session', () => {
  it('hands the same reader back, so an unmounted page does not lose its answer', () => {
    expect(feedFor('/api/x')).toBe(feedFor('/api/x'))
    expect(feedFor('/api/x')).not.toBe(feedFor('/api/y'))
  })

  it('is keyed on the beat too — two beats over one url are two readers', () => {
    expect(feedFor('/api/z', undefined, 1000)).not.toBe(feedFor('/api/z', undefined, 2000))
    expect(feedFor('/api/z', undefined, 1000)).toBe(feedFor('/api/z', undefined, 1000))
  })
})
