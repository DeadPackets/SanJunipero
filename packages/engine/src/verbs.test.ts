import { describe, it, expect, afterEach } from 'vitest'
import {
  DAYS_PER_SEASON,
  DEFAULT_CONFIG,
  MINUTES_PER_DAY,
  SimConfigSchema,
  type SimConfig,
  type SimEvent,
} from '@sj/shared'
import { ITEM_CLASSES, stateHash } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { createWorldTick } from './worldTick.js'
import { insulationOf, isExposed } from './systems/warmth.js'
import { submitIntent } from './intent.js'
import { composePerception } from './perception.js'
import { stepCostAt } from './path.js'
import { RngStreams, type RngStream } from './rng.js'
import {
  fishCatchChance,
  huntChance,
  isFoodKind,
  isKindleable,
  isWearable,
  nutritionOf,
  registerVerb,
  craftRoutes,
  SEED_RECIPES,
  unregisterVerb,
  VERBS,
  WEAPON_KINDS,
  weaponKindsFor,
  type VerbDef,
} from './verbs/index.js'
import { FORAGEABLE_YIELD } from './data/forageables.js'

const CHAR_TILE: Record<string, TileId> = { '.': 0, '~': 2, p: 8 }
const ev = (seq: number, type: string, payload: unknown): SimEvent => ({
  seq,
  tick: 0,
  type,
  payload,
})

function makeWorld(rows: string[] = ['........', '........', '........', '........']): WorldState {
  const s = genesisState(
    DEFAULT_CONFIG,
    rows.map((row) => Array.from(row).map((c) => CHAR_TILE[c]!)),
  )
  return fold(s, ev(1, 'agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }))
}

const testVerb: VerbDef = {
  kind: 'recipe:test',
  validate() {
    return null
  },
  duration() {
    return 1
  },
  onComplete() {
    return []
  },
}

const TIER1 = [
  'walk',
  'sleep',
  'wake',
  'enter',
  'exit',
  'eat',
  'tend',
  'till',
  'plant',
  'harvest',
  'fish',
  'forage',
  'build',
  'craft',
  'extinguish',
  'drink',
  'fill',
  'dig_channel',
  'douse',
  'pave',
  'hunt',
  'wear',
  'doff',
  'kindle',
  'snuff',
  'stoke',
  'chop',
  'speak',
  'give',
  'take',
  'drop',
  'stow',
  'write',
  'read',
  'inscribe',
  'teach',
  'attack',
  'experiment',
]

afterEach(() => {
  unregisterVerb('recipe:test')
})

describe('verb registry seam', () => {
  it('registerVerb registers a codified recipe verb end-to-end', () => {
    const s = makeWorld()
    registerVerb(testVerb)
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'recipe:test', {})
    expect(r.ok).toBe(true)
    if (r.ok)
      expect(r.events).toContainEqual({
        type: 'action_started',
        payload: { agentId: 'a1', verb: 'recipe:test', params: {}, duration: 1 },
      })
  })

  it('registerVerb throws on a duplicate kind', () => {
    expect(() => {
      registerVerb({ ...testVerb, kind: 'walk' })
    }).toThrow(/already registered/)
  })

  it('unregisterVerb removes a verb; unknown and absent kinds are no-ops', () => {
    registerVerb(testVerb)
    unregisterVerb('recipe:test')
    expect(submitIntent(makeWorld(), DEFAULT_CONFIG, 'a1', 'recipe:test', {})).toEqual({
      ok: false,
      reason: 'unknown verb: recipe:test',
    })
    expect(() => {
      unregisterVerb('never_existed')
    }).not.toThrow()
  })

  it('all Tier-1 verbs still resolve, and TIER1 is the whole built-in registry', () => {
    for (const v of TIER1) expect(VERBS[v]).toBeDefined()
    expect(Object.keys(VERBS).sort()).toEqual([...TIER1].sort())
    const r = submitIntent(makeWorld(), DEFAULT_CONFIG, 'a1', 'eat', { itemId: 'ghost' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).not.toBe('unknown verb: eat')
  })

  // ★ A param-shape refusal reaches the mind whole now, so a brace in one is the schema
  // talking. Run D erased 36 refusals that way and taught five minds nothing.
  it('★ no built-in verb answers a malformed ask with its own parameter schema', () => {
    const s = makeWorld()
    for (const kind of TIER1) {
      const reason = VERBS[kind]!.validate(s, DEFAULT_CONFIG, 'a1', {})
      if (reason === null) continue
      expect(reason, kind).not.toMatch(/[{}]/)
    }
  })

  it('VerbDef.kind is a string that accepts a literal Tier-1 verb unchanged', () => {
    const def: VerbDef = {
      kind: 'walk',
      validate: () => null,
      duration: () => 1,
      onComplete: () => [],
    }
    expect(def.kind).toBe('walk')
  })
})

describe('eat: a last-day meal and the pale mushroom', () => {
  const cfg = (mortality: Record<string, unknown>): SimConfig =>
    SimConfigSchema.parse({ mortality })
  const POISONS = cfg({ poisonChanceSpoiled: 1 })
  const SPARES = cfg({ poisonChanceSpoiled: 0 })
  const OFF = cfg({ enabled: false, poisonChanceSpoiled: 1 })
  const DAY = 1440

  function holding(
    kind: string,
    spoilage?: { spawnDay: number; days: number },
    day = 0,
  ): WorldState {
    const s = fold(
      makeWorld(),
      ev(2, 'item_spawned', {
        id: 'item_1',
        kind,
        qty: 1,
        loc: { t: 'agent', id: 'a1' },
        ...(spoilage ? { spoilage } : {}),
      }),
    )
    return { ...s, tick: day * DAY }
  }
  const eaten = (s: WorldState, config: SimConfig, rng: RngStream) =>
    VERBS.eat!.onComplete(s, config, 'a1', { itemId: 'item_1' }, rng)
  const illness = (seed = 'poison') => new RngStreams(seed).get('illness')

  it('draws its roll from the illness stream, and a pale mushroom is food you may eat', () => {
    expect(VERBS.eat!.rngStream).toBe('illness')
    const r = submitIntent(holding('pale_mushroom'), DEFAULT_CONFIG, 'a1', 'eat', {
      itemId: 'item_1',
    })
    expect(r.ok).toBe(true)
  })

  it('poisons on a pale mushroom when the roll goes against the eater, and still feeds them', () => {
    const out = eaten(holding('pale_mushroom'), POISONS, illness())
    expect(out[0]).toEqual({
      type: 'agent_afflicted',
      payload: { agentId: 'a1', kind: 'poison', severity: 1, itemId: 'item_1' },
    })
    expect(out).toContainEqual({
      type: 'needs_changed',
      payload: {
        id: 'a1',
        changes: [
          {
            need: 'hunger',
            delta: POISONS.needs.eatRestoreHunger * nutritionOf(POISONS, 'pale_mushroom'),
          },
        ],
      },
    })
  })

  it('spares the eater when the roll goes their way, and the meal still counts', () => {
    const out = eaten(holding('pale_mushroom'), SPARES, illness())
    expect(out.map((e) => e.type)).toEqual(['item_qty_changed', 'needs_changed'])
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
    expect(eaten(holding('pale_mushroom'), OFF, rng).map((e) => e.type)).not.toContain(
      'agent_afflicted',
    )
    expect(rng.state()).toEqual(before)
  })

  // The take-then-eat seam: `eat: not holding that` rose 2 → 18 the moment the hunger line started
  // naming where the loaf was. A body that means to eat something it can reach may simply eat it.
  describe('a meal within reach is a meal', () => {
    const at = (loc: unknown, kind = 'bread'): WorldState =>
      fold(makeWorld(), ev(2, 'item_spawned', { id: 'item_1', kind, qty: 1, loc }))
    const shelf = (): WorldState => {
      const s = fold(
        at({ t: 'tile', x: 5, y: 5 }),
        ev(3, 'structure_planned', {
          id: 'structure_1',
          kind: 'storehouse',
          x: 1,
          y: 0,
          w: 1,
          h: 1,
          maxHp: 30,
          flammable: true,
          builderId: 'a1',
        }),
      )
      const done = fold(s, ev(4, 'structure_completed', { id: 'structure_1' }))
      return fold(
        done,
        ev(5, 'item_moved', { id: 'item_1', loc: { t: 'structure', id: 'structure_1' } }),
      )
    }

    it('a loaf at the feet is eaten without a turn spent picking it up', () => {
      const s = at({ t: 'tile', x: 1, y: 0 })
      const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'eat', { itemId: 'item_1' })
      expect(r.ok).toBe(true)
      const out = VERBS.eat!.onComplete(s, DEFAULT_CONFIG, 'a1', { itemId: 'item_1' }, illness())
      // The lifting comes first and is the same lifting `take` does, ownership and all.
      expect(out[0]).toEqual({
        type: 'item_moved',
        payload: { id: 'item_1', loc: { t: 'agent', id: 'a1' } },
      })
      expect(out).toContainEqual({
        type: 'item_owner_changed',
        payload: { id: 'item_1', owner: 'a1' },
      })
      expect(out.map((e) => e.type)).toContain('needs_changed')
    })

    it('a loaf on a shelf the body stands beside is the same', () => {
      expect(submitIntent(shelf(), DEFAULT_CONFIG, 'a1', 'eat', { itemId: 'item_1' }).ok).toBe(true)
    })

    it('the meal still counts as its own kind, so the variety window sees it', () => {
      const s = at({ t: 'tile', x: 1, y: 0 }, 'fish')
      expect(VERBS.eat!.results!(s, DEFAULT_CONFIG, 'a1', { itemId: 'item_1' })).toEqual({
        kind: 'fish',
      })
    })

    it('a loaf across the clearing is still a walk, and the refusal says so', () => {
      expect(
        submitIntent(at({ t: 'tile', x: 5, y: 5 }), DEFAULT_CONFIG, 'a1', 'eat', {
          itemId: 'item_1',
        }),
      ).toEqual({ ok: false, reason: 'not holding that — go and stand beside it first' })
    })

    it('a loaf in another pair of hands is not within anybody else’s reach', () => {
      const s = fold(
        at({ t: 'tile', x: 1, y: 0 }),
        ev(3, 'agent_spawned', { id: 'a2', name: 'a2', x: 1, y: 0, ageDays: 7300 }),
      )
      const held = fold(s, ev(4, 'item_moved', { id: 'item_1', loc: { t: 'agent', id: 'a2' } }))
      expect(submitIntent(held, DEFAULT_CONFIG, 'a1', 'eat', { itemId: 'item_1' })).toEqual({
        ok: false,
        reason: 'someone is holding that',
      })
    })

    it('a mark for nothing that exists still says only that the hands are empty', () => {
      expect(
        submitIntent(makeWorld(), DEFAULT_CONFIG, 'a1', 'eat', { itemId: 'item_nowhere' }),
      ).toEqual({ ok: false, reason: 'not holding that' })
    })

    it('taking somebody else’s supper off the ground is still seen', () => {
      const s = fold(
        at({ t: 'tile', x: 1, y: 0 }),
        ev(3, 'item_owner_changed', { id: 'item_1', owner: 'a2' }),
      )
      const out = VERBS.eat!.onComplete(s, DEFAULT_CONFIG, 'a1', { itemId: 'item_1' }, illness())
      expect(out.map((e) => e.type)).toContain('item_taken')
    })
  })

  it('an herb takes a step off the worst thing wrong, and lifts it outright at the last step', () => {
    const CFG = SimConfigSchema.parse({})
    let s = holding('herb')
    s = fold(s, ev(4, 'agent_afflicted', { agentId: 'a1', kind: 'illness', severity: 3 }))
    s = fold(s, ev(5, 'agent_afflicted', { agentId: 'a1', kind: 'poison', severity: 1 }))
    expect(eaten(s, CFG, illness())).toContainEqual({
      type: 'affliction_worsened',
      payload: { agentId: 'a1', kind: 'illness', severity: 3 - CFG.mortality.herbRelief },
    })
    let last = holding('herb')
    last = fold(last, ev(6, 'agent_afflicted', { agentId: 'a1', kind: 'poison', severity: 1 }))
    expect(eaten(last, CFG, illness())).toContainEqual({
      type: 'affliction_recovered',
      payload: { agentId: 'a1', kind: 'poison' },
    })
  })

  it("tells the eye a pale mushroom and nothing more: which ones kill is the town's to learn", () => {
    const s = fold(
      makeWorld(),
      ev(3, 'item_spawned', {
        id: 'item_1',
        kind: 'pale_mushroom',
        qty: 1,
        loc: { t: 'tile', x: 1, y: 1 },
      }),
    )
    const seen = composePerception(s, DEFAULT_CONFIG, 'a1', []).visible.items
    expect(seen.find((i) => i.kind === 'pale_mushroom')).toBeDefined()
    expect(JSON.stringify(seen)).not.toMatch(/warn|danger|poison|deadly/i)
  })
})

describe("tend: an hour of another body's hands", () => {
  const CFG = SimConfigSchema.parse({})

  function pair(): WorldState {
    let s = genesisState(
      CFG,
      ['....', '....', '....', '....'].map((row) => Array.from(row).map((c) => CHAR_TILE[c]!)),
    )
    s = fold(s, ev(1, 'agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }), CFG)
    s = fold(s, ev(2, 'agent_spawned', { id: 'a2', name: 'a2', x: 1, y: 0, ageDays: 7300 }), CFG)
    return { ...s, agents: { ...s.agents, a1: { ...s.agents.a1!, hp: 50 } } }
  }
  const complete = (s: WorldState, params: Record<string, unknown>) =>
    VERBS.tend!.onComplete(s, CFG, 'a2', params, new RngStreams('t').get('actions'))

  it('takes three ticks, names the tender, and reads as a C9 log when it has to', () => {
    expect(VERBS.tend!.duration(pair(), CFG, 'a2', { targetId: 'a1' })).toBe(3)
    expect(complete(pair(), { targetId: 'a1' })).toEqual([
      { type: 'agent_tended', payload: { agentId: 'a1', tenderId: 'a2' } },
    ])
    // A recorded older log carries the target and nothing else, and still folds.
    const old = fold(pair(), ev(3, 'agent_tended', { agentId: 'a1' }), CFG)
    expect(old.agents.a1!.tendedTick).toBe(0)
  })

  it('refuses across a wall, however close the two bodies stand', () => {
    let s = pair()
    s = fold(
      s,
      ev(3, 'structure_planned', {
        id: 'structure_1',
        kind: 'house',
        x: 2,
        y: 2,
        w: 2,
        h: 2,
        maxHp: 50,
        flammable: true,
        builderId: 'a2',
      }),
      CFG,
    )
    s = fold(s, ev(4, 'structure_completed', { id: 'structure_1' }), CFG)
    s = fold(s, ev(5, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' }), CFG)
    const r = submitIntent(s, CFG, 'a2', 'tend', { targetId: 'a1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('a wall is in the way')
  })

  it('an offered herb is consumed and gives double what eating it would', () => {
    let s = fold(
      pair(),
      ev(3, 'item_spawned', {
        id: 'item_1',
        kind: 'herb',
        qty: 1,
        loc: { t: 'agent', id: 'a2' },
      }),
      CFG,
    )
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
    const s = fold(
      pair(),
      ev(3, 'item_spawned', {
        id: 'item_1',
        kind: 'wood',
        qty: 1,
        loc: { t: 'agent', id: 'a2' },
      }),
      CFG,
    )
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
    let s = genesisState(
      config,
      rows.map((row) => Array.from(row).map((c) => CHAR_TILE[c]!)),
    )
    s = fold(s, ev(1, 'agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }), config)
    if (qty === 0) return s
    return fold(
      s,
      ev(2, 'item_spawned', {
        id: 'item_1',
        kind: 'stone',
        qty,
        loc: { t: 'agent', id: 'a1' },
      }),
      config,
    )
  }
  const laid = (s: WorldState, x: number, y: number, config = CFG) =>
    VERBS.pave!.onComplete(s, config, 'a1', { x, y }, new RngStreams('t').get('actions'))

  it('turns grass to road for one stone and six ticks of work', () => {
    const s = quarried()
    expect(VERBS.pave!.duration(s, CFG, 'a1', { x: 1, y: 0 })).toBe(CFG.roads.paveDurationTicks)
    expect(CFG.roads.paveDurationTicks).toBe(6)
    expect(laid(s, 1, 0)).toEqual([
      { type: 'item_qty_changed', payload: { id: 'item_1', delta: -CFG.roads.stonePerTile } },
      {
        type: 'tile_changed',
        payload: { x: 1, y: 0, from: 0, to: 7, reason: 'paved', byId: 'a1' },
      },
    ])
  })

  it('paves the dirt feet already wore, and the road it makes is the cheapest ground there is', () => {
    let s = quarried(['.p', '..'])
    expect(submitIntent(s, CFG, 'a1', 'pave', { x: 1, y: 0 }).ok).toBe(true)
    for (const e of laid(s, 1, 0)) s = fold(s, ev(9, e.type, e.payload), CFG)
    expect(s.terrain[0]![1]).toBe(7)
    expect(stepCostAt(s, 1, 0, CFG)).toBe(0.6)
  })

  it('refuses water, an empty pack, and a world with no roads in it; out of reach is a walk', () => {
    const wet = submitIntent(quarried(['.~', '..']), CFG, 'a1', 'pave', { x: 1, y: 0 })
    expect(wet.ok).toBe(false)
    if (!wet.ok) expect(wet.reason).toBe('nothing to pave here')
    const broke = submitIntent(quarried(['..', '..'], 0), CFG, 'a1', 'pave', { x: 1, y: 0 })
    expect(broke.ok).toBe(false)
    if (!broke.ok) expect(broke.reason).toMatch(/^not enough stone — /)
    expect(submitIntent(quarried(['....', '....']), CFG, 'a1', 'pave', { x: 3, y: 1 }).ok).toBe(
      true,
    )
    expect(submitIntent(quarried(['..', '..'], 1, OFF), OFF, 'a1', 'pave', { x: 1, y: 0 }).ok).toBe(
      false,
    )
  })
})

describe('hunt: the caps and the regen ARE the ecology', () => {
  const CFG = SimConfigSchema.parse({})

  // A stream that hands back one number: a success is a fact of the test, not of a seed.
  const roll = (v: number): RngStream =>
    ({ next: () => v, int: (n: number) => Math.floor(v * n) }) as unknown as RngStream

  function stalked(
    kind: string,
    at: [number, number] = [1, 0],
    armed = true,
    rows = ['..', '..'],
  ): WorldState {
    let s = makeWorld(rows)
    s = fold(s, ev(40, 'fauna_spawned', { id: 'fauna_1', kind, x: at[0], y: at[1] }), CFG)
    if (armed) {
      s = fold(
        s,
        ev(41, 'item_spawned', {
          id: 'item_1',
          kind: 'knife',
          qty: 1,
          loc: { t: 'agent', id: 'a1' },
        }),
        CFG,
      )
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
      {
        id: 'item_2',
        kind: 'venison',
        qty: 2,
        loc: { t: 'agent', id: 'a1' },
        owner: 'a1',
        spoilage: { spawnDay: 0, days: 4 },
      },
      { id: 'item_3', kind: 'hide', qty: 1, loc: { t: 'agent', id: 'a1' }, owner: 'a1' },
    ])
    const rabbit = taken(stalked('rabbit'), 0)
      .slice(1)
      .map((e) => (e.payload as { kind: string }).kind)
    expect(rabbit).toEqual(['rabbit_meat'])
  })

  it('two carcass yields get two ids, and the world folds both', () => {
    let s = stalked('deer')
    for (const e of taken(s, 0)) s = fold(s, ev(50, e.type, e.payload), CFG)
    expect(s.fauna).toBeUndefined()
    expect(
      Object.values(s.items)
        .map((i) => i.kind)
        .sort(),
    ).toEqual(['hide', 'knife', 'venison'])
    expect(s.counters.nextEntityId).toBe(4)
  })

  it('a missed approach spends the animal, not the hunter: it bolts two tiles and drops nothing', () => {
    const missed = taken(stalked('deer', [1, 0], true, ['....', '....']), 0.99)
    expect(missed).toEqual([
      { type: 'fauna_moved', payload: { moves: [{ id: 'fauna_1', x: 3, y: 0 }] } },
    ])
  })

  it('the odds are skill against the animal, and they cap at certainty', () => {
    const s = stalked('deer')
    expect(huntChance(s, CFG, 'a1', 'deer')).toBeCloseTo(1 / 4)
    expect(huntChance(s, CFG, 'a1', 'rabbit')).toBeCloseTo(1 / 3)
    const skilled = fold(
      s,
      ev(60, 'skill_gained', { agentId: 'a1', track: 'foraging', xp: 900 }),
      CFG,
    )
    expect(huntChance(skilled, CFG, 'a1', 'deer')).toBe(1)
  })

  it('refuses bare hands, a body out of reach, a school, and a tile with nothing on it', () => {
    const bare = submitIntent(stalked('deer', [1, 0], false), CFG, 'a1', 'hunt', {
      faunaId: 'fauna_1',
    })
    expect(bare.ok).toBe(false)
    if (!bare.ok) expect(bare.reason).toBe('you have nothing to hunt with')

    const far = submitIntent(stalked('deer', [2, 0], true, ['...', '...']), CFG, 'a1', 'hunt', {
      faunaId: 'fauna_1',
    })
    expect(far.ok).toBe(false)
    if (!far.ok) expect(far.reason).toBe('too far off to reach')

    const school = submitIntent(stalked('fish'), CFG, 'a1', 'hunt', { faunaId: 'fauna_1' })
    expect(school.ok).toBe(false)
    if (!school.ok) expect(school.reason).toBe('that is not something you can run down')

    const empty = submitIntent(makeWorld(), CFG, 'a1', 'hunt', { faunaId: 'fauna_9' })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.reason).toBe('nothing there to hunt')
  })

  it('a recipe that says it makes a weapon makes one, and the knife stays a weapon regardless', () => {
    const speared = (config: SimConfig): WorldState => {
      let s = makeWorld(['..', '..'])
      s = fold(s, ev(40, 'fauna_spawned', { id: 'fauna_1', kind: 'deer', x: 1, y: 0 }), config)
      return fold(
        s,
        ev(41, 'item_spawned', {
          id: 'item_1',
          kind: 'spear',
          qty: 1,
          loc: { t: 'agent', id: 'a1' },
        }),
        config,
      )
    }
    const armed = SimConfigSchema.parse({
      crafting: {
        recipes: {
          spear: {
            inputs: { wood: 2 },
            output: { kind: 'spear', qty: 1 },
            skill: 'carpentry',
            weaponKinds: ['spear'],
          },
        },
      },
    })
    expect(weaponKindsFor(armed)).toEqual(new Set(['knife', 'spear']))
    expect(submitIntent(speared(armed), armed, 'a1', 'hunt', { faunaId: 'fauna_1' }).ok).toBe(true)

    // Undeclared, the same spear is a stick: the world's authored list is unchanged.
    expect(weaponKindsFor(CFG)).toEqual(new Set(WEAPON_KINDS))
    const bare = submitIntent(speared(CFG), CFG, 'a1', 'hunt', { faunaId: 'fauna_1' })
    expect(bare.ok).toBe(false)
    if (!bare.ok) expect(bare.reason).toBe('you have nothing to hunt with')
    expect(submitIntent(stalked('deer'), armed, 'a1', 'hunt', { faunaId: 'fauna_1' }).ok).toBe(true)
  })

  it('the optional column is absent from every authored row, so the config hash cannot feel it', () => {
    for (const row of Object.values(DEFAULT_CONFIG.crafting.recipes)) {
      expect(Object.prototype.hasOwnProperty.call(row, 'weaponKinds')).toBe(false)
    }
  })
})

describe('fish: a school is where the fish are', () => {
  const CFG = SimConfigSchema.parse({})
  const OFF = SimConfigSchema.parse({ fauna: { enabled: false } })

  function cast(stock: number | null, config = CFG): WorldState {
    const s = makeWorld(['.~', '.~'])
    if (stock === null) return s
    return fold(
      s,
      ev(70, 'fauna_spawned', { id: 'fauna_1', kind: 'fish', x: 1, y: 0, stock }),
      config,
    )
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
    expect(catches(cast(3), 0)[0]).toEqual({
      type: 'fauna_stock_changed',
      payload: { id: 'fauna_1', stock: 2 },
    })
    const last = catches(cast(1), 0)
    expect(last[0]).toEqual({
      type: 'fauna_killed',
      payload: { id: 'fauna_1', kind: 'fish', x: 1, y: 0, byId: 'a1' },
    })
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

describe('wear and doff: one body slot, and a night you can survive', () => {
  const CFG = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    mystery: { chancePerDay: 0 },
  })
  const AUTUMN_DUSK = 200 * MINUTES_PER_DAY + 19 * 60 + 30

  const carrying = (kinds: string[], s = makeWorld()): WorldState => {
    let out = s
    kinds.forEach((kind, i) => {
      out = fold(
        out,
        ev(300 + i, 'item_spawned', {
          id: `item_${i + 1}`,
          kind,
          qty: 1,
          loc: { t: 'agent', id: 'a1' },
        }),
        CFG,
      )
    })
    return out
  }
  const apply = (s: WorldState, verb: string, params: Record<string, unknown>): WorldState => {
    const r = submitIntent(s, CFG, 'a1', verb, params)
    if (!r.ok) throw new Error(r.reason)
    const done = VERBS[verb]!.onComplete(s, CFG, 'a1', params, new RngStreams('w').get('actions'))
    const finish = { type: 'action_completed', payload: { agentId: 'a1', verb } }
    let out = s
    for (const e of [...r.events, finish, ...done]) out = fold(out, ev(400, e.type, e.payload), CFG)
    return out
  }

  it('wears a held garment into the body slot, and says so on the wire', () => {
    const s = carrying(['garment'])
    const r = submitIntent(s, CFG, 'a1', 'wear', { itemId: 'item_1' })
    expect(r.ok).toBe(true)
    if (r.ok)
      expect(r.events[0]).toEqual({
        type: 'action_started',
        payload: { agentId: 'a1', verb: 'wear', params: { itemId: 'item_1' }, duration: 1 },
      })
    expect(
      VERBS.wear!.onComplete(
        s,
        CFG,
        'a1',
        { itemId: 'item_1' },
        new RngStreams('w').get('actions'),
      ),
    ).toEqual([
      { type: 'item_equipped', payload: { agentId: 'a1', itemId: 'item_1', slot: 'body' } },
    ])
    expect(apply(s, 'wear', { itemId: 'item_1' }).agents.a1!.equipped).toEqual({ body: 'item_1' })
  })

  it('refuses a second garment, something that is not clothing, and something not held', () => {
    const worn = apply(carrying(['garment', 'garment']), 'wear', { itemId: 'item_1' })
    const second = submitIntent(worn, CFG, 'a1', 'wear', { itemId: 'item_2' })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe('you are already wearing something')

    const wood = submitIntent(carrying(['wood']), CFG, 'a1', 'wear', { itemId: 'item_1' })
    expect(wood.ok).toBe(false)
    if (!wood.ok) expect(wood.reason).toBe('that is not something you can wear')

    const ghost = submitIntent(makeWorld(), CFG, 'a1', 'wear', { itemId: 'item_9' })
    expect(ghost.ok).toBe(false)
    if (!ghost.ok) expect(ghost.reason).toBe('not holding that')
  })

  it('doff clears the slot and takes the field with it, so the body hashes as it did bare', () => {
    const bare = carrying(['garment'])
    const worn = apply(bare, 'wear', { itemId: 'item_1' })
    const off = apply(worn, 'doff', {})
    expect(off.agents.a1!.equipped).toBeUndefined()
    expect(Object.keys(off.agents.a1!)).not.toContain('equipped')
    expect(stateHash(off)).toBe(stateHash(bare))

    expect(submitIntent(bare, CFG, 'a1', 'doff', {}).ok).toBe(true)
  })

  it('a garment leaving the hands leaves the slot too, however it goes', () => {
    const worn = apply(carrying(['garment']), 'wear', { itemId: 'item_1' })
    const dropped = fold(
      worn,
      ev(500, 'item_moved', { id: 'item_1', loc: { t: 'tile', x: 3, y: 3 } }),
      CFG,
    )
    expect(dropped.agents.a1!.equipped).toBeUndefined()
  })

  it('the clothes of the dead fall on the tile the life ended on', () => {
    let s = apply(carrying(['garment']), 'wear', { itemId: 'item_1' })
    s = { ...s, agents: { ...s.agents, a1: { ...s.agents.a1!, x: 2, y: 1, hp: 0.05 } } }
    s = fold(s, ev(510, 'agent_afflicted', { agentId: 'a1', kind: 'illness', severity: 2 }), CFG)
    const advanced = fold(s, { seq: 511, tick: 1, type: 'tick_advanced', payload: {} }, CFG)
    const r = createWorldTick(CFG, new RngStreams('cl'))(advanced)
    expect(r.events.some((e) => e.type === 'agent_died')).toBe(true)
    expect(r.state.items.item_1!.loc).toEqual({ t: 'tile', x: 2, y: 1 })
    expect(r.state.agents.a1!.equipped).toBeUndefined()
  })

  it('crafts cloth from two fiber and a garment from two cloth, on the tailoring track', () => {
    expect(CFG.crafting.recipes.cloth).toEqual({
      inputs: { fiber: 2 },
      output: { kind: 'cloth', qty: 1 },
      skill: 'tailoring',
    })
    expect(CFG.crafting.recipes.garment).toEqual({
      inputs: { cloth: 2 },
      output: { kind: 'garment', qty: 1 },
      skill: 'tailoring',
    })
    const spun = apply(carrying(['fiber', 'fiber']), 'craft', { recipe: 'cloth' })
    expect(Object.values(spun.items).map((i) => i.kind)).toEqual(['cloth'])
    const sewn = apply(carrying(['cloth', 'cloth']), 'craft', { recipe: 'garment' })
    expect(Object.values(sewn.items).map((i) => i.kind)).toEqual(['garment'])
    expect(sewn.agents.a1!.skills.tailoring).toBe(1)

    const short = submitIntent(carrying(['fiber']), CFG, 'a1', 'craft', { recipe: 'cloth' })
    expect(short.ok).toBe(false)
    if (!short.ok) expect(short.reason).toMatch(/^not enough fiber — /)
  })

  it('a worn garment offsets the exposure band, and the packet names it without a number', () => {
    const bare = { ...carrying(['garment']), tick: AUTUMN_DUSK }
    expect(isExposed(bare, CFG, 'a1')).toBe(true)
    const worn = apply(bare, 'wear', { itemId: 'item_1' })
    expect(insulationOf(worn, CFG, 'a1')).toBe(CFG.warmth.insulation.garment)
    expect(isExposed(worn, CFG, 'a1')).toBe(false)

    const onlooker = fold(
      worn,
      ev(600, 'agent_spawned', { id: 'a2', name: 'a2', x: 2, y: 0, ageDays: 7300 }),
      CFG,
    )
    const seen = composePerception(onlooker, CFG, 'a2', []).visible.agents.find(
      (a) => a.id === 'a1',
    )
    expect(seen!.worn).toBe('wrapped in a rough cloak')
    expect(seen!.worn).not.toMatch(/\d/)
  })
})

describe('night work: the choice is fuel or time, and it is theirs', () => {
  const CFG = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    mystery: { chancePerDay: 0 },
  })
  const OFF = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    mystery: { chancePerDay: 0 },
    light: { enabled: false },
  })
  const MIDNIGHT = 30
  const NOON = 12 * 60 + 30
  const HOUSE = CFG.construction.houseTicks
  const PENALTY = CFG.light.nightWorkPenalty

  // Wide enough for a house beside the builder, with stone and wood in hand for the other verbs.
  function site(tick: number, config = CFG): WorldState {
    let s = genesisState(
      config,
      Array.from({ length: 8 }, () => Array.from({ length: 8 }, (): TileId => 0)),
    )
    s = { ...s, tick }
    s = fold(
      s,
      ev(700, 'agent_spawned', { id: 'a1', name: 'a1', x: 1, y: 1, ageDays: 7300 }),
      config,
    )
    const kit: [string, string][] = [
      ['item_1', 'wood'],
      ['item_2', 'stone'],
      ['item_3', 'fiber'],
    ]
    kit.forEach(([id, kind], i) => {
      s = fold(
        s,
        ev(710 + i, 'item_spawned', { id, kind, qty: 20, loc: { t: 'agent', id: 'a1' } }),
        config,
      )
    })
    return s
  }
  const withTorch = (s: WorldState, x: number, y: number, config = CFG): WorldState => {
    let out = fold(
      s,
      ev(730, 'item_spawned', { id: 'item_9', kind: 'torch', qty: 1, loc: { t: 'tile', x, y } }),
      config,
    )
    out = fold(out, ev(731, 'item_lit', { itemId: 'item_9', burnsUntilTick: s.tick + 500 }), config)
    return out
  }
  const durationOf = (
    s: WorldState,
    verb: string,
    params: Record<string, unknown>,
    config = CFG,
  ): number => {
    const r = submitIntent(s, config, 'a1', verb, params)
    if (!r.ok) throw new Error(`${verb}: ${r.reason}`)
    const started = r.events.find((e) => e.type === 'action_started')!
    return (started.payload as { duration: number }).duration
  }

  it('a house raised in the dark takes half again as long, and one raised by a torch does not', () => {
    expect(durationOf(site(MIDNIGHT), 'build', { kind: 'house', x: 2, y: 1 })).toBe(
      Math.ceil(HOUSE * PENALTY),
    )
    expect(
      durationOf(withTorch(site(MIDNIGHT), 1, 2), 'build', { kind: 'house', x: 2, y: 1 }),
    ).toBe(HOUSE)
    expect(durationOf(site(NOON), 'build', { kind: 'house', x: 2, y: 1 })).toBe(HOUSE)
  })

  it('the torch has to be within workRadius: three tiles off is still fumbling', () => {
    expect(CFG.light.workRadius).toBe(2)
    expect(
      durationOf(withTorch(site(MIDNIGHT), 3, 1), 'build', { kind: 'house', x: 2, y: 1 }),
    ).toBe(HOUSE)
    expect(
      durationOf(withTorch(site(MIDNIGHT), 4, 1), 'build', { kind: 'house', x: 2, y: 1 }),
    ).toBe(Math.ceil(HOUSE * PENALTY))
  })

  it('slows exactly the five working verbs, and leaves everything else at its own pace', () => {
    const slowed: [string, Record<string, unknown>][] = [
      ['build', { kind: 'house', x: 2, y: 1 }],
      ['craft', { recipe: 'plank' }],
      ['till', { x: 1, y: 2 }],
      ['pave', { x: 1, y: 2 }],
      ['dig_channel', { x: 1, y: 2 }],
    ]
    for (const [verb, params] of slowed) {
      // dig_channel needs water beside it, so it is measured on its own below.
      if (verb === 'dig_channel') continue
      const dark = durationOf(site(MIDNIGHT), verb, params)
      const day = durationOf(site(NOON), verb, params)
      expect([verb, dark]).toEqual([verb, Math.ceil(day * PENALTY)])
    }
    for (const [verb, params] of [['walk', { x: 4, y: 4 }]] as const) {
      expect([verb, durationOf(site(MIDNIGHT), verb, params)]).toEqual([
        verb,
        durationOf(site(NOON), verb, params),
      ])
    }
    // `speak` is off this list because it no longer has a duration to slow: the mouth is not
    // the hands, so a word takes no activity slot and no tick, in the dark or in the day.
    for (const at of [MIDNIGHT, NOON]) {
      const r = submitIntent(site(at), CFG, 'a1', 'speak', { text: 'hi' })
      expect(r.ok && r.events.some((e) => e.type === 'action_started'), String(at)).toBe(false)
    }
  })

  it('dig_channel is slowed too, beside the water it needs', () => {
    const wet = (tick: number): WorldState => {
      const s = site(tick)
      const terrain = s.terrain.map((row, y) => row.map((t, x) => (x === 0 && y === 2 ? 2 : t)))
      return { ...s, terrain }
    }
    expect(durationOf(wet(MIDNIGHT), 'dig_channel', { x: 1, y: 2 })).toBe(
      Math.ceil(durationOf(wet(NOON), 'dig_channel', { x: 1, y: 2 }) * PENALTY),
    )
  })

  it("never refuses, and says so in the body's own words — only while the penalty is on", () => {
    const dark = site(MIDNIGHT)
    const r = submitIntent(dark, CFG, 'a1', 'build', { kind: 'house', x: 2, y: 1 })
    expect(r.ok).toBe(true)
    let working = dark
    if (r.ok) for (const e of r.events) working = fold(working, ev(740, e.type, e.payload), CFG)
    expect(composePerception(working, CFG, 'a1', []).fumbling).toBe(true)

    const lit = withTorch(working, 1, 2)
    expect(composePerception(lit, CFG, 'a1', []).fumbling).toBeUndefined()
    expect(composePerception({ ...working, tick: NOON }, CFG, 'a1', []).fumbling).toBeUndefined()
    // Standing idle in the dark is not fumbling; it is standing.
    expect(composePerception(dark, CFG, 'a1', []).fumbling).toBeUndefined()
  })

  it('with the light law off, the night costs nothing at all', () => {
    expect(durationOf(site(MIDNIGHT, OFF), 'build', { kind: 'house', x: 2, y: 1 }, OFF)).toBe(HOUSE)
  })
})

describe('food variety: the same meal twice is worth less than two meals', () => {
  const CFG = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    mystery: { chancePerDay: 0 },
  })
  const OFF = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    mystery: { chancePerDay: 0 },
    foodVariety: { enabled: false },
  })
  const FULL = CFG.needs.eatRestoreHunger
  const NOON = 720

  let nextItem = 0
  const larder = (kinds: string[], config = CFG, tick = NOON): WorldState => {
    let s = { ...makeWorld(), tick }
    kinds.forEach((kind) => {
      nextItem += 1
      s = fold(
        s,
        ev(900 + nextItem, 'item_spawned', {
          id: `food_${nextItem}`,
          kind,
          qty: 1,
          loc: { t: 'agent', id: 'a1' },
        }),
        config,
      )
    })
    return s
  }
  const heldIdOf = (s: WorldState, kind: string): string =>
    Object.keys(s.items)
      .sort()
      .find((id) => s.items[id]!.kind === kind)!

  // The window is counted in days, so these events must carry the tick they happened on.
  const at = (type: string, payload: unknown, tick: number): SimEvent => ({
    seq: 9500 + (nextItem += 1),
    tick,
    type,
    payload,
  })

  // One meal, the way the tick pipeline serves it: the eating is recorded, then the belly fills.
  const eatOne = (
    s: WorldState,
    kind: string,
    config = CFG,
  ): { state: WorldState; restored: number } => {
    const itemId = heldIdOf(s, kind)
    const def = VERBS.eat!
    const results = def.results?.(s, config, 'a1', { itemId })
    let out = fold(
      s,
      at(
        'action_completed',
        {
          agentId: 'a1',
          verb: 'eat',
          ...(results ? { results } : {}),
        },
        s.tick,
      ),
      config,
    )
    let restored = 0
    for (const e of def.onComplete(
      out,
      config,
      'a1',
      { itemId },
      new RngStreams('fv').get('illness'),
    )) {
      if (e.type === 'needs_changed') {
        const changes = (e.payload as { changes: { need: string; delta: number }[] }).changes
        restored = changes.find((c) => c.need === 'hunger')?.delta ?? restored
      }
      out = fold(out, at(e.type, e.payload, out.tick), config)
    }
    return { state: out, restored }
  }
  const eatAll = (kinds: string[], config = CFG): number[] => {
    let s = larder(kinds, config)
    const out: number[] = []
    for (const kind of kinds) {
      const r = eatOne(s, kind, config)
      s = r.state
      out.push(r.restored)
    }
    return out
  }

  it('one loaf is exactly the flat restore, and a second loaf is worth no more', () => {
    expect(eatAll(['bread', 'bread'])).toEqual([FULL, FULL])
  })

  it('every distinct kind in the window is worth five per cent more, up to twenty', () => {
    const six = ['bread', 'berries', 'fish', 'venison', 'mushroom', 'wheat']
    const got = eatAll(six)
    const want = six.map((kind, i) => {
      const bonus = 1 + Math.min(CFG.foodVariety.maxBonus, CFG.foodVariety.bonusPerKind * i)
      return FULL * nutritionOf(CFG, kind) * bonus
    })
    got.forEach((n, i) => {
      expect([six[i], n]).toEqual([six[i], want[i]])
    })
    // Five kinds are already at the cap; the sixth buys nothing.
    expect(1 + CFG.foodVariety.bonusPerKind * 4).toBe(1 + CFG.foodVariety.maxBonus)
  })

  it('records what was eaten and prunes it to the window, so an old meal stops counting', () => {
    const first = eatOne(larder(['bread', 'berries']), 'bread')
    expect(first.state.agents.a1!.recentFoods).toEqual([{ kind: 'bread', day: 0 }])
    const later = eatOne({ ...first.state, tick: 4 * MINUTES_PER_DAY + NOON }, 'berries')
    expect(later.state.agents.a1!.recentFoods).toEqual([{ kind: 'berries', day: 4 }])
    expect(later.restored).toBe(FULL * nutritionOf(CFG, 'berries'))
  })

  it('is absent on a body that has never eaten, and hashes like one that never did', () => {
    const clean = larder(['bread'])
    expect(clean.agents.a1!.recentFoods).toBeUndefined()
    const flat = eatOne(larder(['bread'], OFF), 'bread', OFF)
    expect(flat.state.agents.a1!.recentFoods).toBeUndefined()
    expect(flat.restored).toBe(FULL)
  })

  it('an herb is a remedy, not a meal: it restores a token and nothing like a dinner', () => {
    expect(nutritionOf(CFG, 'herb')).toBeLessThan(0.2)
    const herb = eatOne(larder(['herb']), 'herb').restored
    expect(herb).toBe(FULL * nutritionOf(CFG, 'herb'))
    expect(herb).toBeLessThan((FULL * nutritionOf(CFG, 'bread')) / 4)
  })

  it('prices the smaller catches below a full meal and a stew above one', () => {
    for (const kind of ['mushroom', 'rabbit_meat', 'fish']) {
      expect([kind, nutritionOf(CFG, kind)]).toEqual([kind, expect.any(Number)])
      expect(nutritionOf(CFG, kind)).toBeLessThan(nutritionOf(CFG, 'bread'))
    }
    expect(nutritionOf(CFG, 'stew')).toBeGreaterThan(nutritionOf(CFG, 'bread'))
    expect(isFoodKind(CFG, 'stew')).toBe(true)
  })
})

describe('stew: the one recipe the world ships with', () => {
  const CFG = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    mystery: { chancePerDay: 0 },
  })
  const NOON = 720

  function kitchen(
    opts: { fire?: 'lit' | 'cold'; water?: boolean; food?: string[] } = {},
  ): WorldState {
    let s: WorldState = {
      ...makeWorld(['........', '........', '........', '........']),
      tick: NOON,
    }
    const food = opts.food ?? ['venison', 'berries']
    food.forEach((kind, i) => {
      s = fold(
        s,
        ev(1000 + i, 'item_spawned', {
          id: `food_${i}`,
          kind,
          qty: 1,
          loc: { t: 'agent', id: 'a1' },
        }),
        CFG,
      )
    })
    if (opts.water !== false) {
      s = fold(
        s,
        ev(1010, 'item_spawned', {
          id: 'pot',
          kind: 'bucket',
          qty: 1,
          loc: { t: 'agent', id: 'a1' },
          charges: 1,
        }),
        CFG,
      )
    }
    if (opts.fire !== undefined) {
      s = fold(
        s,
        ev(1020, 'structure_planned', {
          id: 'structure_1',
          kind: 'fire_pit',
          x: 1,
          y: 0,
          w: 1,
          h: 1,
          maxHp: 10,
          flammable: false,
          builderId: 'a1',
        }),
        CFG,
      )
      s = fold(s, ev(1021, 'structure_completed', { id: 'structure_1' }), CFG)
      if (opts.fire === 'lit') {
        s = fold(
          s,
          ev(1022, 'structure_fueled', { structureId: 'structure_1', burnsUntilTick: NOON + 100 }),
          CFG,
        )
      }
    }
    return s
  }
  const cook = (s: WorldState) => submitIntent(s, CFG, 'a1', 'craft', { recipe: 'stew' })

  it('resolves any meat and any vegetable through the canon classes, at a lit fire', () => {
    expect(ITEM_CLASSES.any_meat).toContain('venison')
    expect(ITEM_CLASSES.any_vegetable).toContain('berries')
    const s = kitchen({ fire: 'lit' })
    expect(cook(s).ok).toBe(true)
    const events = VERBS.craft!.onComplete(
      s,
      CFG,
      'a1',
      { recipe: 'stew' },
      new RngStreams('st').get('actions'),
    )
    expect(events).toContainEqual({
      type: 'item_qty_changed',
      payload: { id: 'food_0', delta: -1 },
    })
    expect(events).toContainEqual({
      type: 'item_qty_changed',
      payload: { id: 'food_1', delta: -1 },
    })
    expect(events).toContainEqual({ type: 'item_filled', payload: { itemId: 'pot', charges: 0 } })
    expect(
      events.some(
        (e) => e.type === 'item_spawned' && (e.payload as { kind: string }).kind === 'stew',
      ),
    ).toBe(true)
    expect(events).toContainEqual({
      type: 'skill_gained',
      payload: { agentId: 'a1', track: 'cooking', xp: 1 },
    })
  })

  it('takes rabbit and a mushroom just as readily: the class is the ingredient', () => {
    expect(cook(kitchen({ fire: 'lit', food: ['rabbit_meat', 'mushroom'] })).ok).toBe(true)
  })

  it('refuses beside a cold pit, with no fire at all, with no water, and with no meat', () => {
    const cold = cook(kitchen({ fire: 'cold' }))
    expect(cold.ok).toBe(false)
    if (!cold.ok) expect(cold.reason).toBe('there is no fire lit here to cook on')
    expect(cook(kitchen({})).ok).toBe(false)

    const dry = cook(kitchen({ fire: 'lit', water: false }))
    expect(dry.ok).toBe(false)
    if (!dry.ok) expect(dry.reason).toBe('you have no water to cook with')

    const vegan = cook(kitchen({ fire: 'lit', food: ['berries', 'mushroom'] }))
    expect(vegan.ok).toBe(false)
    if (!vegan.ok) expect(vegan.reason).toMatch(/^not enough meat — /)
  })

  it('does not touch the config the world ships: the seed recipe is code, not a dial', () => {
    expect(CFG.crafting.recipes.stew).toBeUndefined()
    expect(SEED_RECIPES.stew!.output).toEqual({ kind: 'stew', qty: 1 })
  })
})

describe('the clothing line has two upstreams: the reed bed and the deer', () => {
  const CFG = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    mystery: { chancePerDay: 0 },
  })

  function holding(kind: string, qty: number): WorldState {
    return fold(
      makeWorld(),
      ev(1000, 'item_spawned', {
        id: 'stock',
        kind,
        qty,
        loc: { t: 'agent', id: 'a1' },
      }),
      CFG,
    )
  }
  const make = (s: WorldState, recipe: string) => submitIntent(s, CFG, 'a1', 'craft', { recipe })

  it('the fiber road is the config one, and the reeds now feed it', () => {
    expect(CFG.crafting.recipes.cloth!.inputs).toEqual({ fiber: 2 })
    expect(CFG.crafting.recipes.garment!.inputs).toEqual({ cloth: 2 })
    expect(FORAGEABLE_YIELD.reed_bed).toBe('fiber')
    expect(make(holding('fiber', 2), 'cloth').ok).toBe(true)
    expect(make(holding('cloth', 2), 'garment').ok).toBe(true)
  })

  it('the hunter road is a seed recipe: two hides make a garment nobody wove', () => {
    expect(CFG.crafting.recipes.hide_garment).toBeUndefined()
    expect(SEED_RECIPES.hide_garment!.output).toEqual({ kind: 'garment', qty: 1 })
    const s = holding('hide', 2)
    expect(make(s, 'hide_garment').ok).toBe(true)
    const events = VERBS.craft!.onComplete(
      s,
      CFG,
      'a1',
      { recipe: 'hide_garment' },
      new RngStreams('h').get('actions'),
    )
    expect(events).toContainEqual({ type: 'item_qty_changed', payload: { id: 'stock', delta: -2 } })
    const made = events.find((e) => e.type === 'item_spawned')!.payload as { kind: string }
    expect(made.kind).toBe('garment')
    expect(isWearable(CFG, made.kind)).toBe(true)
    expect(events).toContainEqual({
      type: 'skill_gained',
      payload: { agentId: 'a1', track: 'tailoring', xp: 1 },
    })
  })

  it('one hide is not a garment', () => {
    const thin = make(holding('hide', 1), 'hide_garment')
    expect(thin.ok).toBe(false)
    if (!thin.ok) expect(thin.reason).toMatch(/^not enough hide — /)
  })

  it('asking for the thing, not the road: two hides and "craft garment" makes one', () => {
    const s = holding('hide', 2)
    expect(make(s, 'garment').ok).toBe(true)
    const events = VERBS.craft!.onComplete(
      s,
      CFG,
      'a1',
      { recipe: 'garment' },
      new RngStreams('h').get('actions'),
    )
    expect(events).toContainEqual({ type: 'item_qty_changed', payload: { id: 'stock', delta: -2 } })
    const made = events.find((e) => e.type === 'item_spawned')!.payload as { kind: string }
    expect(made.kind).toBe('garment')
    expect(events).toContainEqual({
      type: 'skill_gained',
      payload: { agentId: 'a1', track: 'tailoring', xp: 1 },
    })
  })

  it('the named row still goes first: cloth in hand weaves, it does not skin', () => {
    const s = holding('cloth', 2)
    expect(make(s, 'garment').ok).toBe(true)
    const events = VERBS.craft!.onComplete(
      s,
      CFG,
      'a1',
      { recipe: 'garment' },
      new RngStreams('h').get('actions'),
    )
    expect(events).toContainEqual({ type: 'item_qty_changed', payload: { id: 'stock', delta: -2 } })
    expect(events).toContainEqual({
      type: 'skill_gained',
      payload: { agentId: 'a1', track: 'tailoring', xp: 1 },
    })
  })

  it('with nothing that will do it, the refusal is the one the named road gives', () => {
    const empty = make(makeWorld(), 'garment')
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.reason).toMatch(/^not enough cloth — /)
    const oneHide = make(holding('hide', 1), 'garment')
    expect(oneHide.ok).toBe(false)
    if (!oneHide.ok) expect(oneHide.reason).toMatch(/^not enough cloth — /)
  })

  it('every route to a name is deterministic and named-row-first', () => {
    expect(craftRoutes(CFG, 'garment').map((r) => r.inputs)).toEqual([{ cloth: 2 }, { hide: 2 }])
    expect(craftRoutes(CFG, 'hide_garment').map((r) => r.inputs)).toEqual([{ hide: 2 }])
    expect(craftRoutes(CFG, 'a_thing_nobody_makes')).toEqual([])
  })
})

describe('a torch is a thing hands can make', () => {
  const CFG = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    mystery: { chancePerDay: 0 },
  })

  function bench(stock: [string, number][]): WorldState {
    let s = makeWorld()
    stock.forEach(([kind, qty], i) => {
      s = fold(
        s,
        ev(1100 + i, 'item_spawned', { id: `it_${i}`, kind, qty, loc: { t: 'agent', id: 'a1' } }),
        CFG,
      )
    })
    return s
  }
  const make = (s: WorldState) => submitIntent(s, CFG, 'a1', 'craft', { recipe: 'torch' })

  it('a stick and a handful of reed fiber, and the recipe is code not a dial', () => {
    expect(CFG.crafting.recipes.torch).toBeUndefined()
    expect(SEED_RECIPES.torch!.output).toEqual({ kind: 'torch', qty: 1 })
    const s = bench([
      ['wood', 1],
      ['fiber', 1],
    ])
    expect(make(s).ok).toBe(true)
    const events = VERBS.craft!.onComplete(
      s,
      CFG,
      'a1',
      { recipe: 'torch' },
      new RngStreams('t').get('actions'),
    )
    const made = events.find((e) => e.type === 'item_spawned')!.payload as { kind: string }
    expect(made.kind).toBe('torch')
  })

  it('what it makes will take a flame, which is the whole point of making it', () => {
    expect(isKindleable(CFG, 'torch')).toBe(true)
    // ★ AND THE THREE THINGS IN THE GLOW TABLE THAT ARE NOT IN A HAND STAY OUT. `hearth` is
    // there so the house that holds one can borrow its reach, and it is not a thing you carry.
    for (const kind of ['hearth', 'fire_pit', 'house'])
      expect(isKindleable(CFG, kind), kind).toBe(false)
    const lit = fold(
      bench([]),
      ev(1200, 'item_spawned', {
        id: 'torch_1',
        kind: 'torch',
        qty: 1,
        loc: { t: 'agent', id: 'a1' },
      }),
      CFG,
    )
    expect(submitIntent(lit, CFG, 'a1', 'kindle', { itemId: 'torch_1' }).ok).toBe(true)
  })

  it('needs both halves', () => {
    expect(make(bench([['wood', 1]])).ok).toBe(false)
    expect(make(bench([['fiber', 1]])).ok).toBe(false)
  })
})
