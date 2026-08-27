// A seeding is two writes and a crash can land between them. What the repair rebuilds is not
// always the same list — `homeOf` reads live world state — so the resume is keyed on the event
// each entry came from, never on how many rows are already there.
import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { EventStore, openDb } from '@sj/engine/store'
import { FakeEmbedder } from '@sj/llm/testutil'
import { openAgentDb } from '../memory/schema.js'
import type { AgentBornPayload } from '../family/watchBirths.js'
import { ensureHousehold } from './ensureChild.js'

const CHILD = 'agent_3'
const HOME = 'structure_home'
const BORN: AgentBornPayload = {
  id: CHILD,
  name: 'Mira',
  sex: 'f',
  motherId: 'amara',
  fatherId: 'yusuf',
  x: 3,
  y: 3,
}

const HOUSE_LINE = 'The house you were born in was finished.'
const BORN_LINE = 'You were born to your mother and your father, in this town.'

const texts = (db: Database.Database): string[] =>
  (
    db.prepare('SELECT text FROM memories WHERE agent_id = ? ORDER BY id').all(CHILD) as {
      text: string
    }[]
  ).map((r) => r.text)

describe('ensureHousehold', () => {
  it('★ finishes a seeding a crash cut short, and repeats nothing that landed', async () => {
    const store = new EventStore(openDb(':memory:'))
    store.append(0, 'structure_completed', { id: HOME })
    store.append(1, 'agent_born', { ...BORN })
    const db = openAgentDb(':memory:')
    const real = await FakeEmbedder.create()
    let left = 1
    const dying = {
      embed: async (t: string): Promise<Float32Array> => {
        if (left-- <= 0) throw new Error('the process died mid-seeding')
        return real.embed(t)
      },
    }

    // At birth the child is inside the house it was born in, and the seed says so.
    await expect(
      ensureHousehold({ store, db, embedder: dying, homeOf: () => HOME }, BORN, 1),
    ).rejects.toThrow('mid-seeding')
    expect(texts(db)).toEqual([HOUSE_LINE])

    // By the repair boot the body has walked out, so `homeOf` no longer names the house and the
    // rebuilt seed is SHORTER than what is already written. A row count would stop here.
    await ensureHousehold({ store, db, embedder: real, homeOf: () => '' }, BORN, 1)
    expect(texts(db)).toEqual([HOUSE_LINE, BORN_LINE])

    // And a third boot writes nothing: the seed is done.
    await ensureHousehold({ store, db, embedder: real, homeOf: () => HOME }, BORN, 1)
    expect(texts(db)).toEqual([HOUSE_LINE, BORN_LINE])
    db.close()
  })
})
