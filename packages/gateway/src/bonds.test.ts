import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BondsResponseSchema, DEFAULT_CONFIG, bondId, type Bond, type BondsResponse } from '@sj/shared'
import { EventStore, RngStreams, TickLoop, genesisState, openDb, type TileId } from '@sj/engine'
import { createGateway, type Gateway } from './index.js'

const GRASS: TileId[][] = Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => 0 as TileId))

describe('/api/bonds — the deterministic proxy that stands in for C9 T11/T12', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-bonds-'))
  let gw: Gateway
  let base: string
  let body: BondsResponse

  beforeAll(async () => {
    const dbPath = join(dir, 'world.db')
    const db = openDb(dbPath)
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
    expect(b?.history.map((h) => h.note)).toEqual(['kept house together', 'kept house together'])
    expect(b?.formedTick).toBe(30)
    expect(b?.lastUpdatedTick).toBe(40)
  })

  it('ties a child to each parent', () => {
    for (const parent of ['alice', 'bob']) {
      const b = find(parent, 'mira')
      expect(b?.kind, parent).toBe('kin')
      expect(b?.history.map((h) => h.note), parent).toEqual(['parent and child'])
      expect(b?.formedTick, parent).toBe(50)
    }
  })

  it('reads a gift as a debt, a lesson as work, and a blow as a rivalry', () => {
    expect(find('cara', 'eve')?.kind).toBe('owe')
    expect(find('cara', 'eve')?.history[0]?.note).toBe('gave something away')
    expect(find('dan', 'eve')?.kind).toBe('rival')      // the fight outranks the lesson
    expect(find('dan', 'eve')?.history.map((h) => h.note))
      .toEqual(['taught something', 'came to blows'])
  })

  it('still ties a friendship from talk alone, with no C9 data at all', () => {
    const b = find('cara', 'dan')
    expect(b?.kind).toBe('friend')
    expect(b?.history[0]?.note).toBe('spoke together')
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

  it('keeps every history entry in the order it happened', () => {
    for (const b of body.bonds) {
      const ticks = b.history.map((h) => h.tick)
      expect([...ticks].sort((x, y) => x - y), b.id).toEqual(ticks)
      expect(b.formedTick, b.id).toBe(ticks[0])
      expect(b.lastUpdatedTick, b.id).toBe(ticks[ticks.length - 1])
      expect(b.strength, b.id).toBe(b.history.length)
    }
  })

  it('speaks of the town in every note — no verbs, no payloads', () => {
    for (const b of body.bonds) {
      for (const h of b.history) expect(h.note, h.note).toMatch(/^[a-z]/)
    }
  })
})
