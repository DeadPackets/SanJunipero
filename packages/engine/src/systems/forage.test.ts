import { describe, it, expect } from 'vitest'
import { DAYS_PER_SEASON, MINUTES_PER_DAY, SimConfigSchema, stateHash, type SimConfig, type SimEvent } from '@sj/shared'
import { FORAGEABLE_KINDS, FORAGEABLE_PROSE, FORAGEABLE_YIELD } from '../data/forageables.js'
import { ForageableSpawned } from '../events.def.js'
import { fold } from '../fold.js'
import { composePerception } from '../perception.js'
import type { RngState, RngStreams } from '../rng.js'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { VERBS } from '../verbs.js'
import { createWorldTick, type WorldTickResult } from '../worldTick.js'
import { FORAGE_REGROW_CHANCE } from './forage.js'

const QUIET = { weather: { hourlyChangeChance: 0 }, mystery: { chancePerDay: 0 }, mapGrowth: { enabled: false } }
const CFG: SimConfig = SimConfigSchema.parse(QUIET)

function forced(values: number[]): RngStreams {
  let i = 0
  const nextValue = (): number => values[i++ % values.length]!
  const stream = {
    next: nextValue,
    int: (max: number) => Math.floor(nextValue() * max),
    state: (): RngState => [0, 0, 0, 0],
  }
  return { get: () => stream } as unknown as RngStreams
}

const CHAR_TILE: Record<string, TileId> = { '.': 0, f: 3 }
let seq = 41000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })

// A clearing with the wood at its southern edge, so the C9 forest-adjacency forage still works.
const CLEARING = ['..', 'ff']

function patch(
  kind: string, stock: number, at: [number, number] = [1, 0], rows = CLEARING,
): WorldState {
  let s = genesisState(CFG, rows.map((row) => [...row].map((c) => CHAR_TILE[c]!)))
  s = fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }), CFG)
  return fold(s, ev('forageable_spawned', { id: 'node_1', kind, x: at[0], y: at[1], stock }), CFG)
}

const picked = (s: WorldState, params: Record<string, unknown> = { nodeId: 'node_1' }) =>
  VERBS.forage!.onComplete(s, CFG, 'a1', params, forced([0]).get('forage'))

const DAWN = MINUTES_PER_DAY + 6 * 60
const WINTER_DAWN = (3 * DAYS_PER_SEASON + 1) * MINUTES_PER_DAY + 6 * 60

function dawn(s: WorldState, tick: number, rng: RngStreams): WorldTickResult {
  return createWorldTick(CFG, rng)(fold({ ...s, tick: tick - 1 }, ev('tick_advanced', {}, tick), CFG))
}
const typed = (r: WorldTickResult, type: string) => r.events.filter((e) => e.type === type)

describe('forageables: absence is the default', () => {
  it('a fresh world has no forageables key and hashes like a pre-C11 world', () => {
    const fresh = genesisState(CFG, [[0]])
    expect(fresh.forageables).toBeUndefined()
    expect('forageables' in fresh).toBe(false)
    expect(stateHash(fresh)).toBe(stateHash(genesisState(CFG, [[0]])))
  })
})

describe('forage: with a node named, and without', () => {
  it('a berry bush yields berries and the node keeps one fewer', () => {
    const out = picked(patch('berry_bush', 2))
    expect(out).toEqual([
      { type: 'forageable_stock_changed', payload: { id: 'node_1', stock: 1 } },
      { type: 'item_spawned', payload: {
        id: 'item_2', kind: 'berries', qty: 1, loc: { t: 'agent', id: 'a1' },
        owner: 'a1', spoilage: { spawnDay: 0, days: 3 },
      } },
    ])
  })

  it('the last handful empties it, and the bush stays standing at nothing', () => {
    let s = patch('berry_bush', 1)
    const out = picked(s)
    expect(out[0]).toEqual({ type: 'forageable_depleted', payload: { id: 'node_1' } })
    for (const e of out) s = fold(s, ev(e.type, e.payload), CFG)
    expect(s.forageables!.node_1).toEqual({ kind: 'berry_bush', x: 1, y: 0, stock: 0 })
  })

  it('a pale patch yields the pale mushroom, and a safe patch yields one you can eat', () => {
    const pale = picked(patch('pale_mushroom_patch', 3))[1]!.payload as { kind: string }
    expect(pale.kind).toBe('pale_mushroom')
    const safe = picked(patch('mushroom_patch', 3))[1]!.payload as { kind: string }
    expect(safe.kind).toBe('mushroom')
  })

  it('with no node named it is still exactly the C9 forest-adjacency forage', () => {
    const s = patch('berry_bush', 3)
    expect(picked(s, {})).toEqual([
      { type: 'item_spawned', payload: {
        id: 'item_2', kind: 'berries', qty: CFG.wildlife.forageYieldBySeason.spring,
        loc: { t: 'agent', id: 'a1' }, owner: 'a1', spoilage: { spawnDay: 0, days: 3 },
      } },
    ])
  })

  it('refuses a node that is bare, one out of reach, and one that is not there', () => {
    const bare = VERBS.forage!.validate(patch('berry_bush', 0), CFG, 'a1', { nodeId: 'node_1' })
    expect(bare).toBe('there is nothing left to take here')
    const far = VERBS.forage!.validate(
      patch('berry_bush', 3, [3, 0], ['....', 'ffff']), CFG, 'a1', { nodeId: 'node_1' })
    expect(far).toMatch(/^not close enough to gather — the patch is at \(/)
    expect(VERBS.forage!.validate(patch('berry_bush', 3), CFG, 'a1', { nodeId: 'node_9' })).toBe('nothing of the kind there')
  })
})

describe('forageSystem: what the ground puts back', () => {
  const empty = () => {
    const s = patch('berry_bush', 1)
    return fold(s, ev('forageable_depleted', { id: 'node_1' }), CFG)
  }

  it('a depleted node comes back on a forced roll, and a standing one is left alone', () => {
    const out = dawn(empty(), DAWN, forced([0]))
    expect(typed(out, 'forageable_regrown').map((e) => e.payload)).toEqual([{ id: 'node_1', stock: 1 }])
    expect(out.state.forageables!.node_1!.stock).toBe(1)
    expect(typed(dawn(patch('berry_bush', 2), DAWN, forced([0])), 'forageable_regrown')).toEqual([])
  })

  it('a roll above the chance puts nothing back', () => {
    expect(typed(dawn(empty(), DAWN, forced([FORAGE_REGROW_CHANCE])), 'forageable_regrown')).toEqual([])
  })

  it('nothing grows in winter, however the roll falls', () => {
    expect(typed(dawn(empty(), WINTER_DAWN, forced([0])), 'forageable_regrown')).toEqual([])
  })

  it('the roll comes once a day, at dawn and at no other hour', () => {
    expect(typed(dawn(empty(), DAWN + 60, forced([0])), 'forageable_regrown')).toEqual([])
  })
})

describe('forageables: what a body can see of them', () => {
  const seen = (s: WorldState) => composePerception(s, CFG, 'a1', []).visible.forageables

  it('reads abundance or bareness, and never a number', () => {
    expect(seen(patch('berry_bush', 2))).toEqual([
      { id: 'node_1', kind: 'berry_bush', x: 1, y: 0, prose: FORAGEABLE_PROSE.berry_bush.standing },
    ])
    const bare = seen(fold(patch('berry_bush', 1), ev('forageable_depleted', { id: 'node_1' }), CFG))
    expect(bare[0]!.prose).toBe('the berry bushes are picked bare')
    for (const { standing, bare: empty } of Object.values(FORAGEABLE_PROSE)) {
      expect(standing).not.toMatch(/\d/)
      expect(empty).not.toMatch(/\d/)
    }
  })

  it('is empty behind four walls and empty in a world with no nodes', () => {
    expect(seen(fold(genesisState(CFG, [[0]]), ev('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }), CFG)))
      .toEqual([])
    const roofed = fold(fold(patch('berry_bush', 2, [1, 0], ['...', '...', 'fff']), ev('structure_planned', {
      id: 'structure_1', kind: 'house', x: 0, y: 1, w: 3, h: 2, maxHp: 30, flammable: true, builderId: 'a1',
    }), CFG), ev('agent_entered', { agentId: 'a1', structureId: 'structure_1' }), CFG)
    expect(seen(roofed)).toEqual([])
  })
})

describe('the kind table and the event schema are one list', () => {
  it('every authored kind spawns, yields something, and reads as prose', () => {
    for (const kind of FORAGEABLE_KINDS) {
      expect(ForageableSpawned.safeParse({ id: 'node_1', kind, x: 0, y: 0, stock: 1 }).success).toBe(true)
      expect(FORAGEABLE_YIELD[kind]).toBeTruthy()
      expect(FORAGEABLE_PROSE[kind].standing).toBeTruthy()
    }
  })

  it('a reed bed hands up fiber, which is the one thing the loom was missing', () => {
    const s = patch('reed_bed', 2)
    expect(VERBS.forage!.validate(s, CFG, 'a1', { nodeId: 'node_1' })).toBeNull()
    expect(picked(s).some((e) => e.type === 'item_spawned' && (e.payload as { kind: string }).kind === 'fiber')).toBe(true)
  })
})
