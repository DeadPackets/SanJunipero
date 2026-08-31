import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { openDb } from '@sj/engine/store'
import { createLawsAdmin } from './adminLaws.js'
import { adminOpsRoutes, answerRate, MAX_SPEED, type Clock, type CostReport } from './adminOps.js'
import type { LiveOps, PendingRuling } from './liveCast.js'

const TOKEN = 'ops-secret'
const dir = mkdtempSync(join(tmpdir(), 'sj-adminops-'))
const WORLD_DB = join(dir, 'world.db')
const MINDS = join(dir, 'minds')

function fakeClock(): Clock & { speedSet: number } {
  const held = { paused: false, speed: 1, speedSet: 0 }
  return {
    get paused() {
      return held.paused
    },
    get speed() {
      return held.speed
    },
    get speedSet() {
      return held.speedSet
    },
    tick: 12,
    pause: () => {
      held.paused = true
    },
    resume: () => {
      held.paused = false
    },
    setSpeed: (x: number) => {
      held.speed = x
      held.speedSet += 1
    },
  }
}

/** `_ops.db`'s two tables, as `@sj/llm` migrates them — declared here so the observatory's
 *  read model is tested without the model SDK on the scripted path. */
function opsLedger(path: string): Database.Database {
  const db = new Database(path)
  db.exec(`
    CREATE TABLE llm_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, agent_id TEXT,
      caller TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
      cache_read_tokens INTEGER, reasoning_tokens INTEGER, cost_usd REAL, reported_cost_usd REAL,
      latency_ms INTEGER, ok INTEGER, error TEXT, provider TEXT);
    CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, agent_id TEXT,
      kind TEXT, detail TEXT);
  `)
  return db
}

function bill(db: Database.Database, row: Partial<Record<string, unknown>>): void {
  db.prepare(
    `INSERT INTO llm_calls (ts, agent_id, caller, model, input_tokens, output_tokens,
       cache_read_tokens, reasoning_tokens, cost_usd, latency_ms, ok)
     VALUES (@ts, @agentId, @caller, 'm', @input, 0, @cached, 0, @usd, 1, 1)`,
  ).run({ ts: Date.now(), agentId: null, cached: 0, input: 100, ...row })
}

let server: Server
let port: number
let clock: ReturnType<typeof fakeClock>
let ledger: Database.Database
let reverted: { ruleId: number; reason: string; tick: number }[]
let pending: PendingRuling[]
let ops: LiveOps | null

const call = async (
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: string }> => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    ...init,
  })
  return { status: res.status, body: await res.text() }
}

beforeAll(async () => {
  // A world with one act begun, one finished and one abandoned: the answer rate is 1 of 2.
  const world = openDb(WORLD_DB)
  const put = world.prepare('INSERT INTO events (tick, type, payload) VALUES (?, ?, ?)')
  put.run(1, 'action_started', JSON.stringify({ agentId: 'a', verb: 'build' }))
  put.run(2, 'action_completed', JSON.stringify({ agentId: 'a', verb: 'build' }))
  put.run(3, 'action_started', JSON.stringify({ agentId: 'a', verb: 'fish' }))
  put.run(4, 'action_interrupted', JSON.stringify({ agentId: 'a', verb: 'fish' }))
  world.close()

  ledger = opsLedger(join(dir, 'ops.db'))
  bill(ledger, { caller: 'turn', agentId: 'amara', usd: 0.01, cached: 60 })
  bill(ledger, { caller: 'turn', agentId: 'omar', usd: 0.02, cached: 40 })
  bill(ledger, { caller: 'arbiter', usd: 0.05 })

  clock = fakeClock()
  reverted = []
  pending = [{ id: 1, ruleId: 7, recipeId: 'weave', tick: 40 }]
  ops = {
    opsDb: ledger,
    caps: { dailyUsd: 3, lifetimeUsd: 50 },
    alert: () => {},
    rulings: {
      pending: () => pending,
      approve: (ruleId) => {
        if (ruleId !== 7) throw new Error(`no such rule ${ruleId}`)
        pending = []
      },
      revert: (ruleId, reason, tick) => {
        reverted.push({ ruleId, reason, tick })
        pending = []
      },
    },
  }

  server = createLawsAdmin({
    submitLaw: () => {},
    token: TOKEN,
    routes: adminOpsRoutes({
      clock,
      ops: () => ops,
      worldDbPath: WORLD_DB,
      mindsDir: MINDS,
      config: { seed: 'g6' },
    }),
  })
  port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as { port: number }).port)
    })
  })
})

afterAll(async () => {
  await new Promise((r) => server.close(r))
  ledger.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('the operator channel refuses everyone else', () => {
  it('★ every ops route is 401 without the bearer', async () => {
    for (const [method, path] of [
      ['GET', '/admin/clock'],
      ['GET', '/admin/cost'],
      ['GET', '/admin/rulings/pending'],
      ['GET', '/admin/export'],
      ['POST', '/admin/pause'],
      ['POST', '/admin/resume'],
      ['POST', '/admin/speed'],
      ['POST', '/admin/rulings/7/approve'],
      ['POST', '/admin/rulings/7/revert'],
    ] as const) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method })
      expect(res.status, `${method} ${path}`).toBe(401)
      await res.text()
    }
  })

  it('a wrong method on an ops route is 405, and an unknown one is still 404', async () => {
    expect((await call('/admin/pause')).status).toBe(405)
    expect((await call('/admin/nothing')).status).toBe(404)
  })
})

describe('the clock', () => {
  it('pause, resume and speed each answer with the clock they left behind', async () => {
    const paused = await call('/admin/pause', { method: 'POST' })
    expect(paused.status).toBe(200)
    expect(JSON.parse(paused.body)).toMatchObject({ paused: true, speed: 1, tick: 12 })
    expect(clock.paused).toBe(true)

    expect(JSON.parse((await call('/admin/resume', { method: 'POST' })).body)).toMatchObject({
      paused: false,
    })

    const fast = await call('/admin/speed', { method: 'POST', body: JSON.stringify({ x: 4 }) })
    expect(JSON.parse(fast.body)).toMatchObject({ speed: 4 })
    expect(clock.speedSet).toBe(1)
  })

  it('a speed the world cannot keep is refused, and the dial does not move', async () => {
    const before = clock.speedSet
    for (const x of [0, -1, MAX_SPEED + 1, 'fast']) {
      expect(
        (await call('/admin/speed', { method: 'POST', body: JSON.stringify({ x }) })).status,
        String(x),
      ).toBe(400)
    }
    expect((await call('/admin/speed', { method: 'POST', body: 'not json' })).status).toBe(400)
    expect(clock.speedSet).toBe(before)
  })
})

describe('the cost dashboard', () => {
  it('reads the ledger per caller, per mind and against the caps', async () => {
    const r = await call('/admin/cost')
    expect(r.status).toBe(200)
    const cost = JSON.parse(r.body) as CostReport
    expect(cost.live).toBe(true)
    expect(cost.lifetime).toEqual({ calls: 3, usd: 0.08 })
    expect(cost.byCaller.map((c) => c.caller)).toEqual(['arbiter', 'turn'])
    expect(cost.byMind.map((m) => m.agentId)).toEqual(['omar', 'amara'])
    expect(cost.cacheReadShare).toBeCloseTo(100 / 300)
    expect(cost.caps).toEqual({ dailyUsd: 3, lifetimeUsd: 50 })
    expect(cost.stop).toEqual({ dailyReached: false, lifetimeReached: false })
    // 15 real minutes is half a sim-day, so $0.08 in the window projects to $0.16.
    expect(cost.projection.usdPerSimDay).toBeCloseTo(0.16)
  })

  it('★ carries the answer rate: of the acts begun, the share that finished', async () => {
    const cost = JSON.parse((await call('/admin/cost')).body) as CostReport
    expect(cost.answerRate).toMatchObject({ stated: 2, answered: 1, abandoned: 1, rate: 0.5 })
    expect(cost.answerRate.byVerb).toEqual([
      { verb: 'build', stated: 1, answered: 1 },
      { verb: 'fish', stated: 1, answered: 0 },
    ])
  })

  it('a scripted stream bought nothing and says so, rather than erroring', async () => {
    const live = ops
    ops = null
    try {
      const cost = JSON.parse((await call('/admin/cost')).body) as CostReport
      expect(cost.live).toBe(false)
      expect(cost.lifetime).toEqual({ calls: 0, usd: 0 })
      expect(cost.byCaller).toEqual([])
      expect(cost.answerRate.stated).toBe(2)
    } finally {
      ops = live
    }
  })

  it('a world with no log at all measures nothing rather than throwing', () => {
    expect(answerRate(join(dir, 'no-such.db')).rate).toBeNull()
  })
})

describe('the ruling queue', () => {
  it('lists what is pending, approves one, and reverts one with the operator’s reason', async () => {
    expect(JSON.parse((await call('/admin/rulings/pending')).body)).toEqual({
      pending: [{ id: 1, ruleId: 7, recipeId: 'weave', tick: 40 }],
    })

    const bad = await call('/admin/rulings/9/approve', { method: 'POST' })
    expect(bad.status).toBe(400)
    expect(bad.body).toContain('no such rule 9')

    expect((await call('/admin/rulings/7/approve', { method: 'POST' })).status).toBe(200)
    expect(pending).toEqual([])

    pending = [{ id: 1, ruleId: 7, recipeId: 'weave', tick: 40 }]
    const r = await call('/admin/rulings/7/revert', {
      method: 'POST',
      body: JSON.stringify({ reason: 'it was never a craft' }),
    })
    expect(r.status).toBe(200)
    expect(reverted).toEqual([{ ruleId: 7, reason: 'it was never a craft', tick: 12 }])
  })

  it('a scripted stream has no god layer and says which', async () => {
    const live = ops
    ops = null
    try {
      expect(JSON.parse((await call('/admin/rulings/pending')).body)).toEqual({ pending: [] })
      expect((await call('/admin/rulings/7/revert', { method: 'POST' })).status).toBe(409)
    } finally {
      ops = live
    }
  })
})
