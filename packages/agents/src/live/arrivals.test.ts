// The road rehearsal: a real genesis world, a real cast, and the walker's own database on disk.
// A row that passes without `wireArrivals` proves nothing about the town growing off the road.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { MockLanguageModelV4 } from 'ai/test'
import { EventStore, openDb } from '@sj/engine/store'
import {
  fold,
  genesisState,
  makeGenesisWorld,
  RngStreams,
  TickLoop,
  type TickHandler,
} from '@sj/engine'
import { DAYS_PER_YEAR, MINUTES_PER_DAY, SimConfigSchema, TOWN_SQUARE } from '@sj/shared'
import { LlmClient, migrateLlmTables } from '@sj/llm'
import { FakeEmbedder } from '@sj/llm/testutil'
import { openAgentDb } from '../memory/schema.js'
import type { PersonalityDoc } from '../personality.js'
import { EngineBridge } from '../runtime/bridge.js'
import { tamarIdentity } from '../testutil/fixtures.js'
import { bootMinds, type MindSpec } from './liveMinds.js'
import { arrivalGap, ensureArrivals, needsArrival, wireArrivals } from './arrivals.js'
import { arrivalSpec, resolveCast, strangerSpec } from './resolveCast.js'
import { TRAVELLER_MINDS } from './travellerMinds.js'

const ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}

const doc: PersonalityDoc = {
  temperament: 'exacting, quiet',
  values: ['a full store'],
  beliefs: ['what is counted keeps'],
  current: { mood: 'watchful', worries: [], goals: [] },
}

const specFor = (id: string, sex: 'f' | 'm'): MindSpec => ({
  id,
  identity: { ...tamarIdentity, name: id },
  personality: doc,
  ageDays: 34 * DAYS_PER_YEAR,
  sex,
})

/** The four authored travellers, as the log would hold them, one every three days. */
const camePreviously = (n: number): { id: string; day: number }[] =>
  TRAVELLER_MINDS.slice(0, n).map((t, i) => ({ id: t.id, day: (i + 1) * 3 }))

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

type TownOpts = {
  maxMinds?: number
  /** Walkers the log already holds, so a scenario need not wind the clock through them. */
  already?: { id: string; day: number }[]
  /** Which morning the world starts the evening before. Given the gap and the last arrival. */
  startDay?: (gap: number, lastArrival: number) => number
  /** An embedder that never answers: what a walker mid-boot looks like from outside. */
  hangSeeding?: boolean
}

async function town(opts: TownOpts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sj-road-'))
  dirs.push(dir)
  const config = SimConfigSchema.parse({})
  const store = new EventStore(openDb(':memory:'))
  const { terrain, events } = makeGenesisWorld(config)
  let state = genesisState(config, terrain)
  for (const e of events) state = fold(state, store.append(0, e.type, e.payload), config)
  const FOUNDERS: MindSpec[] = [specFor('amara', 'f'), specFor('yusuf', 'm')]
  for (const f of FOUNDERS) {
    state = fold(
      state,
      store.append(0, 'agent_spawned', {
        id: f.id,
        name: f.id,
        x: TOWN_SQUARE.x,
        y: TOWN_SQUARE.y,
        ageDays: 9000,
      }),
      config,
    )
  }
  for (const prior of opts.already ?? []) {
    const card = TRAVELLER_MINDS.find((t) => t.id === prior.id)!
    const at = prior.day * MINUTES_PER_DAY + 540
    state = fold(
      state,
      store.append(at, 'agent_arrived', {
        id: card.id,
        name: card.identity.name,
        sex: card.sex,
        ageDays: card.ageDays,
        x: TOWN_SQUARE.x,
        y: state.terrain.length - 1,
      }),
      config,
    )
  }
  const gap = arrivalGap(state.counters.nextEntityId)
  const lastArrival = (opts.already ?? []).reduce((d, a) => Math.max(d, a.day), 0)
  const startDay = opts.startDay?.(gap, lastArrival) ?? lastArrival + gap
  const startTick = startDay * MINUTES_PER_DAY + 539

  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store,
    state: { ...state, tick: startTick },
    startTick,
    rng: new RngStreams('road-test'),
    config,
    // The whole 128-square world serialised every minute is the slow part of this fixture.
    snapshotEveryTicks: 1_000_000,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  // No world systems: this rehearsal drives the clock by hand, not the weather.
  handler = bridge.wrapTickHandler(() => {})

  const opsDb = openAgentDb(join(dir, '_ops.db'))
  migrateLlmTables(opsDb)
  const mindDbs = new Map<string, Database.Database>()
  const dbFor = (id: string): Database.Database => {
    let db = mindDbs.get(id)
    if (db === undefined) {
      db = openAgentDb(join(dir, `${id}.db`))
      mindDbs.set(id, db)
    }
    return db
  }
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        { type: 'text' as const, text: JSON.stringify({ thought: 'I wait.', importance: 1 }) },
      ],
      finishReason: { unified: 'stop' as const, raw: undefined },
      usage: ZERO_USAGE,
      warnings: [],
    }),
  })
  const real = await FakeEmbedder.create()
  const embedder = {
    embed: async (t: string): Promise<Float32Array> =>
      opts.hangSeeding === true ? new Promise<Float32Array>(() => {}) : real.embed(t),
  }
  const maxMinds = opts.maxMinds ?? 10

  const boot = () => {
    const cast = resolveCast(FOUNDERS, store, maxMinds)
    const booted = bootMinds({
      minds: cast.filter((m) => !needsArrival(m, dbFor(m.id))),
      bridge,
      embedder,
      dbFor,
      turnLlm: (id) =>
        new LlmClient({ model, db: opsDb, caller: 'turn', agentId: id, maxRetries: 0 }),
    })
    const repairing = ensureArrivals({
      cast: new Map(cast.map((m) => [m.id, m])),
      store,
      dbFor,
      embedder,
      boot: (spec) => {
        booted.add(spec)
      },
    })
    const stop = wireArrivals({ booted, bridge, store, dbFor, embedder, opsDb, maxMinds })
    return {
      booted,
      repairing,
      stop: () => {
        stop()
        booted.stop()
      },
    }
  }
  let running = boot()
  if (opts.hangSeeding !== true) await running.repairing

  const settle = async (rounds = 40): Promise<void> => {
    for (let i = 0; i < rounds; i += 1) await new Promise((r) => setImmediate(r))
  }

  return {
    gap,
    startDay,
    get booted() {
      return running.booted
    },
    dbFor,
    store,
    bridge,
    alerts: (): { kind: string; n: number }[] =>
      opsDb.prepare('SELECT kind, COUNT(*) n FROM alerts GROUP BY kind').all() as {
        kind: string
        n: number
      }[],
    /** The arrivals THIS run brought, past the ones the log already held. */
    newcomers: (): { id: string; name: string; sex: string; x: number; y: number }[] =>
      store
        .readTypeFrom(0, 'agent_arrived')
        .filter((e) => e.tick >= startTick)
        .map((e) => e.payload as { id: string; name: string; sex: string; x: number; y: number }),
    /** Nine o'clock, then the tick that folds what nine o'clock announced. */
    morning: async () => {
      loop.step()
      loop.step()
      loop.step()
      await settle()
    },
    /** One more sim-day, so a second morning can be asked for. */
    aDayOn: async () => {
      for (let i = 0; i < MINUTES_PER_DAY - 2; i += 1) loop.step()
      await settle(5)
    },
    reboot: async () => {
      running.stop()
      running = boot()
      await running.repairing
      await settle()
    },
    stop: () => {
      running.stop()
      for (const db of mindDbs.values()) db.close()
      opsDb.close()
    },
  }
}

describe('★ somebody comes up the valley road', () => {
  it('brings the first traveller with a kit, the town in mind, and a mind of their own', async () => {
    const t = await town()
    try {
      await t.morning()
      const came = t.newcomers()
      expect(came).toHaveLength(1)
      const mira = TRAVELLER_MINDS[0]!
      expect(came[0]!.id).toBe(mira.id)
      expect(came[0]!.name).toBe(mira.identity.name)
      expect(came[0]!.sex).toBe(mira.sex)
      // The rim, not the square: they walk in off the edge of the map.
      expect(came[0]!.y).toBe(t.bridge.roadRim()!.y)
      expect(t.booted.cast.has(mira.id)).toBe(true)
      const kit = t.store
        .readTypeFrom(0, 'item_spawned')
        .map((e) => e.payload as { kind: string; owner?: string })
        .filter((i) => i.owner === mira.id)
      expect(kit.map((i) => i.kind).sort()).toEqual(['bread', 'knife', 'waterskin'])
      const seen = t.store.readTypeFrom(0, 'places_seen').at(-1)!.payload as { agentId: string }
      expect(seen.agentId).toBe(mira.id)
      // The road is the first thing this mind remembers, in the traveller's own words.
      const rows = t
        .dbFor(mira.id)
        .prepare('SELECT text FROM memories WHERE agent_id = ?')
        .all(mira.id) as { text: string }[]
      expect(rows.map((r) => r.text)).toEqual([mira.arrival])
    } finally {
      t.stop()
    }
  })

  it('brings nobody a day early', async () => {
    const t = await town({ startDay: (gap) => gap - 1 })
    try {
      await t.morning()
      expect(t.newcomers()).toHaveLength(0)
    } finally {
      t.stop()
    }
  })

  it('takes the travellers in the order they are written, and then invents one', async () => {
    const t = await town({ already: camePreviously(4) })
    try {
      await t.morning()
      const came = t.newcomers()
      expect(came).toHaveLength(1)
      expect(came[0]!.id).toMatch(/^agent_\d+$/)
      expect(t.booted.cast.has(came[0]!.id)).toBe(true)
    } finally {
      t.stop()
    }
  })

  it('brings nobody to a town that is already full', async () => {
    const t = await town({ maxMinds: 2 })
    try {
      await t.morning()
      expect(t.newcomers()).toHaveLength(0)
    } finally {
      t.stop()
    }
  })

  it('brings nobody while the last one is still finding their feet', async () => {
    const t = await town({ hangSeeding: true })
    try {
      await t.morning()
      expect(t.newcomers()).toHaveLength(1)
      await t.aDayOn()
      await t.morning()
      expect(t.newcomers()).toHaveLength(1)
    } finally {
      t.stop()
    }
  })
})

describe('★ a walker survives a restart', () => {
  it('is the same person, with the same memory, on a boot that only knew the founders', async () => {
    const t = await town({ already: camePreviously(4) })
    try {
      await t.morning()
      const id = t.newcomers()[0]!.id
      const was = t.booted.cast.get(id)!
      const memories = (): number =>
        (
          t.dbFor(id).prepare('SELECT COUNT(*) n FROM memories WHERE agent_id = ?').get(id) as {
            n: number
          }
        ).n
      expect(memories()).toBe(1)
      await t.reboot()
      const now = t.booted.cast.get(id)!
      expect(now.identity).toEqual(was.identity)
      expect(now.personality).toEqual(was.personality)
      expect(now.ageDays).toBe(was.ageDays)
      // Idempotent by the arrival it was made from: a second boot writes no second memory.
      expect(memories()).toBe(1)
    } finally {
      t.stop()
    }
  })
})

describe('★ the person an arrival makes', () => {
  const arrived = { id: 'agent_77', name: 'Beela', sex: 'f' as const, ageDays: 28 * 30, x: 1, y: 1 }

  it('is the authored traveller when the road brought one', () => {
    const mira = TRAVELLER_MINDS[0]!
    const spec = arrivalSpec(
      { id: mira.id, name: mira.identity.name, sex: mira.sex, ageDays: mira.ageDays, x: 1, y: 1 },
      3,
    )
    expect(spec.identity).toEqual(mira.identity)
    expect(spec).not.toHaveProperty('arrival')
    expect(spec.arrivedDay).toBe(3)
  })

  it('is derived from the id alone, so the same walker is always the same person', () => {
    expect(strangerSpec(arrived)).toEqual(strangerSpec(arrived))
    expect(strangerSpec({ ...arrived, id: 'agent_78' }).identity).not.toEqual(
      strangerSpec(arrived).identity,
    )
  })

  it('carries the road in the backstory and its own years, not a childhood here', () => {
    const spec = strangerSpec(arrived)
    expect(spec.identity.age).toBe(30)
    expect(spec.identity.backstory).toContain('valley road')
    expect(spec.identity.backstory).not.toContain('Born in this town')
    expect(spec.bornDay).toBeUndefined()
  })
})

describe('★ the gap between one walker and the next', () => {
  it('is three, four or five sim-days, and is read off the world rather than rolled', () => {
    for (let n = 0; n < 12; n += 1) {
      expect(arrivalGap(n)).toBeGreaterThanOrEqual(3)
      expect(arrivalGap(n)).toBeLessThanOrEqual(5)
      expect(arrivalGap(n)).toBe(arrivalGap(n))
    }
  })
})
