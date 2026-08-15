import { afterEach, describe, expect, it } from 'vitest'
import { SimConfigSchema, type SimConfig, type SimEvent } from '@sj/shared'
import { fold, genesisState, submitIntent, unregisterVerb, type WorldState } from '@sj/engine'
import { openArbiterDb } from './schema.js'
import { RulebookStore } from './rulebook.js'
import { codify } from './codify.js'
import { ReviewStore } from './review.js'
import type { Recipe } from './verdict.js'

const CFG: SimConfig = SimConfigSchema.parse({})

const boilSaltRecipe: Recipe = {
  id: 'recipe:boil_salt',
  name: 'Boil River Water for Salt',
  durationTicks: 6,
  costs: [{ kind: 'firewood', qty: 1 }],
  requires: [{ type: 'held_item', kind: 'clay_pot', qty: 1 }],
  outcomeTable: [
    { weight: 1, success: true, label: 'The water boils away, leaving a crust of salt.', effects: [{ op: 'spawn_item', kind: 'salt', qty: 1, to: 'agent' }] },
    { weight: 1, success: false, label: 'The pot cracks and the water is lost.', effects: [{ op: 'none' }] },
  ],
  rngStream: 'craft',
  interruptible: true,
  canon: ['fire'],
}

let seq = 90000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })

function agentState(): WorldState {
  return fold(genesisState(CFG), ev('agent_spawned', { id: 'a1', name: 'a1', x: 5, y: 5, ageDays: 7300 }), CFG)
}

function makeReview() {
  const db = openArbiterDb(':memory:')
  const rulebook = new RulebookStore(db)
  const review = new ReviewStore(db)
  return { db, rulebook, review }
}

type ReviewStatusRow = { status: string; reason?: string | null }
describe('ReviewStore', () => {
  afterEach(() => unregisterVerb('recipe:boil_salt'))
  it('queue then pending returns the row with status pending', () => {
    const { review, rulebook } = makeReview()
    const ruleId = rulebook.insert(boilSaltRecipe, 200)
    review.queue(ruleId, 'recipe:boil_salt', 200)
    const rows = review.pending()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ruleId, recipeId: 'recipe:boil_salt', status: 'pending', reason: null, tick: 200 })
  })

  it('codify auto-queues a pending review for every codified rule', () => {
    const { review, rulebook } = makeReview()
    const { ruleId } = codify(boilSaltRecipe, { rulebook, review, tick: 200 })
    expect(review.pending()).toEqual([
      expect.objectContaining({ ruleId, recipeId: 'recipe:boil_salt', status: 'pending', reason: null, tick: 200 }),
    ])
  })

  it('approve moves the row to approved and out of pending', () => {
    const { db, review, rulebook } = makeReview()
    const ruleId = rulebook.insert(boilSaltRecipe, 200)
    review.queue(ruleId, 'recipe:boil_salt', 200)
    review.approve(ruleId)
    expect(review.pending()).toEqual([])
    const row = db.prepare('SELECT status FROM ruling_reviews WHERE rule_id = ?').get(ruleId) as ReviewStatusRow
    expect(row.status).toBe('approved')
  })

  it('revert tombstones the rulebook, unregisters the verb, and marks the row reverted', () => {
    const { db, review, rulebook } = makeReview()
    const { ruleId } = codify(boilSaltRecipe, { rulebook, review, tick: 200 })
    review.revert(ruleId, 'physics wrong', 500)

    const row = db.prepare('SELECT status, reason FROM ruling_reviews WHERE rule_id = ?').get(ruleId) as ReviewStatusRow
    expect(row).toEqual({ status: 'reverted', reason: 'physics wrong' })

    const rb = rulebook.byId('recipe:boil_salt')
    expect(rb!.revertedAtTick).toBe(500)
    expect(rulebook.lookup('Boil River Water for Salt')).toBeNull()

    const res = submitIntent(agentState(), CFG, 'a1', 'recipe:boil_salt', {})
    expect(res).toEqual({ ok: false, reason: 'unknown verb: recipe:boil_salt' })
  })

  it('reverting an already-approved rule re-queues idempotently: a single reverted disposition', () => {
    const { db, review, rulebook } = makeReview()
    const { ruleId } = codify(boilSaltRecipe, { rulebook, review, tick: 200 })
    review.approve(ruleId)
    review.revert(ruleId, 'physics wrong', 500)

    review.queue(ruleId, 'recipe:boil_salt', 600)
    expect(review.pending()).toHaveLength(1) // idempotent re-queue: no duplicate pending
    review.revert(ruleId, 'physics wrong', 700)
    const rows = db.prepare('SELECT status FROM ruling_reviews WHERE rule_id = ?').all(ruleId) as Array<{ status: string }>
    expect(rows).toEqual([{ status: 'reverted' }])
    expect(review.pending()).toEqual([])
  })


  it('approve throws on a tombstoned rule', () => {
    const { db, review, rulebook } = makeReview()
    const { ruleId } = codify(boilSaltRecipe, { rulebook, review, tick: 200 })
    review.revert(ruleId, 'physics wrong', 500)
    review.queue(ruleId, 'recipe:boil_salt', 600) // re-queue a reverted rule
    expect(() => review.approve(ruleId)).toThrow(/reverted/)
    const row = db.prepare('SELECT status FROM ruling_reviews WHERE rule_id = ?').get(ruleId) as { status: string }
    expect(row.status).toBe('pending') // disposition unchanged
  })

  it('revertByRecipe queues first when no review row exists, then leaves a single reverted disposition', () => {
    const { db, review, rulebook } = makeReview()
    const ruleId = rulebook.insert(boilSaltRecipe, 200) // bypass codify: no auto-queue
    review.revertByRecipe('recipe:boil_salt', 'physics wrong', 500)
    expect(review.pending()).toEqual([])
    const rows = db.prepare('SELECT status FROM ruling_reviews WHERE rule_id = ?').all(ruleId) as Array<{ status: string }>
    expect(rows).toEqual([{ status: 'reverted' }])
  })

})
