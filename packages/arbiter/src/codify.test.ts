import { describe, expect, it } from 'vitest'
import { SimConfigSchema, type SimConfig, type SimEvent } from '@sj/shared'
import { RngStream, fold, genesisState, submitIntent, type WorldState } from '@sj/engine'
import { openArbiterDb } from './schema.js'
import { CodexStore } from './codex.js'
import { RulebookStore } from './rulebook.js'
import { ReviewStore } from './review.js'
import type { Recipe } from './verdict.js'
import { codify, emitOutcomeEffects, verbFromRecipe } from './codify.js'

const CFG: SimConfig = SimConfigSchema.parse({})

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
  interruptible: true,
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
    it('maps the recipe onto the VerbDef shape (kind, interruptible, skill, rngStream, duration)', () => {
      const def = verbFromRecipe(boilSaltRecipe)
      expect(def.kind).toBe('recipe:boil_salt')
      expect(def.interruptible).toBe(true)
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
        { type: 'item_spawned', payload: { id: `item_${nextId}`, kind: 'salt', qty: 1, loc: { t: 'agent', id: 'a1' } } },
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

  describe('codify', () => {
    it('inserts the recipe into the rulebook and hot-registers the verb live in the engine registry', () => {
      const db = openArbiterDb(':memory:')
      const rulebook = new RulebookStore(db)
      const review = new ReviewStore(db)
      const codex = new CodexStore(db)
      codex.insert({ id: 'fire', era: 'agriculture', name: 'Fire', prerequisiteId: null })
      codex.insert({ id: 'pottery', era: 'agriculture', name: 'Pottery', prerequisiteId: null })
      const { ruleId, verb } = codify(boilSaltRecipe, { rulebook, review, codex, tick: 200 })
      expect(ruleId).toBeTypeOf('number')
      expect(verb).toBe('recipe:boil_salt')
      expect(rulebook.byId('recipe:boil_salt')).not.toBeNull()
      const res = submitIntent(burningFireAdjacent(), CFG, 'a1', 'recipe:boil_salt', {})
      expect(res).toMatchObject({ ok: true })
    })
  })
})
