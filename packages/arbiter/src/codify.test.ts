import { describe, expect, it } from 'vitest'
import { SimConfigSchema, type SimConfig, type SimEvent } from '@sj/shared'
import { RngStream, VERBS, fold, genesisState, skillLevel, submitIntent, type WorldState } from '@sj/engine'
import { openArbiterDb } from './schema.js'
import { CodexStore } from './codex.js'
import { RulebookStore } from './rulebook.js'
import { ReviewStore } from './review.js'
import type { Recipe } from './verdict.js'
import { codify, emitOutcomeEffects, isExpertRecipe, productsOf, verbFromRecipe } from './codify.js'
import type { Codified } from './adjudicate.js'

const CFG: SimConfig = SimConfigSchema.parse({})
const CREDIT_FIXTURE = { agentId: 'a1', intent: 'i try to boil the river water down' }

const boilSaltRecipe: Recipe = {
  id: 'recipe:boil_salt',
  name: 'Boil River Water for Salt',
  skillCheck: { track: 'cooking', difficulty: 2 },
  durationTicks: 5,
  costs: [],
  requires: [{ type: 'adjacent_fire' }],
  outcomeTable: [
    { weight: 1, success: true, label: 'A crust of salt forms as the water boils away.', effects: [{ op: 'spawn_item', kind: 'salt', qty: 1, to: 'agent' }] },
    { weight: 1, success: false, label: 'The water boils to nothing; the pot is bare.', effects: [{ op: 'none' }] },
  ],
  rngStream: 'recipe:boil_salt',
  canon: ['fire', 'pottery'],
}

let seq = 90000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })

function agentState(): WorldState {
  return fold(genesisState(CFG), ev('agent_spawned', { id: 'a1', name: 'a1', x: 5, y: 5, ageDays: 7300 }), CFG)
}

function burningFireAdjacent(): WorldState {
  let s = agentState()
  s = fold(s, ev('structure_planned', { id: 's1', kind: 'campfire', x: 6, y: 5, w: 1, h: 1, maxHp: 10, flammable: true, builderId: 'a1' }), CFG)
  s = fold(s, ev('fire_ignited', { structureId: 's1', cause: 'test' }), CFG)
  return s
}

function twoWoodStacks(): WorldState {
  let s = agentState()
  s = fold(s, ev('item_spawned', { id: 'item_1', kind: 'wood', qty: 1, loc: { t: 'agent', id: 'a1' } }), CFG)
  s = fold(s, ev('item_spawned', { id: 'item_2', kind: 'wood', qty: 5, loc: { t: 'agent', id: 'a1' } }), CFG)
  return s
}

describe('codify', () => {
  describe('verbFromRecipe', () => {
    it('maps the recipe onto the VerbDef shape (kind, skill, rngStream, duration)', () => {
      const def = verbFromRecipe(boilSaltRecipe)
      expect(def.kind).toBe('recipe:boil_salt')
      expect(def.skill).toEqual({ track: 'cooking', xp: 10 })
      expect(def.rngStream).toBe('recipe:boil_salt')
      expect(def.duration(agentState(), CFG, 'a1', {})).toBe(5)
    })

    it('validate rejects a position with no adjacent fire', () => {
      const def = verbFromRecipe(boilSaltRecipe)
      expect(def.validate(agentState(), CFG, 'a1', {})).toBe('you need a fire nearby')
    })

    it('validate passes an adjacent burning structure', () => {
      const def = verbFromRecipe(boilSaltRecipe)
      expect(def.validate(burningFireAdjacent(), CFG, 'a1', {})).toBeNull()
    })
  })

  describe('onComplete', () => {
    it('rolls the success row and emits one item_spawned with a hand-computed id', () => {
      const def = verbFromRecipe(boilSaltRecipe)
      const state = burningFireAdjacent()
      const nextId = state.counters.nextEntityId
      const events = def.onComplete(state, CFG, 'a1', {}, RngStream.from([0, 0, 0, 0]))
      expect(events).toEqual([
        { type: 'item_spawned', payload: { id: `item_${nextId}`, kind: 'salt', qty: 1, loc: { t: 'agent', id: 'a1' }, owner: 'a1' } },
      ])
    })
  })

  describe('onStart', () => {
    it('consumes a cost across stacks in order until met', () => {
      const def = verbFromRecipe({ ...boilSaltRecipe, costs: [{ kind: 'wood', qty: 2 }] })
      const events = def.onStart!(twoWoodStacks(), CFG, 'a1', {})
      expect(events).toEqual([
        { type: 'item_qty_changed', payload: { id: 'item_1', delta: -1 } },
        { type: 'item_qty_changed', payload: { id: 'item_2', delta: -1 } },
      ])
    })

    it('bails without deducting anything when any cost is short', () => {
      const def = verbFromRecipe({ ...boilSaltRecipe, costs: [{ kind: 'wood', qty: 2 }, { kind: 'clay', qty: 1 }] })
      expect(def.onStart!(twoWoodStacks(), CFG, 'a1', {})).toEqual([])
    })
  })

  describe('validate costs', () => {
    it('rejects when the agent holds less than a cost demands', () => {
      const def = verbFromRecipe({ ...boilSaltRecipe, requires: [], costs: [{ kind: 'wood', qty: 7 }] })
      expect(def.validate(twoWoodStacks(), CFG, 'a1', {})).toBe('not enough wood — wood comes from felling a tree')
    })

    it('passes when every cost is covered across stacks', () => {
      const def = verbFromRecipe({ ...boilSaltRecipe, requires: [], costs: [{ kind: 'wood', qty: 6 }] })
      expect(def.validate(twoWoodStacks(), CFG, 'a1', {})).toBeNull()
    })
  })

  describe('skill level parity with the engine', () => {
    it('onComplete levels with the exported engine skillLevel, not floor(sqrt(xp/divisor))', () => {
      let state = burningFireAdjacent()
      state = fold(state, ev('skill_gained', { agentId: 'a1', track: 'cooking', xp: 2000 }), CFG)
      expect(skillLevel(state, 'a1', 'cooking', CFG)).toBe(10)

      // difficulty 2: engine level 10 → factor 0.9, success wins while
      // roll <= 0.9/1.9 ≈ 0.474; the old sqrt level 4 → factor 0.6 loses at 0.45.
      const def = verbFromRecipe(boilSaltRecipe)
      const rng = { next: () => 0.45 } as unknown as RngStream
      const events = def.onComplete(state, CFG, 'a1', {}, rng)
      expect(events.some((e) => e.type === 'item_spawned')).toBe(true)
    })
  })

  describe('emitOutcomeEffects', () => {
    it('emits skill_gained for gain_skill', () => {
      expect(emitOutcomeEffects(agentState(), 'a1', [{ op: 'gain_skill', track: 'cooking', xp: 10 }])).toEqual([
        { type: 'skill_gained', payload: { agentId: 'a1', track: 'cooking', xp: 10 } },
      ])
    })

    it('emits hp_changed for hp_delta', () => {
      expect(emitOutcomeEffects(agentState(), 'a1', [{ op: 'hp_delta', delta: -10 }])).toEqual([
        { type: 'hp_changed', payload: { agentId: 'a1', delta: -10 } },
      ])
    })

    it('emits [] for none', () => {
      expect(emitOutcomeEffects(agentState(), 'a1', [{ op: 'none' }])).toEqual([])
    })

    it('emits distinct ids for an outcome row with multiple spawn_item effects', () => {
      const state = agentState()
      const nextId = state.counters.nextEntityId
      const events = emitOutcomeEffects(state, 'a1', [
        { op: 'spawn_item', kind: 'salt', qty: 1, to: 'agent' },
        { op: 'spawn_item', kind: 'clay', qty: 2, to: 'agent' },
      ])
      expect(events).toEqual([
        { type: 'item_spawned', payload: { id: `item_${nextId}`, kind: 'salt', qty: 1, loc: { t: 'agent', id: 'a1' } } },
        { type: 'item_spawned', payload: { id: `item_${nextId + 1}`, kind: 'clay', qty: 2, loc: { t: 'agent', id: 'a1' } } },
      ])
    })
  })

  describe('expert crafts carry the maker’s mark', () => {
    const expertRecipe: Recipe = { ...boilSaltRecipe, skillCheck: { track: 'cooking', difficulty: 4 } }
    const EXPERT_XP = CFG.crafting.expertLevel * CFG.skills.xpLevelDivisor

    function cook(xp: number): WorldState {
      const s = burningFireAdjacent()
      return xp === 0 ? s : fold(s, ev('skill_gained', { agentId: 'a1', track: 'cooking', xp }), CFG)
    }

    // A success row every time, so the spawn is never a dice question.
    const alwaysWins = { next: () => 0 } as unknown as RngStream
    const spawnPayload = (recipe: Recipe, state: WorldState, config = CFG): Record<string, unknown> | undefined =>
      verbFromRecipe(recipe).onComplete(state, config, 'a1', {}, alwaysWins)
        .find((e) => e.type === 'item_spawned')?.payload as Record<string, unknown> | undefined

    it('reads difficulty against the expert threshold', () => {
      expect(isExpertRecipe(expertRecipe, CFG)).toBe(true)
      expect(isExpertRecipe(boilSaltRecipe, CFG)).toBe(false)             // difficulty 2
      expect(isExpertRecipe({ ...boilSaltRecipe, skillCheck: undefined }, CFG)).toBe(false)
    })

    it('marks an expert recipe worked by an expert hand', () => {
      expect(skillLevel(cook(EXPERT_XP), 'a1', 'cooking', CFG)).toBe(CFG.crafting.expertLevel)
      expect(spawnPayload(expertRecipe, cook(EXPERT_XP))).toMatchObject({ owner: 'a1', crafterMark: 'a1' })
    })

    it('leaves it unmarked for a novice hand, and for an everyday recipe', () => {
      expect(spawnPayload(expertRecipe, cook(0))!.crafterMark).toBeUndefined()
      expect(spawnPayload(boilSaltRecipe, cook(EXPERT_XP))!.crafterMark).toBeUndefined()
    })

    it('stops marking and owning when the ownership flag is off', () => {
      const off = SimConfigSchema.parse({ ownership: { enabled: false } })
      const payload = spawnPayload(expertRecipe, cook(EXPERT_XP), off)!
      expect(payload.crafterMark).toBeUndefined()
      expect(payload.owner).toBeUndefined()
    })
  })

  describe('tools wear out in the hands that use them', () => {
    // A rod is a held_item requirement, not a cost: it is used, not consumed.
    const rodRecipe: Recipe = {
      ...boilSaltRecipe,
      id: 'recipe:angle',
      requires: [{ type: 'held_item', kind: 'rod', qty: 1 }],
      outcomeTable: [{ weight: 1, success: true, label: 'A fish.', effects: [{ op: 'spawn_item', kind: 'fish', qty: 1, to: 'agent' }] }],
    }
    const alwaysWins = { next: () => 0 } as unknown as RngStream

    function withRod(durability?: number): WorldState {
      return fold(agentState(), ev('item_spawned', {
        id: 'item_1', kind: 'rod', qty: 1, loc: { t: 'agent', id: 'a1' },
        ...(durability === undefined ? {} : { durability }),
      }), CFG)
    }

    const wearEvents = (s: WorldState, config = CFG) =>
      verbFromRecipe(rodRecipe).onComplete(s, config, 'a1', {}, alwaysWins)
        .filter((e) => e.type === 'item_worn' || e.type === 'item_broke')

    it('carries durability out of an arbiter spawn_item effect', () => {
      const state = agentState()
      const nextId = state.counters.nextEntityId
      expect(emitOutcomeEffects(state, 'a1', [{ op: 'spawn_item', kind: 'rod', qty: 1, to: 'agent', durability: 40 }])).toEqual([
        { type: 'item_spawned', payload: { id: `item_${nextId}`, kind: 'rod', qty: 1, loc: { t: 'agent', id: 'a1' }, durability: 40 } },
      ])
    })

    it('wears the required tool by wearPerUse on every completed use', () => {
      expect(wearEvents(withRod(3))).toEqual([{ type: 'item_worn', payload: { id: 'item_1', delta: -1 } }])
    })

    it('breaks the tool on the use that empties it', () => {
      expect(wearEvents(withRod(1))).toEqual([
        { type: 'item_worn', payload: { id: 'item_1', delta: -1 } },
        { type: 'item_broke', payload: { id: 'item_1' } },
      ])
      const broken = wearEvents(withRod(1)).reduce((s, e) => fold(s, ev(e.type, e.payload), CFG), withRod(1))
      expect(broken.items.item_1).toBeUndefined()
    })

    it('leaves a tool with no durability of its own untouched', () => {
      expect(wearEvents(withRod())).toEqual([])
    })

    it('goes quiet with the wear flag off', () => {
      expect(wearEvents(withRod(3), SimConfigSchema.parse({ tools: { wearEnabled: false } }))).toEqual([])
    })

    it('never touches a Tier-1 verb: the engine craft wears nothing', () => {
      let s = withRod(3)
      s = fold(s, ev('item_spawned', { id: 'item_2', kind: 'wood', qty: 10, loc: { t: 'agent', id: 'a1' } }), CFG)
      const events = VERBS.craft!.onComplete(s, CFG, 'a1', { recipe: 'plank' }, alwaysWins)
      expect(events.some((e) => e.type === 'item_worn' || e.type === 'item_broke')).toBe(false)
      expect(fold(s, ev('item_spawned', { id: 'item_3', kind: 'fish', qty: 1, loc: { t: 'agent', id: 'a1' } }), CFG)
        .items.item_1!.durability).toBe(3)
    })
  })

  describe('codify', () => {
    it('re-codifying an active recipe returns the same ruleId idempotently (no throw, no duplicate)', () => {
      const db = openArbiterDb(':memory:')
      const rulebook = new RulebookStore(db)
      const review = new ReviewStore(db)
      const codex = new CodexStore(db)
      codex.insert({ id: 'fire', era: 'handwork', name: 'Fire', prerequisiteId: null })
      codex.insert({ id: 'pottery', era: 'handwork', name: 'Pottery', prerequisiteId: null })
      const recipe = { ...boilSaltRecipe, id: 'recipe:salt_idem', name: 'Salt Idem', rngStream: 'recipe:salt_idem' }

      const first = codify(recipe, CREDIT_FIXTURE, { rulebook, review, codex, tick: 200 })
      const second = codify(recipe, CREDIT_FIXTURE, { rulebook, review, codex, tick: 300 })

      expect(second).toEqual(first)
      const rows = db.prepare('SELECT COUNT(*) AS n FROM rulebook WHERE recipe_id = ?').get('recipe:salt_idem') as { n: number }
      expect(rows.n).toBe(1)
    })

    it('re-codifying a reverted recipe reactivates the row, re-registers the verb, and re-opens review', () => {
      const db = openArbiterDb(':memory:')
      const rulebook = new RulebookStore(db)
      const review = new ReviewStore(db)
      const codex = new CodexStore(db)
      codex.insert({ id: 'fire', era: 'handwork', name: 'Fire', prerequisiteId: null })
      codex.insert({ id: 'pottery', era: 'handwork', name: 'Pottery', prerequisiteId: null })
      const recipe = { ...boilSaltRecipe, id: 'recipe:salt_revive', name: 'Salt Revive', rngStream: 'recipe:salt_revive' }

      const { ruleId } = codify(recipe, CREDIT_FIXTURE, { rulebook, review, codex, tick: 200 })
      review.revertByRecipe('recipe:salt_revive', 'physics wrong', 250)
      expect(rulebook.byId('recipe:salt_revive')!.revertedAtTick).toBe(250)

      const revived = codify({ ...recipe, durationTicks: 7 }, CREDIT_FIXTURE, { rulebook, review, codex, tick: 300 })
      expect(revived.ruleId).toBe(ruleId)

      const row = rulebook.byId('recipe:salt_revive')!
      expect(row.revertedAtTick).toBeNull()
      expect(row.revertedReason).toBeNull()
      expect(row.tick).toBe(300)
      expect((JSON.parse(row.recipeJson) as Recipe).durationTicks).toBe(7)

      expect(submitIntent(burningFireAdjacent(), CFG, 'a1', 'recipe:salt_revive', {})).toMatchObject({ ok: true })
      expect(review.pending().map((r) => r.ruleId)).toContain(ruleId)
    })

    it('inserts the recipe into the rulebook and hot-registers the verb live in the engine registry', () => {
      const db = openArbiterDb(':memory:')
      const rulebook = new RulebookStore(db)
      const review = new ReviewStore(db)
      const codex = new CodexStore(db)
      codex.insert({ id: 'fire', era: 'handwork', name: 'Fire', prerequisiteId: null })
      codex.insert({ id: 'pottery', era: 'handwork', name: 'Pottery', prerequisiteId: null })
      const { ruleId, verb } = codify(boilSaltRecipe, CREDIT_FIXTURE, { rulebook, review, codex, tick: 200 })
      expect(ruleId).toBeTypeOf('number')
      expect(verb).toBe('recipe:boil_salt')
      expect(rulebook.byId('recipe:boil_salt')).not.toBeNull()
      const res = submitIntent(burningFireAdjacent(), CFG, 'a1', 'recipe:boil_salt', {})
      expect(res).toMatchObject({ ok: true })
    })
  })
})

describe('productsOf — what a recipe unlocked', () => {
  const recipe = (kinds: string[]): Recipe => ({
    ...boilSaltRecipe,
    outcomeTable: [
      { weight: 7, success: true, label: 'it holds', effects: kinds.map((kind) => ({
        op: 'spawn_item' as const, kind, qty: 1, to: 'agent' as const })) },
      { weight: 3, success: false, label: 'it leaks', effects: [{ op: 'none' as const }] },
    ],
  })

  it('reads every item kind the table can spawn', () => {
    expect(productsOf(recipe(['waterskin', 'cord']))).toEqual(['cord', 'waterskin'])
  })

  it('dedupes and sorts, so two calls are byte-equal', () => {
    const r = recipe(['waterskin', 'waterskin'])
    expect(productsOf(r)).toEqual(['waterskin'])
    expect(JSON.stringify(productsOf(r))).toBe(JSON.stringify(productsOf(r)))
  })

  it('is empty for a recipe that spawns nothing', () => {
    expect(productsOf({ ...boilSaltRecipe, outcomeTable: [
      { weight: 1, success: true, label: 'a knack', effects: [{ op: 'gain_skill', track: 'craft', xp: 5 }] },
    ] })).toEqual([])
  })
})

describe('codify reports the mint — once, and only for a new one', () => {
  const CREDIT = { agentId: 'a1', intent: 'carry water in a stitched hide' }

  function makeCodifyDeps(extra: { onCodified?: (d: Codified) => void } = {}): {
    rulebook: RulebookStore; review: ReviewStore; codex: CodexStore; tick: number
    onCodified?: (d: Codified) => void
  } {
    const db = openArbiterDb(':memory:')
    const codex = new CodexStore(db)
    codex.insert({ id: 'fire', era: 'handwork', name: 'Fire', prerequisiteId: null })
    codex.insert({ id: 'pottery', era: 'handwork', name: 'Pottery', prerequisiteId: null })
    return {
      rulebook: new RulebookStore(db), review: new ReviewStore(db), codex, tick: 5, ...extra,
    }
  }
  // A fresh id and a name that carries its words: the sanity gate refuses an id whose
  // words are nowhere in the name, and VERBS is a global registry across this file.
  // A fresh id per test: VERBS is a global registry, and the sanity gate refuses an id whose
  // words are nowhere in the name.
  let n = 0
  const salt = (): Recipe => {
    n += 1
    return { ...boilSaltRecipe, id: `recipe:salt_credit${n}`, name: `Salt Credit${n}`, rngStream: `recipe:salt_credit${n}` }
  }

  it('calls onCodified on the first insert, with the credit and the products', () => {
    const seen: Codified[] = []
    const deps = makeCodifyDeps({ onCodified: (d) => seen.push(d) })
    const SALT = salt()
    codify(SALT, CREDIT, deps)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({
      recipeId: SALT.id, name: SALT.name, kind: 'craft', makes: ['salt'], credit: CREDIT,
    })
  })

  it('does NOT call it again when the same recipe is codified twice', () => {
    const seen: Codified[] = []
    const deps = makeCodifyDeps({ onCodified: (d) => seen.push(d) })
    const SALT = salt()
    codify(SALT, CREDIT, deps)
    codify(SALT, CREDIT, deps)
    expect(seen).toHaveLength(1)
  })

  it('does NOT call it when a reverted rule is re-opened — the town did not invent it twice', () => {
    const seen: Codified[] = []
    const deps = makeCodifyDeps({ onCodified: (d) => seen.push(d) })
    const SALT = salt()
    codify(SALT, CREDIT, deps)
    deps.review.revertByRecipe(SALT.id, 'admin test', 10)
    codify(SALT, CREDIT, deps)
    expect(seen).toHaveLength(1)
  })
})
