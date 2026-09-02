import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APICallError } from 'ai'
import {
  AdaptiveLimiter,
  RateLimitWaitError,
  limiterFor,
  rateLimited,
  resetLimiters,
  retryAfterMs,
} from './rateLimiter.js'

const refused = (headers?: Record<string, string>): APICallError =>
  new APICallError({
    message: 'Provider returned error',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 429,
    ...(headers === undefined ? {} : { responseHeaders: headers }),
  })

// Nothing here may wait on a real clock: the gate's whole job is measured in seconds.
beforeEach(() => {
  vi.useFakeTimers()
  resetLimiters()
})
afterEach(() => {
  vi.useRealTimers()
})

// A promise the test decides the end of, so a call can be held in flight while others queue.
function held<T>(): { promise: Promise<T>; settle: (v: T) => void; fail: (e: unknown) => void } {
  let settle!: (v: T) => void
  let fail!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    settle = res
    fail = rej
  })
  return { promise, settle, fail }
}

describe('Retry-After, as the provider spelled it', () => {
  it('reads whole seconds', () => {
    expect(retryAfterMs(refused({ 'retry-after': '7' }))).toBe(7_000)
  })

  it('reads an HTTP-date as the distance to it', () => {
    const now = Date.parse('2026-09-01T00:00:00Z')
    const at = new Date(now + 9_000).toUTCString()
    expect(retryAfterMs(refused({ 'retry-after': at }), now)).toBe(9_000)
  })

  it('caps a provider that asks for an hour, so one back end cannot freeze the pin', () => {
    expect(retryAfterMs(refused({ 'retry-after': '3600' }))).toBe(60_000)
  })

  it('reads a date already past as no wait at all', () => {
    const now = Date.parse('2026-09-01T00:00:00Z')
    expect(retryAfterMs(refused({ 'retry-after': 'Mon, 31 Aug 2026 23:00:00 GMT' }), now)).toBe(0)
  })

  it('has nothing to say about a header that is absent or nonsense', () => {
    expect(retryAfterMs(refused())).toBeUndefined()
    expect(retryAfterMs(refused({ 'retry-after': '   ' }))).toBeUndefined()
    expect(retryAfterMs(refused({ 'retry-after': 'soon' }))).toBeUndefined()
    expect(retryAfterMs(new Error('429 Too Many Requests'))).toBeUndefined()
  })
})

describe('the cap the refusals set', () => {
  it('holds every call above the cap in the queue rather than at the provider', async () => {
    const gate = new AdaptiveLimiter('pin', 2)
    const calls = [held<string>(), held<string>(), held<string>()]
    let started = 0
    const runs = calls.map((c) =>
      gate.run(() => {
        started += 1
        return c.promise
      }, 10_000),
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(started, 'the third never reached the provider').toBe(2)
    expect(gate.state()).toMatchObject({ cap: 2, inFlight: 2, queued: 1 })

    calls[0]!.settle('a')
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toBe(3)
    calls[1]!.settle('b')
    calls[2]!.settle('c')
    expect(await Promise.all(runs)).toEqual(['a', 'b', 'c'])
  })

  it('lets them through in the order they arrived', async () => {
    const gate = new AdaptiveLimiter('pin', 1)
    const first = held<string>()
    const order: string[] = []
    const runs = [
      gate.run(() => first.promise, 10_000),
      ...['b', 'c', 'd'].map((name) =>
        gate.run(() => {
          order.push(name)
          return Promise.resolve(name)
        }, 10_000),
      ),
    ]
    await vi.advanceTimersByTimeAsync(0)
    expect(order, 'one at a time, and none of them yet').toEqual([])
    first.settle('a')
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all(runs)
    expect(order).toEqual(['b', 'c', 'd'])
  })

  // ★ r3: 27-35% of turn attempts and 44-46% of reflection attempts were refused at the door,
  // because nothing in the process knew how many calls the key already had in flight.
  it('halves the cap on a 429 and holds a cool-down before anyone asks again', async () => {
    const gate = new AdaptiveLimiter('pin', 4)
    const alone = gate.run(() => Promise.reject(refused()), 1_000).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(0)
    expect(await alone).toBeInstanceOf(APICallError)
    expect(gate.state().cap).toBe(2)

    let started = false
    const next = gate.run(() => {
      started = true
      return Promise.resolve('ok')
    }, 10_000)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(started, 'still inside the cool-down the refusal set').toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await next).toBe('ok')
  })

  it('takes the cool-down from Retry-After when the provider named one', async () => {
    const gate = new AdaptiveLimiter('pin', 4)
    await gate.run(() => Promise.reject(refused({ 'retry-after': '30' })), 100).catch(() => null)
    let started = false
    const next = gate
      .run(() => {
        started = true
        return Promise.resolve('ok')
      }, 60_000)
      .catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(29_000)
    expect(started, '30 s was asked for, not the 2 s default').toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await next).toBe('ok')
  })

  it('never halves below one', async () => {
    const gate = new AdaptiveLimiter('pin', 4)
    for (let i = 0; i < 4; i++) {
      await gate.run(() => Promise.reject(refused()), 0).catch(() => null)
      await vi.advanceTimersByTimeAsync(2_000)
    }
    expect(gate.state().cap).toBe(1)
  })

  it('buys a slot back after a clean run, up to the ceiling it started at', async () => {
    const gate = new AdaptiveLimiter('pin', 4)
    await gate.run(() => Promise.reject(refused()), 0).catch(() => null)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(gate.state().cap).toBe(2)
    for (let i = 0; i < 5; i++) await gate.run(() => Promise.resolve('ok'), 0)
    expect(gate.state().cap).toBe(3)
    for (let i = 0; i < 20; i++) await gate.run(() => Promise.resolve('ok'), 0)
    expect(gate.state().cap, 'the ceiling is a ceiling').toBe(4)
  })

  // The whole point of a gate: a refusal our own concurrency caused is worth waiting out, and
  // the caller's retry budget is not spent doing it.
  it('re-queues a caller refused while our own calls were in flight', async () => {
    const gate = new AdaptiveLimiter('pin', 4)
    const busy = held<string>()
    void gate.run(() => busy.promise, 60_000)
    let asks = 0
    const crowded = gate.run(() => {
      asks += 1
      return asks === 1 ? Promise.reject(refused()) : Promise.resolve('ok')
    }, 60_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(asks).toBe(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await crowded).toBe('ok')
    busy.settle('done')
  })

  it('hands a lone caller its 429 straight up, because no cap of ours caused it', async () => {
    const gate = new AdaptiveLimiter('pin', 4)
    let asks = 0
    const err = await gate
      .run(() => {
        asks += 1
        return Promise.reject(refused())
      }, 60_000)
      .catch((e: unknown) => e)
    expect(asks, 'the gate cannot fix a shared pool by asking again').toBe(1)
    expect(err).toBeInstanceOf(APICallError)
  })

  it('passes anything that is not a rate limit straight through', async () => {
    const gate = new AdaptiveLimiter('pin', 4)
    await expect(gate.run(() => Promise.reject(new Error('stalled')), 0)).rejects.toThrow('stalled')
    expect(gate.state().cap, 'a stall says nothing about concurrency').toBe(4)
  })
})

describe('the patience a caller brought', () => {
  it('gives the ask up unsent, as a failure the caller can tell from a refusal', async () => {
    const gate = new AdaptiveLimiter('pin', 1)
    const busy = held<string>()
    void gate.run(() => busy.promise, 60_000)
    let started = false
    const late = gate
      .run(() => {
        started = true
        return Promise.resolve('ok')
      }, 5_000)
      .catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5_000)
    const err = await late
    expect(err).toBeInstanceOf(RateLimitWaitError)
    expect((err as RateLimitWaitError).waitedMs).toBe(5_000)
    expect(started, 'nothing was sent, so nothing was billed').toBe(false)
    expect(gate.state().queued).toBe(0)
    busy.settle('done')
  })

  it('surfaces the 429 it already had rather than the wait that followed it', async () => {
    const gate = new AdaptiveLimiter('pin', 4)
    const busy = held<string>()
    void gate.run(() => busy.promise, 60_000)
    const crowded = gate
      .run(() => Promise.reject(refused({ 'retry-after': '30' })), 5_000)
      .catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await crowded, 'the caller must still classify this as a burst').toBeInstanceOf(
      APICallError,
    )
    busy.settle('done')
  })
})

describe('the one line the operator gets', () => {
  it('says nothing until the cap has been pinned at one for a whole window', async () => {
    const gate = new AdaptiveLimiter('pin', 2)
    await gate.run(() => Promise.reject(refused()), 0).catch(() => null)
    expect(gate.state().cap).toBe(1)
    expect(gate.pinnedAlert()).toBeNull()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(gate.pinnedAlert()).toContain('one call at a time')
  })

  it('says it once, not once per call', async () => {
    const gate = new AdaptiveLimiter('pin', 2)
    await gate.run(() => Promise.reject(refused()), 0).catch(() => null)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(gate.pinnedAlert()).not.toBeNull()
    expect(gate.pinnedAlert()).toBeNull()
  })

  it('is armed again by a pin that recovered and then went single-file once more', async () => {
    const gate = new AdaptiveLimiter('pin', 2)
    await gate.run(() => Promise.reject(refused()), 0).catch(() => null)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(gate.pinnedAlert()).not.toBeNull()
    for (let i = 0; i < 5; i++) await gate.run(() => Promise.resolve('ok'), 0)
    expect(gate.state().cap).toBe(2)
    await gate.run(() => Promise.reject(refused()), 0).catch(() => null)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(gate.pinnedAlert()).not.toBeNull()
  })
})

describe('one gate per back end', () => {
  it('hands the same pin the same gate and a different pin its own', () => {
    expect(limiterFor('glm@Wafer')).toBe(limiterFor('glm@Wafer'))
    expect(limiterFor('glm@Wafer')).not.toBe(limiterFor('deepseek@Inceptron'))
  })

  it('reads its ceiling from the environment', () => {
    vi.stubEnv('LLM_MAX_CONCURRENCY', '2')
    resetLimiters()
    expect(limiterFor('glm@Wafer').state().cap).toBe(2)
    vi.unstubAllEnvs()
  })
})

describe('what counts as a rate limit', () => {
  it('is a 429, or the words a 200-with-error-body uses instead', () => {
    expect(rateLimited(refused())).toBe(true)
    expect(rateLimited(new Error('429 Too Many Requests'))).toBe(true)
    expect(rateLimited(new Error('Rate-limit hit'))).toBe(true)
    expect(rateLimited(new Error('scripted failure'))).toBe(false)
  })
})
