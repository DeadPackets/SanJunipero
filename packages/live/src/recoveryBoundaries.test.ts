import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import {
  CodexStore,
  makeArbiter,
  openArbiterDb,
  RulebookStore,
  type AttemptVerdict,
  type Codified,
} from '@sj/arbiter'
import { unregisterVerb, VERBS, TickLoop, genesisState, RngStreams, replayLatest } from '@sj/engine'
import { DEFAULT_CONFIG } from '@sj/shared'
import { AssetCodex, openForgeDb, encodePng } from '@sj/forge'
import { watchDiscoveryArt } from './discoveryArt.js'
import { restorableSnapshot } from './liveWorld.js'
import { EventStore, openDb } from '@sj/engine/store'
import { type LlmClient, migrateLlmTables, makeBudgetGuard, sumCostUsd } from '@sj/llm'
import { FakeEmbedder } from '@sj/llm/testutil'

const attempt: AttemptVerdict = {
  summary: 'Twist grass into cord.',
  recipe: {
    id: 'recipe:twist_grass_cord',
    name: 'Twist grass into cord',
    takes: 'minutes',
    costs: [{ kind: 'grass', qty: 1 }],
    requires: [],
    outcomeTable: [
      {
        weight: 1,
        success: true,
        label: 'The cord holds.',
        effects: [{ op: 'spawn_item', kind: 'cord', qty: 1 }],
      },
    ],
    rngStream: 'recipe:twist_grass_cord',
    canon: ['cordage'],
  },
}
const credit = { agentId: 'amara', intent: 'twist the grass', saying: 'Keep the strands tight.' }
const dirs: string[] = []
const dbs: Database.Database[] = []
const stores: EventStore[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const store of stores.splice(0)) store.close()
  for (const db of dbs.splice(0)) if (db.open) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  unregisterVerb(attempt.recipe.id)
  unregisterVerb('express:songrecovery')
})

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sj-recovery-'))
  dirs.push(dir)
  const path = join(dir, 'arbiter.db')
  let db = openArbiterDb(path)
  dbs.push(db)
  new CodexStore(db).insert({
    id: 'cordage',
    name: 'Cordage',
    era: 'handwork',
    prerequisiteId: null,
  })
  const world = openDb(join(dir, 'world.db'))
  dbs.push(world)
  const store = new EventStore(world)
  stores.push(store)
  const publish = (d: Codified) => {
    const exists = store
      .readTypeFrom(0, 'discovery_made')
      .some((event) => (event.payload as { recipeId: string }).recipeId === d.recipeId)
    if (!exists)
      store.append(5, 'discovery_made', {
        recipeId: d.recipeId,
        byId: d.credit.agentId,
        intent: d.credit.intent,
      })
  }
  const llm = { alert: vi.fn(), forCaller: () => llm } as unknown as LlmClient
  const boot = (onCodified: (d: Codified) => void) =>
    makeArbiter({
      db,
      llm,
      embedder: new FakeEmbedder(),
      tick: () => 5,
      onCodified,
    })
  const reopen = () => {
    db.close()
    unregisterVerb(attempt.recipe.id)
    db = openArbiterDb(path)
    dbs.push(db)
  }
  return { boot, reopen, store, publish, llm, db: () => db }
}

it('recovers a committed rule interrupted before discovery publication without reminting it', () => {
  const f = fixture()
  const arbiter = f.boot(() => {
    throw new Error('crash before publication')
  })
  expect(() => arbiter.codify(attempt, credit)).toThrow('crash before publication')
  expect(new RulebookStore(f.db()).allActive()).toHaveLength(1)
  expect(f.store.readTypeFrom(0, 'discovery_made')).toHaveLength(0)
  f.reopen()
  f.boot(f.publish)
  expect(VERBS[attempt.recipe.id]).toBeDefined()
  expect(f.store.readTypeFrom(0, 'discovery_made')).toHaveLength(1)
  expect(f.store.readTypeFrom(0, 'discovery_made')[0]?.payload).toMatchObject({
    byId: credit.agentId,
    intent: credit.intent,
  })
  f.reopen()
  f.boot(f.publish).codify(attempt, credit)
  expect(new RulebookStore(f.db()).allActive()).toHaveLength(1)
  expect(f.store.readTypeFrom(0, 'discovery_made')).toHaveLength(1)
})

it('retries an interrupted publication acknowledgement without duplicating the world event', () => {
  const f = fixture()
  const arbiter = f.boot((d) => {
    f.publish(d)
    throw new Error('crash after publication')
  })
  expect(() => arbiter.codify(attempt, credit)).toThrow('crash after publication')
  f.reopen()
  const recovered = vi.fn(f.publish)
  f.boot(recovered)
  expect(recovered).toHaveBeenCalledTimes(1)
  expect(f.store.readTypeFrom(0, 'discovery_made')).toHaveLength(1)
  f.reopen()
  f.boot(recovered)
  expect(recovered).toHaveBeenCalledTimes(1)
})

it('rolls back interruption after rule insertion before its review row commits', () => {
  const f = fixture()
  const insert = RulebookStore.prototype.insert
  const crash = vi.spyOn(RulebookStore.prototype, 'insert').mockImplementation(function (
    this: RulebookStore,
    ...args
  ) {
    insert.apply(this, args)
    throw new Error('crash inside rule transaction')
  })
  expect(() => f.boot(f.publish).codify(attempt, credit)).toThrow('crash inside rule transaction')
  crash.mockRestore()
  f.reopen()
  expect(new RulebookStore(f.db()).allActive()).toHaveLength(0)
  f.boot(f.publish).codify(attempt, credit)
  expect(new RulebookStore(f.db()).allActive()).toHaveLength(1)
  expect(f.db().prepare('SELECT COUNT(*) AS n FROM ruling_reviews').get()).toEqual({ n: 1 })
  expect(f.store.readTypeFrom(0, 'discovery_made')).toHaveLength(1)
})

it('reuses the registered asset and its settled charge after interruption before watcher completion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-asset-recovery-'))
  dirs.push(dir)
  const assetPath = join(dir, 'assets.db')
  const opsPath = join(dir, 'ops.db')
  let assets = openForgeDb(assetPath)
  let ops = openDb(opsPath)
  dbs.push(assets, ops)
  migrateLlmTables(ops)
  const guard = makeBudgetGuard(ops, 'forge')
  const allowance = guard.reserve(0.05, 1, null)
  if ('held' in allowance) throw new Error('fixture allowance refused')
  const charge = {
    caller: 'forge',
    costUsd: 0.04,
    agentId: null,
    model: 'fake',
    provider: 'fake',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    estimatedCostUsd: 0.05,
    reportedCostUsd: 0.04,
    latencyMs: 1,
    finishReason: 'stop',
    ok: true,
    error: null,
  }
  guard.reconcile(allowance.id, charge)
  const png = await encodePng({ width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) })
  expect(() => {
    new AssetCodex(assets).register({
      class: 'item',
      kind: 'cord',
      desc: 'cord',
      footprint: { w: 1, h: 1 },
      png,
      widthPx: 1,
      heightPx: 1,
      status: 'ready',
      score: 9,
      attempts: 1,
      costUsd: 0.04,
    })
    throw new Error('crash after asset registration')
  }).toThrow('crash after asset registration')
  assets.close()
  ops.close()
  assets = openForgeDb(assetPath)
  ops = openDb(opsPath)
  dbs.push(assets, ops)
  migrateLlmTables(ops)
  const commission = vi.fn()
  const watcher = watchDiscoveryArt({ codex: new AssetCodex(assets), forge: { commission } })
  watcher.onDiscovery({ name: 'Twist cord', makes: ['cord'] })
  await watcher.settle()
  expect(commission).not.toHaveBeenCalled()
  makeBudgetGuard(ops, 'forge').reconcile(allowance.id, charge)
  expect(sumCostUsd(ops)).toBe(0.04)
  expect(ops.prepare('SELECT COUNT(*) AS n FROM llm_calls').get()).toEqual({ n: 1 })
  expect(new AssetCodex(assets).listSince(0)).toHaveLength(1)
})

it.each([false, true])(
  'checks a runtime checkpoint against the committed world after interruption (rollback=%s)',
  (rollback) => {
    const dir = mkdtempSync(join(tmpdir(), 'sj-runtime-recovery-'))
    dirs.push(dir)
    const worldPath = join(dir, 'world.db')
    const mindPath = join(dir, 'amara.db')
    let world = openDb(worldPath)
    let mind = openDb(mindPath)
    dbs.push(world, mind)
    let store = new EventStore(world)
    stores.push(store)
    const loop = new TickLoop({
      store,
      state: genesisState(DEFAULT_CONFIG),
      rng: new RngStreams('recovery'),
      onTick: ({ tick }) => {
        mind.exec(
          'CREATE TABLE IF NOT EXISTS mind_runtime (agent_id TEXT PRIMARY KEY, tick INTEGER NOT NULL, snapshot TEXT NOT NULL)',
        )
        mind
          .prepare(
            'INSERT INTO mind_runtime VALUES (?, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET tick=excluded.tick, snapshot=excluded.snapshot',
          )
          .run(
            'amara',
            tick,
            JSON.stringify({
              stats: { turns: 1 },
              plan: { queue: [{ verb: 'wait' }] },
              heardKeys: ['said:1'],
            }),
          )
        if (rollback) throw new Error('crash after checkpoint before world commit')
      },
    })
    if (rollback)
      expect(() => {
        loop.step()
      }).toThrow('crash after checkpoint')
    else {
      loop.step()
      expect(() => {
        throw new Error('crash after world commit')
      }).toThrow()
    }
    store.close()
    world.close()
    mind.close()
    world = openDb(worldPath)
    mind = openDb(mindPath)
    dbs.push(world, mind)
    store = new EventStore(world)
    stores.push(store)
    const recovered = replayLatest(store, DEFAULT_CONFIG, undefined, 'recovery')
    const row = mind
      .prepare('SELECT tick, snapshot FROM mind_runtime WHERE agent_id = ?')
      .get('amara') as { tick: number; snapshot: string }
    const checkpoint = restorableSnapshot(row, recovered.state.tick)
    if (rollback) {
      expect(checkpoint).toBeNull()
      expect(store.readFrom(0)).toHaveLength(0)
    } else {
      expect(checkpoint).toMatchObject({
        stats: { turns: 1 },
        plan: { queue: [{ verb: 'wait' }] },
        heardKeys: ['said:1'],
      })
      expect(store.readTypeFrom(0, 'tick_advanced')).toHaveLength(1)
    }
    expect(mind.prepare('SELECT COUNT(*) AS n FROM mind_runtime').get()).toEqual({ n: 1 })
  },
)

it('recovers expressive words with original credit without another provider call', async () => {
  const f = fixture()
  const object = vi.fn(async () => ({
    value: {
      word: 'songrecovery',
      sense: 'sound',
      takes: 'minutes',
      energyCost: 1,
      targeted: false,
      emote: 'Sings beside the fire.',
    },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 },
  }))
  Object.assign(f.llm, { object })
  const arbiter = f.boot(() => {
    throw new Error('crash after expressive insert')
  })
  await expect(
    arbiter.adjudicate('sing beside the fire', {
      agentId: 'amara',
      name: 'Amara',
      skills: {},
      inventory: [],
      position: { x: 1, y: 1 },
    }),
  ).rejects.toThrow('crash after expressive insert')
  f.reopen()
  unregisterVerb('express:songrecovery')
  f.boot(f.publish)
  expect(VERBS['express:songrecovery']).toBeDefined()
  expect(f.store.readTypeFrom(0, 'discovery_made')[0]?.payload).toMatchObject({
    recipeId: 'express:songrecovery',
    byId: 'amara',
    intent: 'sing beside the fire',
  })
  expect(object).toHaveBeenCalledTimes(1)
})
