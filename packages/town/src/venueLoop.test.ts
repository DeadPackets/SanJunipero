import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openAgentDb, TieStore } from '@sj/agents'
import { ADULT_AGE_DAYS, DEFAULT_CONFIG, stateHash } from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import {
  fold,
  genesisState,
  replayFromGenesis,
  submitIntent,
  VERBS,
  type WorldState,
} from '@sj/engine'
import { RngStream } from '@sj/engine'

const CFG = DEFAULT_CONFIG
const TERRAIN = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0 as const))
const RNG = RngStream.seed('venue-loop', 'actions')
type Pending = { type: string; payload: unknown }

function venue() {
  const dir = mkdtempSync(join(tmpdir(), 'sj-venue-'))
  const worldPath = join(dir, 'world.db')
  const mindPath = join(dir, 'seller.db')
  const db = openDb(worldPath)
  const store = new EventStore(db)
  const mindDb = openAgentDb(mindPath)
  const ties = new TieStore(mindDb, 'seller')
  let state = genesisState(CFG, TERRAIN)
  const log = (type: string, payload: unknown) => {
    const event = store.append(state.tick, type, payload)
    state = fold(state, event, CFG)
    return event
  }
  const apply = (events: Pending[]) => events.map((e) => log(e.type, e.payload))
  const close = () => {
    store.close()
    db.close()
    mindDb.close()
  }
  const reload = () => {
    close()
    const worldDb = openDb(worldPath)
    const reopened = new EventStore(worldDb)
    const replayed = replayFromGenesis(reopened, CFG, TERRAIN)
    const memoryDb = openAgentDb(mindPath)
    const remembered = new TieStore(memoryDb, 'seller').all()
    reopened.close()
    worldDb.close()
    memoryDb.close()
    rmSync(dir, { recursive: true, force: true })
    return { replayed, remembered }
  }
  log('agent_spawned', { id: 'seller', name: 'seller', x: 3, y: 4, ageDays: ADULT_AGE_DAYS })
  log('agent_spawned', { id: 'buyer', name: 'buyer', x: 4, y: 4, ageDays: ADULT_AGE_DAYS })
  log('structure_planned', {
    id: 'stall',
    kind: 'standing_stone',
    x: 3,
    y: 3,
    w: 1,
    h: 1,
    maxHp: 20,
    flammable: false,
    builderId: 'seller',
  })
  log('structure_completed', { id: 'stall' })
  log('item_spawned', {
    id: 'loaf',
    kind: 'bread',
    qty: 1,
    loc: { t: 'structure', id: 'stall' },
    owner: 'seller',
    madeBy: 'seller',
  })
  log('item_spawned', {
    id: 'plank',
    kind: 'plank',
    qty: 1,
    loc: { t: 'agent', id: 'buyer' },
    owner: 'buyer',
    madeBy: 'buyer',
  })
  return {
    get state(): WorldState {
      return state
    },
    log,
    apply,
    ties,
    reload,
  }
}

const words = (v: ReturnType<typeof venue>, id: string, text: string) => {
  const spoken = submitIntent(v.state, CFG, id, 'speak', { text })
  expect(spoken.ok).toBe(true)
  if (spoken.ok) v.apply(spoken.events)
}

const hand = (v: ReturnType<typeof venue>, from: string, itemId: string, to: string) => {
  const params = { itemId, targetId: to }
  const intent = submitIntent(v.state, CFG, from, 'give', params)
  expect(intent.ok).toBe(true)
  if (!intent.ok) return []
  v.apply(intent.events)
  v.log('action_completed', { agentId: from, verb: 'give' })
  const events = VERBS.give!.onComplete(v.state, CFG, from, params, RNG)
  return v.apply(events)
}

const take = (v: ReturnType<typeof venue>, agentId: string) => {
  const params = { itemId: 'loaf' }
  const intent = submitIntent(v.state, CFG, agentId, 'take', params)
  expect(intent.ok).toBe(true)
  if (!intent.ok) return []
  v.apply(intent.events)
  v.log('action_completed', { agentId, verb: 'take' })
  return v.apply(VERBS.take!.onComplete(v.state, CFG, agentId, params, RNG))
}

describe('one local venue exchange', () => {
  it('moves goods only after hands act and resolves one promise with transfer evidence', () => {
    const v = venue()
    words(v, 'seller', 'One loaf for one plank?')
    words(v, 'buyer', 'Yes, I agree.')
    v.ties.apply(
      [{ agentId: 'seller', personId: 'buyer', kind: 'promise', text: 'One loaf for one plank.' }],
      0,
    )
    const promise = v.ties.open()[0]!
    expect(v.state.items.loaf!.loc).toEqual({ t: 'structure', id: 'stall' })
    expect(v.state.items.plank!.loc).toEqual({ t: 'agent', id: 'buyer' })
    expect(promise.resolution).toBeNull()

    take(v, 'seller')
    const plankMove = hand(v, 'buyer', 'plank', 'seller').find((e) => e.type === 'item_moved')!
    expect(v.ties.open()).toHaveLength(1)
    const loafMove = hand(v, 'seller', 'loaf', 'buyer').find((e) => e.type === 'item_moved')!
    v.ties.apply(
      [
        {
          agentId: 'seller',
          personId: 'buyer',
          kind: 'promise',
          text: promise.text,
          tieId: promise.id,
          resolution: 'fulfilled',
          evidenceSeqs: [plankMove.seq, loafMove.seq],
        },
      ],
      1,
    )
    expect(v.state.items.loaf).toMatchObject({
      owner: 'buyer',
      madeBy: 'seller',
      loc: { t: 'agent', id: 'buyer' },
    })
    expect(v.state.items.plank).toMatchObject({
      owner: 'seller',
      madeBy: 'buyer',
      loc: { t: 'agent', id: 'seller' },
    })
    expect(v.ties.open()).toEqual([])
    const before = stateHash(v.state)
    const { replayed, remembered } = v.reload()
    expect(stateHash(replayed)).toBe(before)
    expect(remembered[0]).toMatchObject({
      resolution: 'fulfilled',
      evidenceSeqs: [plankMove.seq, loafMove.seq],
    })
  })

  it('preserves refusal and accessible theft as different outcomes', () => {
    const v = venue()
    words(v, 'seller', 'One loaf for one plank?')
    words(v, 'buyer', 'No.')
    expect(v.ties.open()).toEqual([])
    expect(v.state.items.loaf!.loc).toEqual({ t: 'structure', id: 'stall' })
    const events = take(v, 'buyer')
    expect(events.some((e) => e.type === 'item_taken')).toBe(true)
    expect(v.state.items.loaf).toMatchObject({ owner: 'seller', loc: { t: 'agent', id: 'buyer' } })
    const before = stateHash(v.state)
    const { replayed, remembered } = v.reload()
    expect(stateHash(replayed)).toBe(before)
    expect(remembered).toEqual([])
  })

  it('keeps the promise open when the recipient moves away before the second transfer', () => {
    const v = venue()
    words(v, 'seller', 'One loaf for one plank?')
    words(v, 'buyer', 'Yes, I agree.')
    v.ties.apply(
      [{ agentId: 'seller', personId: 'buyer', kind: 'promise', text: 'One loaf for one plank.' }],
      0,
    )
    take(v, 'seller')
    hand(v, 'buyer', 'plank', 'seller')
    const pending = submitIntent(v.state, CFG, 'seller', 'give', {
      itemId: 'loaf',
      targetId: 'buyer',
    })
    expect(pending.ok).toBe(true)
    if (pending.ok) v.apply(pending.events)
    v.log('agent_moved', { id: 'buyer', x: 7, y: 7 })
    expect(
      VERBS.give!.onComplete(v.state, CFG, 'seller', { itemId: 'loaf', targetId: 'buyer' }, RNG),
    ).toEqual([])
    v.log('action_interrupted', { agentId: 'seller', reason: 'recipient moved away' })
    expect(v.state.items.loaf!.loc).toEqual({ t: 'agent', id: 'seller' })
    expect(v.ties.open()).toHaveLength(1)
    const before = stateHash(v.state)
    const { replayed, remembered } = v.reload()
    expect(stateHash(replayed)).toBe(before)
    expect(remembered[0]).toMatchObject({ resolution: null, settledTick: null })
  })
})
