import { describe, expect, it } from 'vitest'
import { SimConfigSchema, type SimConfig, type SimEvent } from '@sj/shared'
import { RngStream, fold, genesisState, submitIntent, type WorldState } from '@sj/engine'
import { openArbiterDb } from './schema.js'
import { RulebookStore } from './rulebook.js'
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
  })

  describe('codify', () => {
    it('inserts the recipe into the rulebook and hot-registers the verb live in the engine registry', () => {
      const db = openArbiterDb(':memory:')
      const rulebook = new RulebookStore(db)
      const { ruleId, verb } = codify(boilSaltRecipe, { rulebook, tick: 200 })
      expect(ruleId).toBeTypeOf('number')
      expect(verb).toBe('recipe:boil_salt')
      expect(rulebook.byId('recipe:boil_salt')).not.toBeNull()
      const res = submitIntent(burningFireAdjacent(), CFG, 'a1', 'recipe:boil_salt', {})
      expect(res).toMatchObject({ ok: true })
    })
  })
})
