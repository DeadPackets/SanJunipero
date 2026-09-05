import { describe, expect, it } from 'vitest'
import {
  askPhrase,
  memoryLinesFor,
  momentPassedLine,
  noAnswerLine,
  peopleIn,
  readFact,
  tiesFor,
  type RelationshipFact,
} from './invitations.js'

const A = 'nadia'
const B = 'omar'
const NAMES: Record<string, string> = { nadia: 'Nadia', omar: 'Omar', salma: 'Salma' }
const nameOf = (id: string): string => NAMES[id] ?? id

const accepted = (verb: 'court' | 'propose' | 'lie_with'): RelationshipFact => ({
  type: 'invitation_accepted',
  agentId: A,
  byId: B,
  verb,
})

describe('reading the log', () => {
  it('takes each of the five through the engine’s own schema', () => {
    expect(readFact({ type: 'invited', payload: { agentId: A, byId: B, verb: 'court' } })).toEqual({
      type: 'invited',
      agentId: A,
      byId: B,
      verb: 'court',
    })
    expect(
      readFact({ type: 'partnership_dissolved', payload: { aId: A, bId: B, byId: B } }),
    ).toEqual({ type: 'partnership_dissolved', aId: A, bId: B, byId: B })
  })

  it('refuses a payload the schema would not take, rather than guessing at it', () => {
    expect(
      readFact({ type: 'invited', payload: { agentId: A, byId: B, verb: 'marry' } }),
    ).toBeNull()
    expect(readFact({ type: 'invited', payload: { agentId: A } })).toBeNull()
    expect(readFact({ type: 'agent_moved', payload: { id: A, x: 1, y: 1 } })).toBeNull()
  })

  it('names the two people every fact is about', () => {
    expect(peopleIn({ type: 'partnership_formed', aId: A, bId: B })).toEqual([A, B])
    expect(peopleIn({ type: 'agent_born', motherId: A, fatherId: B })).toEqual([A, B])
    expect(peopleIn(accepted('court'))).toEqual([A, B])
  })
})

describe('what the invitee is told', () => {
  it('names the asker and the thing itself, and asks for a yes or a no', () => {
    for (const verb of ['court', 'propose', 'lie_with'] as const) {
      const said = askPhrase(verb, 'Omar')
      expect(said).toContain('Omar has asked you')
      expect(said).toContain('accept or refuse')
      expect(said, 'a mark is never spoken').not.toContain('_')
    }
    expect(askPhrase('court', 'Omar')).toContain('walk out together')
    expect(askPhrase('propose', 'Omar')).toContain('partners for good')
    expect(askPhrase('lie_with', 'Omar')).toContain('sleep together')
  })
})

describe('the ties a relationship leaves', () => {
  it('a courtship is an attraction each way', () => {
    expect(tiesFor(accepted('court'))).toEqual([
      { agentId: A, personId: B, kind: 'attraction', text: 'you walked out together' },
      { agentId: B, personId: A, kind: 'attraction', text: 'you walked out together' },
    ])
  })

  it('a partnership is kin, in the words a persona’s own kin is written in', () => {
    expect(tiesFor(accepted('propose')).map((t) => t.text)).toEqual([
      'your partner',
      'your partner',
    ])
    expect(tiesFor(accepted('propose')).map((t) => t.kind)).toEqual(['kin', 'kin'])
  })

  it('a bedding is a secret, unless the two of them already belong to each other', () => {
    expect(tiesFor(accepted('lie_with'), { roof: 'house' })[0]?.text).toBe(
      'what happened between you under the house',
    )
    expect(tiesFor(accepted('lie_with'), { roof: null })[0]?.text).toBe(
      'what happened between you under one roof',
    )
    expect(tiesFor(accepted('lie_with'), { partnered: true })).toEqual([])
  })

  it('a no is a slight only where somebody heard it', () => {
    const refused = (witnesses: string[]): RelationshipFact => ({
      type: 'invitation_refused',
      agentId: A,
      byId: B,
      verb: 'court',
      witnesses,
    })
    expect(tiesFor(refused([]))).toEqual([])
    expect(tiesFor(refused(['salma']))).toEqual([
      { agentId: B, personId: A, kind: 'slight', text: 'turned you down in front of other people' },
    ])
  })

  it('a leaving settles the kin both ways and opens the grudge on the one left', () => {
    const deltas = tiesFor({ type: 'partnership_dissolved', aId: A, bId: B, byId: B })
    expect(deltas.filter((d) => d.settled === true).map((d) => d.agentId)).toEqual([A, B])
    expect(deltas.find((d) => d.kind === 'grudge')).toEqual({
      agentId: A,
      personId: B,
      kind: 'grudge',
      text: 'left you',
    })
  })

  it('an ask, an acceptance nobody consummated, and a birth leave no tie at all', () => {
    expect(tiesFor({ type: 'invited', agentId: A, byId: B, verb: 'propose' })).toEqual([])
    expect(tiesFor({ type: 'partnership_formed', aId: A, bId: B })).toEqual([])
    expect(tiesFor({ type: 'agent_born', motherId: A, fatherId: B })).toEqual([])
  })
})

describe('what each of them carries away', () => {
  it('writes the asker their own ask, in the words of the thing asked', () => {
    expect(
      memoryLinesFor({ type: 'invited', agentId: A, byId: B, verb: 'propose' }, nameOf),
    ).toEqual([{ agentId: B, text: 'You asked Nadia to be partners for good.', importance: 7 }])
  })

  it('writes a partnership and a leaving into both books, from either side', () => {
    expect(memoryLinesFor({ type: 'partnership_formed', aId: A, bId: B }, nameOf)).toEqual([
      { agentId: A, text: 'You and Omar are partners now.', importance: 9 },
      { agentId: B, text: 'You and Nadia are partners now.', importance: 9 },
    ])
    expect(
      memoryLinesFor({ type: 'partnership_dissolved', aId: A, bId: B, byId: B }, nameOf),
    ).toEqual([
      { agentId: B, text: 'You left Nadia.', importance: 9 },
      { agentId: A, text: 'Omar has left you.', importance: 9 },
    ])
  })

  it('names nobody by their mark, in any line it writes', () => {
    const facts: RelationshipFact[] = [
      { type: 'invited', agentId: A, byId: B, verb: 'court' },
      { type: 'invitation_refused', agentId: A, byId: B, verb: 'court', witnesses: ['salma'] },
      { type: 'partnership_formed', aId: A, bId: B },
      { type: 'partnership_dissolved', aId: A, bId: B, byId: A },
    ]
    for (const line of facts.flatMap((f) => memoryLinesFor(f, nameOf))) {
      expect(line.text, line.text).not.toMatch(/\b(nadia|omar)\b/)
    }
    expect(noAnswerLine('Omar')).toBe('Omar gave you no answer.')
    expect(momentPassedLine('not close enough to ask')).toBe(
      'The moment passed: not close enough to ask.',
    )
  })
})
