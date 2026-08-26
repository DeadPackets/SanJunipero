import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BOND_RECENT_ACTS, BondsCountSchema, BondsResponseSchema, DEFAULT_CONFIG, bondId, bondNote,
  type Bond, type BondsResponse, type SimEvent,
} from '@sj/shared'
import { EventStore, RngStreams, TickLoop, genesisState, openDb, type TileId } from '@sj/engine'
import { createGateway, type Gateway } from './index.js'
import { BOND_TYPES, buildBonds } from './bonds.js'

const GRASS: TileId[][] = Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => 0 as TileId))

describe('/api/bonds — the deterministic proxy that stands in for C9 T11/T12', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-bonds-'))
  let gw: Gateway
  let base: string
  let body: BondsResponse
  let db: ReturnType<typeof openDb>

  beforeAll(async () => {
    const dbPath = join(dir, 'world.db')
    db = openDb(dbPath)
    const loop = new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('bonds-test'),
      snapshotEveryTicks: 25,
      onTick: ({ tick, emit }) => {
        if (tick === 1) {
          emit('agent_spawned', { id: 'alice', name: 'Alice', x: 0, y: 0, ageDays: 7300, sex: 'f' })
          emit('agent_spawned', { id: 'bob', name: 'Bob', x: 0, y: 1, ageDays: 7300, sex: 'm' })
          emit('agent_spawned', { id: 'cara', name: 'Cara', x: 20, y: 20, ageDays: 7300 })
          emit('agent_spawned', { id: 'dan', name: 'Dan', x: 20, y: 21, ageDays: 7300 })
          emit('agent_spawned', { id: 'eve', name: 'Eve', x: 8, y: 8, ageDays: 7300 })
        }
        // a talking pair, in earshot and inside the window → friend
        if (tick === 5) emit('agent_spoke', { agentId: 'cara', text: 'Fine morning.', x: 20, y: 20 })
        if (tick === 10) emit('agent_spoke', { agentId: 'dan', text: 'It is.', x: 20, y: 21 })
        // a gift → owe
        if (tick === 20) emit('action_started', { agentId: 'cara', verb: 'give', params: { targetId: 'eve' }, duration: 2 })
        if (tick === 22) emit('action_completed', { agentId: 'cara', verb: 'give' })
        // a lesson → work
        if (tick === 24) emit('action_started', { agentId: 'dan', verb: 'teach', params: { targetId: 'eve' }, duration: 2 })
        if (tick === 26) emit('action_completed', { agentId: 'dan', verb: 'teach' })
        // a fight → rival
        if (tick === 28) emit('action_started', { agentId: 'eve', verb: 'attack', params: { targetId: 'dan' }, duration: 1 })
        if (tick === 29) emit('action_completed', { agentId: 'eve', verb: 'attack' })
        // two nights kept → partner, strength 2
        if (tick === 30) emit('co_slept', { aId: 'alice', bId: 'bob', day: 0 })
        if (tick === 40) emit('co_slept', { aId: 'alice', bId: 'bob', day: 0 })
        // a birth → kin on both sides
        if (tick === 50) {
          emit('agent_born', { id: 'mira', name: 'Mira', sex: 'f', motherId: 'alice', fatherId: 'bob', x: 0, y: 0 })
        }
      },
    })
    for (let i = 0; i < 60; i++) loop.step()

    gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    base = `http://127.0.0.1:${gw.port}`
    body = BondsResponseSchema.parse(await (await fetch(`${base}/api/bonds`)).json())
  })
  afterAll(async () => {
    await gw.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const find = (a: string, b: string): Bond | undefined => body.bonds.find((x) => x.id === bondId(a, b))

  it('answers in the shape C9 T11/T12 must fill, stamped with the tick it was true at', () => {
    expect(body.asOfTick).toBe(60)
  })

  it('ties the couple who kept house, and counts the nights', () => {
    const b = find('alice', 'bob')
    expect(b?.kind).toBe('partner')
    expect(b?.strength).toBe(2)
    expect(b?.recent.map((h) => bondNote(h.kind))).toEqual(['kept house together', 'kept house together'])
    expect(b?.acts).toEqual([{ kind: 'partner', count: 2, firstTick: 30, lastTick: 40 }])
    expect(b?.formedTick).toBe(30)
    expect(b?.lastUpdatedTick).toBe(40)
  })

  it('ties a child to each parent', () => {
    for (const parent of ['alice', 'bob']) {
      const b = find(parent, 'mira')
      expect(b?.kind, parent).toBe('kin')
      expect(b?.recent.map((h) => bondNote(h.kind)), parent).toEqual(['parent and child'])
      expect(b?.formedTick, parent).toBe(50)
    }
  })

  it('reads a gift as a debt, a lesson as work, and a blow as a rivalry', () => {
    expect(find('cara', 'eve')?.kind).toBe('owe')
    expect(find('cara', 'eve')?.recent[0]).toEqual({ tick: 22, kind: 'owe' })
    expect(find('dan', 'eve')?.kind).toBe('rival')      // the fight outranks the lesson
    expect(find('dan', 'eve')?.recent.map((h) => bondNote(h.kind)))
      .toEqual(['taught something', 'came to blows'])
  })

  it('still ties a friendship from talk alone, with no C9 data at all', () => {
    const b = find('cara', 'dan')
    expect(b?.kind).toBe('friend')
    expect(b?.recent[0]).toEqual({ tick: 10, kind: 'friend' })
  })

  it('ties no one who has done nothing together', () => {
    expect(find('alice', 'cara')).toBeUndefined()
    expect(find('bob', 'eve')).toBeUndefined()
  })

  it('names every pair from either side and answers the same way twice', async () => {
    for (const b of body.bonds) expect(b.id, b.id).toBe(bondId(b.aId, b.bId))
    const again = BondsResponseSchema.parse(await (await fetch(`${base}/api/bonds`)).json())
    expect(again).toEqual(body)
  })

  it('keeps the window in the order it happened, and the rollup over the whole of it', () => {
    for (const b of body.bonds) {
      const ticks = b.recent.map((h) => h.tick)
      expect([...ticks].sort((x, y) => x - y), b.id).toEqual(ticks)
      expect(b.lastUpdatedTick, b.id).toBe(ticks[ticks.length - 1])
      // the rollup is over EVERY act, so it agrees with `strength` and with the two stamps
      expect(b.acts.reduce((n, a) => n + a.count, 0), b.id).toBe(b.strength)
      expect(Math.min(...b.acts.map((a) => a.firstTick)), b.id).toBe(b.formedTick)
      expect(Math.max(...b.acts.map((a) => a.lastTick)), b.id).toBe(b.lastUpdatedTick)
      expect(b.recent.length, b.id).toBeLessThanOrEqual(BOND_RECENT_ACTS)
    }
  })

  it('speaks of the town in every note — no verbs, no payloads', () => {
    for (const b of body.bonds) {
      for (const h of b.recent) expect(bondNote(h.kind), h.kind).toMatch(/^[a-z]/)
    }
  })

  /**
   * `buildBonds` folds exactly `BOND_TYPES`; every other row falls through its chain, so the
   * SELECT may drop them — `fauna_moved` alone carries 640 B payloads and dominates a real log.
   */
  it('★ answers what the whole log answers, reading only the five types a bond is made of', () => {
    const rows = db.prepare('SELECT seq, tick, type, payload FROM events ORDER BY seq').all() as
      Array<{ seq: number; tick: number; type: string; payload: string }>
    const all = rows.map((r) =>
      ({ seq: r.seq, tick: r.tick, type: r.type, payload: JSON.parse(r.payload) }) as SimEvent)
    expect(all.some((e) => !BOND_TYPES.includes(e.type)), 'the log carries types bonds ignore').toBe(true)
    expect(buildBonds(all, DEFAULT_CONFIG.movement.earshotRadius, body.asOfTick)).toEqual(body)
  })

  it('★ counts the bonds without sending them', async () => {
    const count = BondsCountSchema.parse(await (await fetch(`${base}/api/bonds/count`)).json())
    expect(count.count).toBe(body.bonds.length)
    expect(count.asOfTick).toBe(body.asOfTick)
    const full = await (await fetch(`${base}/api/bonds`)).text()
    expect(JSON.stringify(count).length, 'two integers, not a feed').toBeLessThan(full.length / 4)
  })
})

/**
 * A spoke older than `TALK_WINDOW_TICKS` can pair with nothing ever again, so dropping it is
 * the same answer in bounded time; this proves the "same answer" half.
 */
describe('★ the talk window is a window, not the whole log', () => {
  const spoke = (seq: number, tick: number, agentId: string, x: number): SimEvent =>
    ({ seq, tick, type: 'agent_spoke', payload: { agentId, text: 'w', x, y: 0 } }) as SimEvent

  it('ties exactly the pairs inside the window and none outside it', () => {
    const events = [
      spoke(1, 0, 'a', 0), spoke(2, 5, 'b', 1),          // 5 apart, in earshot → friend
      spoke(3, 200, 'c', 0), spoke(4, 219, 'a', 1),      // 19 apart → friend
      spoke(5, 240, 'b', 0), spoke(6, 261, 'c', 1),      // 21 apart → NOT a pair
      spoke(7, 400, 'a', 0), spoke(8, 401, 'b', 40),     // in the window, out of earshot
    ]
    const out = buildBonds(events, 5, 500)
    expect(out.bonds.map((b) => b.id)).toEqual([bondId('a', 'b'), bondId('a', 'c')])
    expect(out.bonds.find((b) => b.id === bondId('a', 'b'))?.recent.map((h) => h.tick)).toEqual([5])
    expect(out.bonds.find((b) => b.id === bondId('a', 'c'))?.recent.map((h) => h.tick)).toEqual([219])
  })

  it('is linear in the log, not quadratic — 8× the speech is not 64× the work', () => {
    const run = (n: number): number => {
      const events = Array.from({ length: n }, (_, i) => spoke(i + 1, i, `a${i % 8}`, 0))
      const t0 = process.hrtime.bigint()
      buildBonds(events, 5, n)
      return Number(process.hrtime.bigint() - t0) / 1e6
    }
    run(4_000)                                  // warm the jit so the ratio is the algorithm
    const small = Math.max(run(8_000), 1)
    const large = run(64_000)
    // quadratic would be ~64×; the bound makes it ~8×. Ten is the honest line between them.
    expect(large / small, `8k took ${small.toFixed(1)} ms, 64k took ${large.toFixed(1)} ms`)
      .toBeLessThan(10)
  })
})
