import Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { PublicUsageSchema } from '@sj/shared'
import { publicUsageReader } from './publicUsage.js'

const opened: Database.Database[] = []
afterEach(() => {
  for (const db of opened.splice(0)) db.close()
})
function ledger() {
  const db = new Database(':memory:')
  opened.push(db)
  db.exec(`CREATE TABLE llm_calls (
    ts INTEGER, cost_usd REAL, input_tokens INTEGER, output_tokens INTEGER,
    cache_read_tokens INTEGER, reasoning_tokens INTEGER, agent_id TEXT, prompt TEXT
  )`)
  return db
}

it('publishes only aggregate totals and keeps cached/reasoning subsets out of the sum', () => {
  const db = ledger()
  db.exec(`CREATE TABLE llm_reservations (caller TEXT, reserved_usd REAL);
    INSERT INTO llm_reservations VALUES ('secret-caller', 77);
    CREATE TABLE spend_limits (operator_secret TEXT);
    INSERT INTO spend_limits VALUES ('secret-budget')`)
  const now = 200_000_000
  db.prepare('INSERT INTO llm_calls VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    now - 1000,
    0.5,
    100,
    50,
    80,
    30,
    'private-resident',
    'private prompt',
  )
  db.prepare('INSERT INTO llm_calls VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    now - 86_400_001,
    1.5,
    200,
    100,
    100,
    60,
    'another-resident',
    'another prompt',
  )
  const result = publicUsageReader(
    () => ({ live: true, mindStatus: 'active', db }),
    () => now,
  )()
  expect(PublicUsageSchema.parse(result)).toEqual({
    mode: 'live',
    mindStatus: 'active',
    updatedAt: now,
    total: { calls: 2, usd: 2, inputTokens: 300, outputTokens: 150, cachedInputTokens: 180 },
    last24h: { calls: 1, usd: 0.5, inputTokens: 100, outputTokens: 50, cachedInputTokens: 80 },
  })
  expect(JSON.stringify(result)).not.toContain('private')
  expect(JSON.stringify(result)).not.toContain('reasoning')
  expect(JSON.stringify(result)).not.toContain('secret')
  expect(JSON.stringify(result)).not.toContain('reserv')
})

it.each(['active', 'delayed', 'budget-stopped'] as const)(
  'reports %s independently of the moving world clock',
  (mindStatus) => {
    const db = ledger()
    const read = publicUsageReader(
      () => ({ live: true, db, mindStatus }),
      () => 0,
    )
    expect(read()).toMatchObject({ mode: 'live', mindStatus, total: { calls: 0 } })
  },
)

it('shares one aggregate read across viewers for ten seconds and updates the rolling window', () => {
  const db = ledger()
  let at = 200_000_000
  let reads = 0
  db.prepare('INSERT INTO llm_calls VALUES (?, 1, 10, 20, 5, 10, NULL, NULL)').run(at - 86_399_000)
  const read = publicUsageReader(
    () => {
      reads++
      return { live: true, mindStatus: 'active', db }
    },
    () => at,
  )
  const first = read()
  for (let i = 0; i < 500; i++) expect(read()).toBe(first)
  expect(reads).toBe(1)
  at += 10_001
  const next = read()
  expect(reads).toBe(2)
  expect(next.last24h?.calls).toBe(0)
  expect(next.total?.calls).toBe(1)
})

it('distinguishes a confirmed free preview from missing or unreadable live usage', () => {
  expect(
    publicUsageReader(
      () => ({ live: false, mindStatus: 'disabled', db: null }),
      () => 0,
    )(),
  ).toMatchObject({ mode: 'scripted', total: { calls: 0, usd: 0 } })
  expect(
    publicUsageReader(
      () => ({ live: true, mindStatus: 'active', db: null }),
      () => 0,
    )(),
  ).toEqual({
    mode: 'unavailable',
    mindStatus: 'delayed',
    updatedAt: 0,
    total: null,
    last24h: null,
  })
  expect(
    publicUsageReader(
      () => null,
      () => 0,
    )().mode,
  ).toBe('unavailable')
  const db = ledger()
  db.exec('DROP TABLE llm_calls')
  expect(
    publicUsageReader(
      () => ({ live: true, mindStatus: 'active', db }),
      () => 0,
    )().mode,
  ).toBe('unavailable')
})
