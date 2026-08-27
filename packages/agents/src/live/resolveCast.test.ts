// Who is in the town at boot. A cast that is only the founder array forgets every child the
// moment the process restarts.
import { describe, expect, it } from 'vitest'
import { EventStore, openDb } from '@sj/engine/store'
import type { PersonalityDoc } from '../personality.js'
import { tamarIdentity } from '../testutil/fixtures.js'
import type { MindSpec } from './liveMinds.js'
import { resolveCast } from './resolveCast.js'

const MOTHER = 'amara'
const FATHER = 'yusuf'

const doc: PersonalityDoc = {
  temperament: 'exacting, quiet',
  values: ['a full store'],
  beliefs: ['what is counted keeps'],
  current: { mood: 'watchful', worries: [], goals: [] },
}

const founder = (id: string, sex: 'f' | 'm'): MindSpec => ({
  id,
  identity: { ...tamarIdentity, name: id },
  personality: doc,
  ageDays: 34 * 364,
  sex,
})

const FOUNDERS = [founder(MOTHER, 'f'), founder(FATHER, 'm')]

function log() {
  const store = new EventStore(openDb(':memory:'))
  return {
    store,
    bear: (id: string, name: string, motherId: string, fatherId: string, sex: 'f' | 'm' = 'f') => {
      store.append(0, 'agent_born', { id, name, sex, motherId, fatherId, x: 3, y: 3 })
    },
    noise: (n: number) => {
      for (let i = 0; i < n; i += 1) store.append(0, 'agent_moved', { id: MOTHER, x: i, y: 0 })
    },
  }
}

describe('resolveCast — the town at boot is the founders plus everyone born since', () => {
  it('is the founders alone when nothing has been born', () => {
    const l = log()
    l.noise(20)
    expect(resolveCast(FOUNDERS, l.store, 10).map((m) => m.id)).toEqual([MOTHER, FATHER])
  })

  it('replays every agent_born into a spec derived from its parents', () => {
    const l = log()
    l.noise(5)
    l.bear('agent_3', 'Mira', MOTHER, FATHER)
    const cast = resolveCast(FOUNDERS, l.store, 10)

    expect(cast.map((m) => m.id)).toEqual([MOTHER, FATHER, 'agent_3'])
    const child = cast[2]!
    expect(child.identity.name).toBe('Mira')
    expect(child.sex).toBe('f')
    expect(child.identity.backstory).toContain(MOTHER)
  })

  it('derives the same child twice — a resume is not a different person', () => {
    const l = log()
    l.bear('agent_3', 'Mira', MOTHER, FATHER)
    expect(resolveCast(FOUNDERS, l.store, 10)[2]).toEqual(resolveCast(FOUNDERS, l.store, 10)[2])
  })

  it('a child of a child derives from the cast the earlier birth already grew', () => {
    const l = log()
    l.bear('agent_3', 'Mira', MOTHER, FATHER)
    l.bear('agent_4', 'Idris', 'agent_3', FATHER, 'm')
    const cast = resolveCast(FOUNDERS, l.store, 10)

    expect(cast.map((m) => m.id)).toEqual([MOTHER, FATHER, 'agent_3', 'agent_4'])
    expect(cast[3]!.identity.backstory).toContain('Mira')
  })

  it('a birth whose parents this town never knew is skipped, not guessed at', () => {
    const l = log()
    l.bear('agent_9', 'Nobody', 'stranger', FATHER)
    expect(resolveCast(FOUNDERS, l.store, 10).map((m) => m.id)).toEqual([MOTHER, FATHER])
  })

  it('stops at the population ceiling — the log may hold more than the town will boot', () => {
    const l = log()
    l.bear('agent_3', 'Mira', MOTHER, FATHER)
    l.bear('agent_4', 'Idris', MOTHER, FATHER, 'm')
    expect(resolveCast(FOUNDERS, l.store, 3).map((m) => m.id)).toEqual([MOTHER, FATHER, 'agent_3'])
  })
})
