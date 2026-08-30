import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openAgentDb } from './memory/schema.js'
import { MemoryStore, type MemoryTags } from './memory/store.js'
import { FakeEmbedder } from '@sj/llm/testutil'
import { PersonalityStore, type PersonalityDoc } from './personality.js'

const TAGS: MemoryTags = {
  people: [],
  place: null,
  objects: [],
  topics: [],
}

const BASE_DOC: PersonalityDoc = {
  temperament: 'calm',
  values: ['loyalty'],
  beliefs: [],
  current: { mood: 'ok', worries: [], goals: [] },
}

async function makeStore(
  agentId = 'tamar',
): Promise<{ db: Database.Database; mem: MemoryStore; store: PersonalityStore }> {
  const db = openAgentDb(':memory:')
  const mem = new MemoryStore(db, agentId, await FakeEmbedder.create())
  const store = new PersonalityStore(db, agentId)
  return { db, mem, store }
}

async function insertMemory(mem: MemoryStore, tick: number): Promise<number> {
  return mem.insertMemory({
    tick,
    kind: 'thought',
    text: `memory at tick ${tick}`,
    importance: 5,
    tags: TAGS,
  })
}

describe('PersonalityStore versioning', () => {
  it('init writes version 1 with the full doc, current() reads it back', async () => {
    const { store } = await makeStore()
    store.init(BASE_DOC, 0)
    const cur = store.current()
    expect(cur.version).toBe(1)
    expect(cur.doc).toEqual(BASE_DOC)
    expect(cur.doc.temperament).toBe('calm')
  })

  it('add-belief edit citing a same-day memory -> v2, history() shows the edit, doc updated', async () => {
    const { mem, store } = await makeStore()
    store.init(BASE_DOC, 0)
    const evidence = await insertMemory(mem, 1500) // day 1
    const res = store.applyNightlyEdit(
      1,
      {
        op: 'add',
        field: 'beliefs',
        text: 'the storehouse must be sealed before rain',
        evidence: [evidence],
      },
      mem,
    )
    expect(res).toEqual({ ok: true, version: 2 })

    const cur = store.current()
    expect(cur.version).toBe(2)
    expect(cur.doc.beliefs).toEqual(['the storehouse must be sealed before rain'])
    // temperament and current untouched by a beliefs edit
    expect(cur.doc.temperament).toBe('calm')
    expect(cur.doc.current).toEqual(BASE_DOC.current)

    const hist = store.history()
    expect(hist).toHaveLength(2)
    expect(hist[0]).toEqual({ version: 1, day: 0, edit: null })
    expect(hist[1]).toEqual({
      version: 2,
      day: 1,
      edit: {
        op: 'add',
        field: 'beliefs',
        text: 'the storehouse must be sealed before rain',
        evidence: [evidence],
      },
    })
  })

  it('second edit on the same day -> edit_already_applied_today', async () => {
    const { mem, store } = await makeStore()
    store.init(BASE_DOC, 0)
    const e1 = await insertMemory(mem, 1500)
    const e2 = await insertMemory(mem, 1600)
    expect(
      store.applyNightlyEdit(1, { op: 'add', field: 'beliefs', text: 'a', evidence: [e1] }, mem),
    ).toEqual({ ok: true, version: 2 })
    expect(
      store.applyNightlyEdit(1, { op: 'add', field: 'beliefs', text: 'b', evidence: [e2] }, mem),
    ).toEqual({
      ok: false,
      reason: 'edit_already_applied_today',
    })
  })

  it('evidence from yesterday -> evidence_not_from_today', async () => {
    const { mem, store } = await makeStore()
    store.init(BASE_DOC, 0)
    const yesterday = await insertMemory(mem, 100) // day 0
    expect(
      store.applyNightlyEdit(
        1,
        { op: 'add', field: 'values', text: 'x', evidence: [yesterday] },
        mem,
      ),
    ).toEqual({
      ok: false,
      reason: 'evidence_not_from_today',
    })
  })

  it('evidence id with no row -> evidence_missing', async () => {
    const { mem, store } = await makeStore()
    store.init(BASE_DOC, 0)
    expect(
      store.applyNightlyEdit(1, { op: 'add', field: 'values', text: 'x', evidence: [9999] }, mem),
    ).toEqual({
      ok: false,
      reason: 'evidence_missing',
    })
  })

  it('evidence owned by another agent -> evidence_missing', async () => {
    const { db, mem, store } = await makeStore('tamar')
    store.init(BASE_DOC, 0)
    const omarMem = new MemoryStore(db, 'omar', await FakeEmbedder.create())
    const omarId = await omarMem.insertMemory({
      tick: 1500,
      kind: 'thought',
      text: 'private',
      importance: 5,
      tags: TAGS,
    })
    expect(
      store.applyNightlyEdit(1, { op: 'add', field: 'values', text: 'x', evidence: [omarId] }, mem),
    ).toEqual({
      ok: false,
      reason: 'evidence_missing',
    })
  })

  it('raw edit touching temperament -> invalid_edit_shape (schema cannot express it)', async () => {
    const { mem, store } = await makeStore()
    store.init(BASE_DOC, 0)
    const e = await insertMemory(mem, 1500)
    expect(
      store.applyNightlyEdit(
        1,
        { op: 'revise', field: 'temperament', index: 0, text: 'angry', evidence: [e] },
        mem,
      ),
    ).toEqual({ ok: false, reason: 'invalid_edit_shape' })
  })

  it('201-char text -> invalid_edit_shape', async () => {
    const { mem, store } = await makeStore()
    store.init(BASE_DOC, 0)
    const e = await insertMemory(mem, 1500)
    const long = 'a'.repeat(201)
    expect(
      store.applyNightlyEdit(1, { op: 'add', field: 'beliefs', text: long, evidence: [e] }, mem),
    ).toEqual({
      ok: false,
      reason: 'invalid_edit_shape',
    })
  })

  it('unknown key -> invalid_edit_shape (Zod 4 .strict)', async () => {
    const { mem, store } = await makeStore()
    store.init(BASE_DOC, 0)
    const e = await insertMemory(mem, 1500)
    expect(
      store.applyNightlyEdit(
        1,
        { op: 'add', field: 'beliefs', text: 'x', evidence: [e], sneak: 'in' },
        mem,
      ),
    ).toEqual({ ok: false, reason: 'invalid_edit_shape' })
  })

  it('updateCurrent rewrites fluid layer in place without a version bump', async () => {
    const { store } = await makeStore()
    store.init(BASE_DOC, 0)
    expect(store.current().version).toBe(1)
    store.updateCurrent({ mood: 'tired', worries: ['rain'], goals: ['rest'] })
    const cur = store.current()
    expect(cur.version).toBe(1)
    expect(cur.doc.current).toEqual({ mood: 'tired', worries: ['rain'], goals: ['rest'] })
    expect(store.history()).toHaveLength(1)
  })

  it('revise and remove mutate the drift-limited layer across nights', async () => {
    const { mem, store } = await makeStore()
    store.init({ ...BASE_DOC, values: ['loyalty', 'duty'], beliefs: ['rain is coming'] }, 0)
    const e1 = await insertMemory(mem, 1500) // day 1
    expect(
      store.applyNightlyEdit(
        1,
        { op: 'revise', field: 'values', index: 1, text: 'honor', evidence: [e1] },
        mem,
      ),
    ).toEqual({ ok: true, version: 2 })
    expect(store.current().doc.values).toEqual(['loyalty', 'honor'])

    const e2 = await insertMemory(mem, 3000) // day 2
    expect(
      store.applyNightlyEdit(2, { op: 'remove', field: 'beliefs', index: 0, evidence: [e2] }, mem),
    ).toEqual({ ok: true, version: 3 })
    expect(store.current().doc.beliefs).toEqual([])
    expect(store.current().doc.temperament).toBe('calm')
  })

  it('revise/remove with index out of range -> index_out_of_range (after evidence passes)', async () => {
    const { mem, store } = await makeStore()
    store.init(BASE_DOC, 0) // values: ['loyalty'], beliefs: []
    const e = await insertMemory(mem, 1500)
    expect(
      store.applyNightlyEdit(
        1,
        { op: 'revise', field: 'values', index: 5, text: 'x', evidence: [e] },
        mem,
      ),
    ).toEqual({
      ok: false,
      reason: 'index_out_of_range',
    })
    expect(
      store.applyNightlyEdit(1, { op: 'remove', field: 'beliefs', index: 0, evidence: [e] }, mem),
    ).toEqual({
      ok: false,
      reason: 'index_out_of_range',
    })
    // no version bump on rejection
    expect(store.current().version).toBe(1)
  })

  // Run D: the model answered "No change" and the store appended it to values as a trait.
  it('no-op text is skipped, not applied and not rejected', async () => {
    const { mem, store } = await makeStore()
    store.init(BASE_DOC, 0)
    const e = await insertMemory(mem, 1500)
    for (const text of ['No change', 'nothing to change.', 'NONE', 'n/a', 'no edit!']) {
      expect(
        store.applyNightlyEdit(1, { op: 'add', field: 'values', text, evidence: [e] }, mem),
        text,
      ).toEqual({ ok: false, reason: 'no_op_text', skipped: true })
    }
    expect(
      store.applyNightlyEdit(
        1,
        { op: 'revise', field: 'values', index: 0, text: 'no changes', evidence: [e] },
        mem,
      ),
    ).toEqual({ ok: false, reason: 'no_op_text', skipped: true })

    expect(store.current().version).toBe(1)
    expect(store.current().doc.values).toEqual(BASE_DOC.values)

    // a real trait on the same day still lands
    expect(
      store.applyNightlyEdit(
        1,
        { op: 'add', field: 'values', text: 'no one eats alone', evidence: [e] },
        mem,
      ),
    ).toEqual({ ok: true, version: 2 })
    expect(store.current().doc.values).toEqual([...BASE_DOC.values, 'no one eats alone'])
  })

  // Run E, salma v2: the refusal said in prose and buried mid-sentence, which the anchored
  // form let straight through and stored as a belief.
  it('a trait that says nothing moved is skipped however it is phrased', async () => {
    const { mem, store } = await makeStore()
    store.init(BASE_DOC, 0)
    const e = await insertMemory(mem, 1500)
    const softNoOps = [
      'I have walked further than I meant to. Yet this is not a change in what I value or believe; it is only a change in where I stand.',
      'What I hold is no different from yesterday.',
      'My belief is unchanged.',
      'Everything stays the same.',
      'Keep as is.',
    ]
    for (const text of softNoOps) {
      expect(
        store.applyNightlyEdit(1, { op: 'add', field: 'beliefs', text, evidence: [e] }, mem),
        text,
      ).toEqual({ ok: false, reason: 'no_op_text', skipped: true })
    }
    expect(store.current().version).toBe(1)

    // Salma v3, the real reversal from the same run, still lands.
    expect(
      store.applyNightlyEdit(
        1,
        {
          op: 'add',
          field: 'beliefs',
          text: 'A thing named is a thing I can reach. Naming opens, it does not worsen.',
          evidence: [e],
        },
        mem,
      ),
    ).toEqual({ ok: true, version: 2 })
  })
})
