import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, type SimEvent } from '@sj/shared'
import { TOGGLABLE_PATHS } from '@sj/engine'
import {
  ADMIN_TOKEN_KEY,
  adminToken,
  editRows,
  formatLawValue,
  lawChangesFrom,
  lawRows,
  postLaw,
} from './lawsModel.js'

const ev = (seq: number, tick: number, path: string, value: unknown): SimEvent =>
  ({ seq, tick, type: 'config_changed', payload: { path, value } }) as SimEvent

const DELTAS: SimEvent[] = [
  ev(1, 100, 'mystery.enabled', false),
  { seq: 2, tick: 101, type: 'agent_moved', payload: { id: 'a', x: 1, y: 1 } } as SimEvent,
  ev(3, 200, 'spoilage.storehouseMultiplier', 3),
  ev(4, 300, 'mystery.enabled', true),
]

describe('lawChangesFrom (T25c)', () => {
  it('picks the law flips out of a delta sequence, in order, and nothing else', () => {
    expect(lawChangesFrom(DELTAS)).toEqual([
      { tick: 100, path: 'mystery.enabled', value: false },
      { tick: 200, path: 'spoilage.storehouseMultiplier', value: 3 },
      { tick: 300, path: 'mystery.enabled', value: true },
    ])
  })

  it('an empty stream is an empty history, not a guess', () => {
    expect(lawChangesFrom([])).toEqual([])
  })
})

describe('lawRows (T25c)', () => {
  it('lists every world law once, with the value in force and where it came from', () => {
    const rows = lawRows(DEFAULT_CONFIG, { 'mystery.enabled': false }, lawChangesFrom(DELTAS))
    expect(rows.map((r) => r.path).sort()).toEqual(Object.keys(TOGGLABLE_PATHS).sort())

    const mystery = rows.find((r) => r.path === 'mystery.enabled')!
    expect(mystery.value).toBe(false)
    expect(mystery.overridden).toBe(true)
    expect(mystery.history.map((h) => [h.tick, h.value])).toEqual([
      [100, false],
      [300, true],
    ])

    // A law nobody has touched still reports its standing value, straight from the config.
    const untouched = rows.find((r) => r.path === 'inscription.enabled')!
    expect(untouched.value).toBe(true)
    expect(untouched.overridden).toBe(false)
    expect(untouched.history).toEqual([])
  })

  it('reads a nested path out of the config', () => {
    const rows = lawRows(DEFAULT_CONFIG, {}, [])
    const winter = rows.find((r) => r.path === 'seasons.winter.hungerDecayMultiplier')!
    expect(winter.value).toBe(DEFAULT_CONFIG.seasons.winter.hungerDecayMultiplier)
  })

  it('with no config yet the panel shows the laws it knows and no invented values', () => {
    const rows = lawRows(null, { 'mystery.enabled': false }, [])
    expect(rows.find((r) => r.path === 'mystery.enabled')!.value).toBe(false)
    expect(rows.find((r) => r.path === 'inscription.enabled')!.value).toBeUndefined()
  })
})

describe('formatLawValue (T25c)', () => {
  it('speaks plainly', () => {
    expect(formatLawValue(true)).toBe('on')
    expect(formatLawValue(false)).toBe('off')
    expect(formatLawValue(0.5)).toBe('0.5')
    expect(formatLawValue({ fish: 2 })).toBe('{"fish":2}')
    expect(formatLawValue(undefined)).toBe('—')
  })
})

describe('editRows (T25c)', () => {
  it('one edit per whitelisted law, typed by what the law accepts', () => {
    const rows = editRows(lawRows(DEFAULT_CONFIG, {}, []), 'a-token')
    expect(rows).toHaveLength(Object.keys(TOGGLABLE_PATHS).length)
    expect(rows.find((r) => r.path === 'mystery.enabled')!.kind).toBe('boolean')
    expect(rows.find((r) => r.path === 'mystery.chancePerDay')!.kind).toBe('number')
    expect(rows.find((r) => r.path === 'spoilage.days')!.kind).toBe('other')
    for (const r of rows) expect(r.editable).toBe(r.kind !== 'other')
  })

  it('without a token every edit is disabled', () => {
    for (const token of [null, '']) {
      const rows = editRows(lawRows(DEFAULT_CONFIG, {}, []), token)
      expect(rows.every((r) => !r.editable)).toBe(true)
    }
  })
})

describe('adminToken (T25c)', () => {
  it('is absent unless the operator put one in this session', () => {
    const store = new Map<string, string>()
    const shim = { getItem: (k: string) => store.get(k) ?? null }
    expect(adminToken(shim)).toBeNull()
    store.set(ADMIN_TOKEN_KEY, '  ')
    expect(adminToken(shim)).toBeNull()
    store.set(ADMIN_TOKEN_KEY, 'a-token')
    expect(adminToken(shim)).toBe('a-token')
  })

  it('a storage that throws is simply no token', () => {
    expect(
      adminToken({
        getItem: () => {
          throw new Error('private mode')
        },
      }),
    ).toBeNull()
  })
})

describe('postLaw (T25c)', () => {
  function fakeFetch(status: number, body: string) {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fn = async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return { status, text: async () => body } as Response
    }
    return { fn, calls }
  }

  it('202 is an accepted law, sent with the bearer token', async () => {
    const { fn, calls } = fakeFetch(202, '{"accepted":"mystery.enabled"}')
    const r = await postLaw(fn, {
      endpoint: 'http://127.0.0.1:8788',
      token: 'a-token',
      path: 'mystery.enabled',
      value: false,
    })
    expect(r).toEqual({ ok: true })
    expect(calls[0]!.url).toBe('http://127.0.0.1:8788/admin/laws')
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer a-token')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      path: 'mystery.enabled',
      value: false,
    })
  })

  it('a rejected path surfaces the gateway’s own words, verbatim', async () => {
    const { fn } = fakeFetch(400, '{"error":"needs.hungerDecayPerTick is not a world law"}')
    const r = await postLaw(fn, {
      endpoint: '',
      token: 't',
      path: 'needs.hungerDecayPerTick',
      value: 9,
    })
    expect(r).toEqual({ ok: false, message: 'needs.hungerDecayPerTick is not a world law' })
  })

  it('a body that is not the shape we expect is still shown as it came', async () => {
    const { fn } = fakeFetch(401, 'unauthorized')
    expect(
      await postLaw(fn, { endpoint: '', token: 't', path: 'mystery.enabled', value: false }),
    ).toEqual({
      ok: false,
      message: 'unauthorized',
    })
  })

  it('an unreachable admin channel is a message, not a crash', async () => {
    const fn = async () => {
      throw new Error('failed to fetch')
    }
    expect(
      await postLaw(fn, { endpoint: '', token: 't', path: 'mystery.enabled', value: false }),
    ).toEqual({
      ok: false,
      message: 'failed to fetch',
    })
  })

  it('an accepted law does NOT change the panel — only the delta does', async () => {
    const laws: Record<string, unknown> = {}
    const { fn } = fakeFetch(202, '{}')
    await postLaw(fn, { endpoint: '', token: 't', path: 'mystery.enabled', value: false })

    // Nothing was written locally: the event log is the truth, and it has not spoken yet.
    expect(lawRows(DEFAULT_CONFIG, laws, []).find((r) => r.path === 'mystery.enabled')!.value).toBe(
      true,
    )

    const afterDelta = lawRows(
      DEFAULT_CONFIG,
      { 'mystery.enabled': false },
      lawChangesFrom([ev(1, 500, 'mystery.enabled', false)]),
    )
    const row = afterDelta.find((r) => r.path === 'mystery.enabled')!
    expect(row.value).toBe(false)
    expect(row.history).toEqual([{ tick: 500, path: 'mystery.enabled', value: false }])
  })
})
