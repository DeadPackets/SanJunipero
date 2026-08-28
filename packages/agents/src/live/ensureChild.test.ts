// A seeding is two writes and a crash can land between them, so the resume is keyed on the event
// each entry came from, never on how many rows are already there.
import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { EventStore, openDb } from '@sj/engine/store'
import { FakeEmbedder } from '@sj/llm/testutil'
import { openAgentDb } from '../memory/schema.js'
import type { AgentBornPayload } from '../family/watchBirths.js'
import { ensureHousehold } from './ensureChild.js'

const CHILD = 'agent_3'
const MOTHER = 'amara'
const HOME = 'structure_home'
const BORN: AgentBornPayload = {
  id: CHILD,
  name: 'Mira',
  sex: 'f',
  motherId: MOTHER,
  fatherId: 'yusuf',
  x: 3,
  y: 3,
}
const BIRTH = { seq: 3, tick: 1 }

const HOUSE_LINE = 'The house you were born in was finished.'
const BORN_LINE = 'You were born to your mother and your father, in this town.'

const texts = (db: Database.Database): string[] =>
  (
    db.prepare('SELECT text FROM memories WHERE agent_id = ? ORDER BY id').all(CHILD) as {
      text: string
    }[]
  ).map((r) => r.text)

/** The mother is indoors when she bears, and has walked out again by the time a repair runs. */
function bornIndoors(): EventStore {
  const store = new EventStore(openDb(':memory:'))
  store.append(0, 'agent_entered', { agentId: MOTHER, structureId: HOME })
  store.append(0, 'structure_completed', { id: HOME })
  store.append(1, 'agent_born', { ...BORN })
  store.append(2, 'agent_exited', { agentId: MOTHER, structureId: HOME })
  return store
}

describe('ensureHousehold', () => {
  it('★ finishes a seeding a crash cut short, and repeats nothing that landed', async () => {
    const store = bornIndoors()
    const db = openAgentDb(':memory:')
    const real = await FakeEmbedder.create()
    let left = 1
    const dying = {
      embed: async (t: string): Promise<Float32Array> => {
        if (left-- <= 0) throw new Error('the process died mid-seeding')
        return real.embed(t)
      },
    }

    await expect(ensureHousehold({ store, db, embedder: dying }, BORN, BIRTH)).rejects.toThrow(
      'mid-seeding',
    )
    expect(texts(db)).toEqual([HOUSE_LINE])

    // The mother has walked out by now, and the repair still rebuilds the same list: the home
    // comes off the log at the birth seq, not off where anybody is standing.
    await ensureHousehold({ store, db, embedder: real }, BORN, BIRTH)
    expect(texts(db)).toEqual([HOUSE_LINE, BORN_LINE])

    // And a third boot writes nothing: the seed is done.
    await ensureHousehold({ store, db, embedder: real }, BORN, BIRTH)
    expect(texts(db)).toEqual([HOUSE_LINE, BORN_LINE])
    db.close()
  })
})
