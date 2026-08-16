import { describe, expect, it } from 'vitest'
import { derivePersona, type ParentPersona } from './derivePersona.js'
import { FORBIDDEN_FRAMING } from '../prompt/rulesOfBeing.js'

const MOTHER: ParentPersona = {
  agentId: 'amara',
  identity: {
    name: 'Amara',
    age: 34,
    backstory: 'Came down the river road with a sack of seed and stayed.',
    temperament: 'stubborn, warm, quick to laugh',
    voiceCard: {
      register: 'warm and unhurried; long sentences that circle back',
      rhythm: 'she asks before she tells',
      tics: ['calls everyone "friend"'],
      neverSays: ['curses'],
      exampleLines: ['Sit. Eat first.'],
      wordBudget: { typical: 30, burst: 60 },
    },
  },
  personality: {
    temperament: 'stubborn, warm, quick to laugh',
    values: ['feed whoever is hungry', 'finish what you start'],
    beliefs: ['the soil remembers'],
    current: { mood: 'settled', worries: [], goals: [] },
  },
}

const FATHER: ParentPersona = {
  agentId: 'yusuf',
  identity: {
    name: 'Yusuf',
    age: 39,
    backstory: 'A carpenter who measures twice and says half of what he thinks.',
    temperament: 'quiet, exacting, slow to anger',
    voiceCard: {
      register: 'terse; nouns and verbs, few adjectives',
      rhythm: 'one thought per breath, then silence',
      tics: ['counts on his fingers aloud'],
      neverSays: ['promises he cannot keep'],
      exampleLines: ['It will hold.'],
      wordBudget: { typical: 12, burst: 28 },
    },
  },
  personality: {
    temperament: 'quiet, exacting, slow to anger',
    values: ['do it once, do it right'],
    beliefs: ['a roof is a promise', 'wood tells you where it wants to break'],
    current: { mood: 'steady', worries: [], goals: [] },
  },
}

const CHILD = { id: 'agent_7', name: 'Mira', sex: 'f' as const }

describe('derivePersona (T25)', () => {
  it('is byte-identical for the same child id, and different for another', () => {
    const a = derivePersona(CHILD, [MOTHER, FATHER])
    const b = derivePersona(CHILD, [MOTHER, FATHER])
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))

    const other = derivePersona({ ...CHILD, id: 'agent_8' }, [MOTHER, FATHER])
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(a))
  })

  it('temperament interleaves traits provably drawn from BOTH parents', () => {
    const { identity, personality } = derivePersona(CHILD, [MOTHER, FATHER])
    const traits = identity.temperament.split(', ')
    const mine = new Set(MOTHER.identity.temperament.split(', '))
    const his = new Set(FATHER.identity.temperament.split(', '))

    expect(traits.length).toBeGreaterThanOrEqual(2)
    expect(traits.some((t) => mine.has(t))).toBe(true)
    expect(traits.some((t) => his.has(t))).toBe(true)
    for (const t of traits) expect(mine.has(t) || his.has(t)).toBe(true)
    // Temperament is frozen at birth and the two copies must agree from the first tick.
    expect(personality.temperament).toBe(identity.temperament)
  })

  it('takes the register from one parent and the rhythm from the other', () => {
    const { identity } = derivePersona(CHILD, [MOTHER, FATHER])
    const v = identity.voiceCard
    const registerFrom = v.register === MOTHER.identity.voiceCard.register ? 0 : 1
    expect([MOTHER.identity.voiceCard.register, FATHER.identity.voiceCard.register]).toContain(v.register)
    const rhythms = [MOTHER.identity.voiceCard.rhythm, FATHER.identity.voiceCard.rhythm]
    expect(v.rhythm).toBe(rhythms[1 - registerFrom])
  })

  it('values and beliefs are sampled from the union of both parents, nothing invented', () => {
    const { personality } = derivePersona(CHILD, [MOTHER, FATHER])
    const values = new Set([...MOTHER.personality.values, ...FATHER.personality.values])
    const beliefs = new Set([...MOTHER.personality.beliefs, ...FATHER.personality.beliefs])
    expect(personality.values.length).toBeGreaterThan(0)
    for (const v of personality.values) expect(values.has(v)).toBe(true)
    for (const b of personality.beliefs) expect(beliefs.has(b)).toBe(true)
  })

  it('the backstory names both parents, the child is twelve, and the prose stays in world', () => {
    const { identity } = derivePersona(CHILD, [MOTHER, FATHER])
    expect(identity.name).toBe('Mira')
    expect(identity.age).toBe(12)
    expect(identity.backstory).toContain('Amara')
    expect(identity.backstory).toContain('Yusuf')
    expect(identity.backstory).not.toMatch(FORBIDDEN_FRAMING)
    expect(identity.temperament).not.toMatch(FORBIDDEN_FRAMING)
  })

  it('the word budget is the parents’ mean, and absent when neither parent has one', () => {
    const { identity } = derivePersona(CHILD, [MOTHER, FATHER])
    expect(identity.voiceCard.wordBudget).toEqual({ typical: 21, burst: 44 })

    const plain = (p: ParentPersona): ParentPersona => ({
      ...p,
      identity: { ...p.identity, voiceCard: { ...p.identity.voiceCard, wordBudget: undefined } },
    })
    const budgetless = derivePersona(CHILD, [plain(MOTHER), plain(FATHER)])
    expect('wordBudget' in budgetless.identity.voiceCard).toBe(false)
  })

  it('a son gets his own pronouns', () => {
    const son = derivePersona({ id: 'agent_9', name: 'Idris', sex: 'm' }, [MOTHER, FATHER])
    expect(son.identity.backstory).toMatch(/\bhe\b|\bhis\b|\bhim\b/)
    expect(son.identity.backstory).not.toMatch(/\bshe\b|\bher\b/)
  })
})
