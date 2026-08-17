import { describe, it, expect, afterEach } from 'vitest'
import {
  DAYS_PER_SEASON, DEFAULT_CONFIG, MINUTES_PER_DAY, SimConfigSchema, type SimConfig, type SimEvent,
} from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { composePerception } from './perception.js'
import { stepCostAt } from './path.js'
import { RngStreams, type RngStream } from './rng.js'
import { fishCatchChance, huntChance, registerVerb, unregisterVerb, VERBS, type VerbDef } from './verbs.js'

const CHAR_TILE: Record<string, TileId> = { '.': 0, '~': 2, p: 8 }
const ev = (seq: number, type: string, payload: unknown): SimEvent => ({ seq, tick: 0, type, payload })

function makeWorld(rows: string[] = ['........', '........', '........', '........']): WorldState {
  const s = genesisState(DEFAULT_CONFIG, rows.map((row) => [...row].map((c) => CHAR_TILE[c]!)))
  return fold(s, ev(1, 'agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }))
}

const testVerb: VerbDef = {
  kind: 'recipe:test',
  validate() { return null },
  duration() { return 1 },
  onComplete() { return [] },
  interruptible: true,
}

const TIER1 = [
  'walk', 'sleep', 'wake', 'enter', 'exit', 'eat', 'tend', 'till', 'plant', 'harvest', 'fish', 'forage',
  'build', 'craft', 'extinguish', 'drink', 'fill', 'dig_channel', 'douse', 'pave', 'hunt',
  'speak', 'give', 'take', 'stow', 'write', 'read', 'inscribe', 'teach', 'attack', 'experiment',
]

afterEach(() => { unregisterVerb('recipe:test') })

describe('verb registry seam', () => {
  it('registerVerb registers a codified recipe verb end-to-end', () => {
    const s = makeWorld()
    registerVerb(testVerb)
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'recipe:test', {})
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.events).toContainEqual({
      type: 'action_started',
      payload: { agentId: 'a1', verb: 'recipe:test', params: {}, duration: 1 },
    })
  })

  it('registerVerb throws on a duplicate kind', () => {
    expect(() => registerVerb({ ...testVerb, kind: 'walk' })).toThrow(/already registered/)
  })

  it('unregisterVerb removes a verb; unknown and absent kinds are no-ops', () => {
    registerVerb(testVerb)
    unregisterVerb('recipe:test')
    expect(submitIntent(makeWorld(), DEFAULT_CONFIG, 'a1', 'recipe:test', {})).toEqual({
      ok: false, reason: 'unknown verb: recipe:test',
    })
    expect(() => unregisterVerb('never_existed')).not.toThrow()
  })

  it('all Tier-1 verbs still resolve, and TIER1 is the whole built-in registry', () => {
    for (const v of TIER1) expect(VERBS[v]).toBeDefined()
    expect(Object.keys(VERBS).sort()).toEqual([...TIER1].sort())
    const r = submitIntent(makeWorld(), DEFAULT_CONFIG, 'a1', 'eat', { itemId: 'ghost' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).not.toBe('unknown verb: eat')
  })

  it('VerbDef.kind is a string that accepts a literal Tier-1 verb unchanged', () => {
    const def: VerbDef = {
      kind: 'walk',
      validate: () => null,
      duration: () => 1,
      onComplete: () => [],
      interruptible: true,
    }
    expect(def.kind).toBe('walk')
  })
})

describe('eat: a last-day meal and the pale mushroom', () => {
  const cfg = (mortality: Record<string, unknown>): SimConfig => SimConfigSchema.parse({ mortality })
  const POISONS = cfg({ poisonChanceSpoiled: 1 })
  const SPARES = cfg({ poisonChanceSpoiled: 0 })
  const OFF = cfg({ enabled: false, poisonChanceSpoiled: 1 })
  const DAY = 1440

  function holding(kind: string, spoilage?: { spawnDay: number; days: number }, day = 0): WorldState {
    const s = fold(makeWorld(), ev(2, 'item_spawned', {
      id: 'item_1', kind, qty: 1, loc: { t: 'agent', id: 'a1' }, ...(spoilage ? { spoilage } : {}),
    }))
    return { ...s, tick: day * DAY }
  }
  const eaten = (s: WorldState, config: SimConfig, rng: RngStream) =>
    VERBS.eat!.onComplete(s, config, 'a1', { itemId: 'item_1' }, rng)
  const illness = (seed = 'poison') => new RngStreams(seed).get('illness')

  it('draws its roll from the illness stream, and a pale mushroom is food you may eat', () => {
    expect(VERBS.eat!.rngStream).toBe('illness')
    const r = submitIntent(holding('pale_mushroom'), DEFAULT_CONFIG, 'a1', 'eat', { itemId: 'item_1' })
    expect(r.ok).toBe(true)
  })

  it('poisons on a pale mushroom when the roll goes against the eater, and still feeds them', () => {
    const out = eaten(holding('pale_mushroom'), POISONS, illness())
    expect(out[0]).toEqual({
      type: 'agent_afflicted', payload: { agentId: 'a1', kind: 'poison', severity: 1, itemId: 'item_1' },
    })
    expect(out).toContainEqual({
      type: 'need_changed', payload: { id: 'a1', need: 'hunger', delta: POISONS.needs.eatRestoreHunger },
    })
  })

  it('spares the eater when the roll goes their way, and the meal still counts', () => {
    const out = eaten(holding('pale_mushroom'), SPARES, illness())
    expect(out.map((e) => e.type)).toEqual(['item_qty_changed', 'need_changed'])
  })

  it('rolls on a loaf on its last day, and not one day earlier', () => {
    const spoiling = holding('bread', { spawnDay: 0, days: 6 }, 5)
    expect(eaten(spoiling, POISONS, illness()).map((e) => e.type)).toContain('agent_afflicted')

    const fresh = holding('bread', { spawnDay: 0, days: 6 }, 4)
    const rng = illness()
    const before = rng.state()
    expect(eaten(fresh, POISONS, rng).map((e) => e.type)).not.toContain('agent_afflicted')
    expect(rng.state()).toEqual(before)
  })

  it('never draws at all when the world has mortality switched off', () => {
    const rng = illness()
    const before = rng.state()
    expect(eaten(holding('pale_mushroom'), OFF, rng).map((e) => e.type)).not.toContain('agent_afflicted')
    expect(rng.state()).toEqual(before)
  })

  it('an herb takes a step off the worst thing wrong, and lifts it outright at the last step', () => {
    const CFG = SimConfigSchema.parse({})
    let s = holding('herb')
    s = fold(s, ev(4, 'agent_afflicted', { agentId: 'a1', kind: 'illness', severity: 3 }))
    s = fold(s, ev(5, 'agent_afflicted', { agentId: 'a1', kind: 'poison', severity: 1 }))
    expect(eaten(s, CFG, illness())).toContainEqual({
      type: 'affliction_worsened', payload: { agentId: 'a1', kind: 'illness', severity: 3 - CFG.mortality.herbRelief },
    })
    let last = holding('herb')
    last = fold(last, ev(6, 'agent_afflicted', { agentId: 'a1', kind: 'poison', severity: 1 }))
    expect(eaten(last, CFG, illness())).toContainEqual({
      type: 'affliction_recovered', payload: { agentId: 'a1', kind: 'poison' },
    })
  })

  it('tells the eye a pale mushroom and nothing more: which ones kill is the town\'s to learn', () => {
    const s = fold(makeWorld(), ev(3, 'item_spawned', {
      id: 'item_1', kind: 'pale_mushroom', qty: 1, loc: { t: 'tile', x: 1, y: 1 },
    }))
    const seen = composePerception(s, DEFAULT_CONFIG, 'a1', []).visible.items
    expect(seen.find((i) => i.kind === 'pale_mushroom')).toBeDefined()
    expect(JSON.stringify(seen)).not.toMatch(/warn|danger|poison|deadly/i)
  })
})

describe('tend: an hour of another body\'s hands', () => {
  const CFG = SimConfigSchema.parse({})

  function pair(): WorldState {
    let s = genesisState(CFG, ['....', '....', '....', '....'].map((row) => [...row].map((c) => CHAR_TILE[c]!)))
    s = fold(s, ev(1, 'agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }), CFG)
    s = fold(s, ev(2, 'agent_spawned', { id: 'a2', name: 'a2', x: 1, y: 0, ageDays: 7300 }), CFG)
    return { ...s, agents: { ...s.agents, a1: { ...s.agents.a1!, hp: 50 } } }
  }
  const complete = (s: WorldState, params: Record<string, unknown>) =>
    VERBS.tend!.onComplete(s, CFG, 'a2', params, new RngStreams('t').get('actions'))

  it('takes three ticks, names the tender, and reads as a C9 log when it has to', () => {
    expect(VERBS.tend!.duration(pair(), CFG, 'a2', { targetId: 'a1' })).toBe(3)
    expect(complete(pair(), { targetId: 'a1' }))
      .toEqual([{ type: 'agent_tended', payload: { agentId: 'a1', tenderId: 'a2' } }])
    // A recorded C9 log carries the target and nothing else, and still folds.
    const old = fold(pair(), ev(3, 'agent_tended', { agentId: 'a1' }), CFG)
    expect(old.agents.a1!.tendedTick).toBe(0)
  })

  it('refuses across a wall, however close the two bodies stand', () => {
    let s = pair()
    s = fold(s, ev(3, 'structure_planned', {
      id: 'structure_1', kind: 'hut', x: 2, y: 2, w: 2, h: 2, maxHp: 50, flammable: true, builderId: 'a2',
    }), CFG)
    s = fold(s, ev(4, 'structure_completed', { id: 'structure_1' }), CFG)
    s = fold(s, ev(5, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' }), CFG)
    const r = submitIntent(s, CFG, 'a2', 'tend', { targetId: 'a1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('a wall is in the way')
  })

  it('an offered herb is consumed and gives double what eating it would', () => {
    let s = fold(pair(), ev(3, 'item_spawned', {
      id: 'item_1', kind: 'herb', qty: 1, loc: { t: 'agent', id: 'a2' },
    }), CFG)
    s = fold(s, ev(4, 'agent_afflicted', { agentId: 'a1', kind: 'illness', severity: 3 }), CFG)
    const out = complete(s, { targetId: 'a1', itemId: 'item_1' })
    expect(out).toEqual([
      { type: 'agent_tended', payload: { agentId: 'a1', tenderId: 'a2', itemId: 'item_1' } },
      { type: 'item_qty_changed', payload: { id: 'item_1', delta: -1 } },
      {
        type: 'affliction_worsened',
        payload: { agentId: 'a1', kind: 'illness', severity: 3 - CFG.mortality.herbRelief * 2 },
      },
    ])
  })

  it('refuses to offer something that is not a remedy, or that the tender is not holding', () => {
    const s = fold(pair(), ev(3, 'item_spawned', {
      id: 'item_1', kind: 'wood', qty: 1, loc: { t: 'agent', id: 'a2' },
    }), CFG)
    const wood = submitIntent(s, CFG, 'a2', 'tend', { targetId: 'a1', itemId: 'item_1' })
    expect(wood.ok).toBe(false)
    if (!wood.ok) expect(wood.reason).toBe('wood is not a remedy')
    const ghost = submitIntent(s, CFG, 'a2', 'tend', { targetId: 'a1', itemId: 'item_9' })
    expect(ghost.ok).toBe(false)
    if (!ghost.ok) expect(ghost.reason).toBe('not holding that')
  })
})

describe('verb: pave', () => {
  const CFG = SimConfigSchema.parse({})
  const OFF = SimConfigSchema.parse({ roads: { enabled: false } })

  function quarried(rows: string[] = ['..', '..'], qty = 1, config = CFG): WorldState {
    let s = genesisState(config, rows.map((row) => [...row].map((c) => CHAR_TILE[c]!)))
    s = fold(s, ev(1, 'agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }), config)
    if (qty === 0) return s
    return fold(s, ev(2, 'item_spawned', {
      id: 'item_1', kind: 'stone', qty, loc: { t: 'agent', id: 'a1' },
    }), config)
  }
  const laid = (s: WorldState, x: number, y: number, config = CFG) =>
    VERBS.pave!.onComplete(s, config, 'a1', { x, y }, new RngStreams('t').get('actions'))

  it('turns grass to road for one stone and six ticks of work', () => {
    const s = quarried()
    expect(VERBS.pave!.duration(s, CFG, 'a1', { x: 1, y: 0 })).toBe(CFG.roads.paveDurationTicks)
    expect(CFG.roads.paveDurationTicks).toBe(6)
    expect(laid(s, 1, 0)).toEqual([
      { type: 'item_qty_changed', payload: { id: 'item_1', delta: -CFG.roads.stonePerTile } },
      { type: 'tile_changed', payload: { x: 1, y: 0, from: 0, to: 7, reason: 'paved', byId: 'a1' } },
    ])
  })

  it('paves the dirt feet already wore, and the road it makes is the cheapest ground there is', () => {
    let s = quarried(['.p', '..'])
    expect(submitIntent(s, CFG, 'a1', 'pave', { x: 1, y: 0 }).ok).toBe(true)
    for (const e of laid(s, 1, 0)) s = fold(s, ev(9, e.type, e.payload), CFG)
    expect(s.terrain[0]![1]).toBe(7)
    expect(stepCostAt(s, 1, 0, CFG)).toBe(0.6)
  })

  it('refuses water, an empty pack, ground out of reach, and a world with no roads in it', () => {
    const wet = submitIntent(quarried(['.~', '..']), CFG, 'a1', 'pave', { x: 1, y: 0 })
    expect(wet.ok).toBe(false)
    if (!wet.ok) expect(wet.reason).toBe('nothing to pave here')
    const broke = submitIntent(quarried(['..', '..'], 0), CFG, 'a1', 'pave', { x: 1, y: 0 })
    expect(broke.ok).toBe(false)
    if (!broke.ok) expect(broke.reason).toBe('not enough stone')
    expect(submitIntent(quarried(['....', '....']), CFG, 'a1', 'pave', { x: 3, y: 1 }).ok).toBe(false)
    expect(submitIntent(quarried(['..', '..'], 1, OFF), OFF, 'a1', 'pave', { x: 1, y: 0 }).ok).toBe(false)
  })
})

describe('hunt: the caps and the regen ARE the ecology', () => {
  const CFG = SimConfigSchema.parse({})

  // A stream that hands back one number: a success is a fact of the test, not of a seed.
  const roll = (v: number): RngStream => ({ next: () => v, int: (n: number) => Math.floor(v * n) }) as unknown as RngStream

  function stalked(kind: string, at: [number, number] = [1, 0], armed = true, rows = ['..', '..']): WorldState {
    let s = makeWorld(rows)
    s = fold(s, ev(40, 'fauna_spawned', { id: 'fauna_1', kind, x: at[0], y: at[1] }), CFG)
    if (armed) {
      s = fold(s, ev(41, 'item_spawned', { id: 'item_1', kind: 'knife', qty: 1, loc: { t: 'agent', id: 'a1' } }), CFG)
    }
    return s
  }

  const taken = (s: WorldState, v: number) =>
    VERBS.hunt!.onComplete(s, CFG, 'a1', { faunaId: 'fauna_1' }, roll(v))

  it('a deer taken leaves two cuts of venison and one hide; a rabbit leaves meat and no hide', () => {
    const deer = taken(stalked('deer'), 0)
    expect(deer.map((e) => e.type)).toEqual(['fauna_killed', 'item_spawned', 'item_spawned'])
    expect(deer[0]!.payload).toEqual({ id: 'fauna_1', kind: 'deer', x: 1, y: 0, byId: 'a1' })
    expect(deer.slice(1).map((e) => e.payload)).toEqual([
      { id: 'item_2', kind: 'venison', qty: 2, loc: { t: 'agent', id: 'a1' }, owner: 'a1', spoilage: { spawnDay: 0, days: 4 } },
      { id: 'item_3', kind: 'hide', qty: 1, loc: { t: 'agent', id: 'a1' }, owner: 'a1' },
    ])
    const rabbit = taken(stalked('rabbit'), 0).slice(1).map((e) => (e.payload as { kind: string }).kind)
    expect(rabbit).toEqual(['rabbit_meat'])
  })

  it('two carcass yields get two ids, and the world folds both', () => {
    let s = stalked('deer')
    for (const e of taken(s, 0)) s = fold(s, ev(50, e.type, e.payload), CFG)
    expect(s.fauna).toBeUndefined()
    expect(Object.values(s.items).map((i) => i.kind).sort()).toEqual(['hide', 'knife', 'venison'])
    expect(s.counters.nextEntityId).toBe(4)
  })

  it('a missed approach spends the animal, not the hunter: it bolts two tiles and drops nothing', () => {
    const missed = taken(stalked('deer', [1, 0], true, ['....', '....']), 0.99)
    expect(missed).toEqual([{ type: 'fauna_moved', payload: { moves: [{ id: 'fauna_1', x: 3, y: 0 }] } }])
  })

  it('the odds are skill against the animal, and they cap at certainty', () => {
    const s = stalked('deer')
    expect(huntChance(s, CFG, 'a1', 'deer')).toBeCloseTo(1 / 4)
    expect(huntChance(s, CFG, 'a1', 'rabbit')).toBeCloseTo(1 / 3)
    const skilled = fold(s, ev(60, 'skill_gained', { agentId: 'a1', track: 'foraging', xp: 900 }), CFG)
    expect(huntChance(skilled, CFG, 'a1', 'deer')).toBe(1)
  })

  it('refuses bare hands, a body out of reach, a school, and a tile with nothing on it', () => {
    const bare = submitIntent(stalked('deer', [1, 0], false), CFG, 'a1', 'hunt', { faunaId: 'fauna_1' })
    expect(bare.ok).toBe(false)
    if (!bare.ok) expect(bare.reason).toBe('you have nothing to hunt with')

    const far = submitIntent(stalked('deer', [2, 0], true, ['...', '...']), CFG, 'a1', 'hunt', { faunaId: 'fauna_1' })
    expect(far.ok).toBe(false)
    if (!far.ok) expect(far.reason).toBe('too far off to reach')

    const school = submitIntent(stalked('fish'), CFG, 'a1', 'hunt', { faunaId: 'fauna_1' })
    expect(school.ok).toBe(false)
    if (!school.ok) expect(school.reason).toBe('that is not something you can run down')

    const empty = submitIntent(makeWorld(), CFG, 'a1', 'hunt', { faunaId: 'fauna_9' })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.reason).toBe('nothing there to hunt')
  })
})

describe('fish: a school is where the fish are', () => {
  const CFG = SimConfigSchema.parse({})
  const OFF = SimConfigSchema.parse({ fauna: { enabled: false } })

  function cast(stock: number | null, config = CFG): WorldState {
    const s = makeWorld(['.~', '.~'])
    if (stock === null) return s
    return fold(s, ev(70, 'fauna_spawned', { id: 'fauna_1', kind: 'fish', x: 1, y: 0, stock }), config)
  }

  const roll = (v: number): RngStream => ({ next: () => v, int: () => 0 }) as unknown as RngStream
  const catches = (s: WorldState, v: number, config = CFG) =>
    VERBS.fish!.onComplete(s, config, 'a1', { x: 1, y: 0 }, roll(v))

  it('doubles the odds within two tiles of a school and leaves them alone with the law off', () => {
    const plain = fishCatchChance(cast(null), CFG, 'a1', 1, 0)
    expect(fishCatchChance(cast(3), CFG, 'a1', 1, 0)).toBeCloseTo(plain * 2)
    expect(fishCatchChance(cast(3, OFF), OFF, 'a1', 1, 0)).toBeCloseTo(plain)
  })

  it('doubles the measured catch rate over 200 rolls of the same stream', () => {
    const stream = new RngStreams('school').get('wildlife')
    const draws = Array.from({ length: 200 }, () => stream.next())
    const rate = (s: WorldState) => draws.filter((d) => catches(s, d).length > 0).length
    const without = rate(cast(null))
    const withSchool = rate(cast(200))
    expect(without).toBeGreaterThan(0)
    expect(withSchool / without).toBeGreaterThan(1.7)
    expect(withSchool / without).toBeLessThan(2.3)
  })

  it('takes one fish from the school per catch, and the school disbands on the last one', () => {
    expect(catches(cast(3), 0)[0]).toEqual({ type: 'fauna_stock_changed', payload: { id: 'fauna_1', stock: 2 } })
    const last = catches(cast(1), 0)
    expect(last[0]).toEqual({ type: 'fauna_killed', payload: { id: 'fauna_1', kind: 'fish', x: 1, y: 0, byId: 'a1' } })
    let s = cast(1)
    for (const e of last) s = fold(s, ev(80, e.type, e.payload), CFG)
    expect(s.fauna).toBeUndefined()
    expect(s.wildlife.fish).toBe(CFG.wildlife.fishMax - 1)
  })

  it('winter halves what the school doubles, and the two compose to exactly the plain day', () => {
    const plain = fishCatchChance(cast(null), CFG, 'a1', 1, 0)
    const cold = { ...cast(3), tick: 3 * DAYS_PER_SEASON * MINUTES_PER_DAY }
    expect(CFG.seasons.winter.fishCatchMultiplier * CFG.fauna.fishSchoolBonus).toBe(1)
    expect(fishCatchChance(cold, CFG, 'a1', 1, 0)).toBeCloseTo(plain)
  })
})
