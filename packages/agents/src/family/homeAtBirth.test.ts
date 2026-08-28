import { describe, expect, it } from 'vitest'
import { EventStore, openDb } from '@sj/engine/store'
import { homeAtBirth } from './homeAtBirth.js'

const MOTHER = 'amara'
const HOME = 'structure_home'
const OTHER = 'structure_barn'

const store = (): EventStore => new EventStore(openDb(':memory:'))

describe('homeAtBirth', () => {
  it('is the structure the mother was inside at the birth seq, however she moved after', () => {
    const s = store()
    s.append(0, 'agent_entered', { agentId: MOTHER, structureId: HOME })
    const born = s.append(1, 'agent_born', { id: 'agent_3', motherId: MOTHER })
    s.append(2, 'agent_exited', { agentId: MOTHER, structureId: HOME })
    s.append(3, 'agent_entered', { agentId: MOTHER, structureId: OTHER })

    expect(homeAtBirth(s, MOTHER, born.seq)).toBe(HOME)
  })

  it('is empty when she was under the sky, and ignores everyone else', () => {
    const s = store()
    s.append(0, 'agent_entered', { agentId: 'yusuf', structureId: HOME })
    s.append(1, 'agent_entered', { agentId: MOTHER, structureId: HOME })
    s.append(2, 'agent_exited', { agentId: MOTHER, structureId: HOME })
    const born = s.append(3, 'agent_born', { id: 'agent_3', motherId: MOTHER })

    expect(homeAtBirth(s, MOTHER, born.seq)).toBe('')
  })

  it('is empty for a town that has no interiors at all', () => {
    expect(homeAtBirth(store(), MOTHER, 1)).toBe('')
  })
})
