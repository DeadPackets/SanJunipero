import { describe, expect, it } from 'vitest'
import type { Bond } from '@sj/shared'
import { EMPTY_LINEAGE } from '../bondModel2.js'
import { familyLine, strongestPairs, strongestTie } from './tieLine.js'

const NOW = 5000
const NAMES: Record<string, string> = { amara: 'Amara', kamal: 'Kamal', tariq: 'Tariq' }
const nameOf = (id: string): string => NAMES[id] ?? id

const bond = (aId: string, bId: string, warmth: number, priorWarmth = warmth): Bond => ({
  id: `${aId}|${bId}`,
  aId,
  bId,
  kind: 'friend',
  strength: 4,
  formedTick: 0,
  lastUpdatedTick: NOW,
  recent: [],
  acts: [],
  warmth,
  priorWarmth,
  levelChangedTick: 0,
})

describe('what the Bonds page says first', () => {
  const PEOPLE = {
    amara: { name: 'Amara', alive: true },
    kamal: { name: 'Kamal', alive: true },
    tariq: { name: 'Tariq', alive: true },
  }

  it('names the pairs with the most feeling, cold or warm, as sentences, and skips strangers', () => {
    const bonds = {
      bonds: [bond('amara', 'kamal', 25), bond('amara', 'tariq', -30), bond('kamal', 'tariq', 1)],
      asOfTick: NOW,
    }
    expect(strongestPairs(bonds, EMPTY_LINEAGE, PEOPLE, NOW).map((p) => p.words)).toEqual([
      'Amara and Tariq are set against each other.',
      'Amara and Kamal are close.',
    ])
  })

  it('holds to the count it was asked for, and says nothing of people the roster does not know', () => {
    const bonds = {
      bonds: [bond('amara', 'kamal', 25), bond('amara', 'ghost', 40), bond('kamal', 'tariq', 9)],
      asOfTick: NOW,
    }
    expect(strongestPairs(bonds, EMPTY_LINEAGE, PEOPLE, NOW, 1).map((p) => p.id)).toEqual([
      'amara|kamal',
    ])
  })

  // r40 day 0: the town held two marriages and two children, and this page said nobody here was
  // more than a stranger to anybody, because a founding family has no acts behind it.
  it('★ says the families the world holds, on a morning where nobody has done anything yet', () => {
    const people = { ...PEOPLE, leyla: { name: 'Leyla', alive: true } }
    const kin = {
      parentOf: [{ parentId: 'kamal', childId: 'tariq', tick: 1 }],
      partnerOf: [{ aId: 'kamal', bId: 'leyla' }],
    }
    const said = strongestPairs({ bonds: [], asOfTick: NOW }, kin, people, NOW).map((p) => p.words)
    expect(said.sort()).toEqual(['Kamal and Leyla are partners.', 'Kamal is Tariq’s parent.'])
    expect(said.join(' ')).not.toContain('stranger')
  })

  it('a warm pair still outranks a family nobody has spoken to yet', () => {
    const kin = { parentOf: [], partnerOf: [{ aId: 'kamal', bId: 'tariq' }] }
    expect(
      strongestPairs({ bonds: [bond('amara', 'kamal', 30)], asOfTick: NOW }, kin, PEOPLE, NOW).map(
        (p) => p.words,
      ),
    ).toEqual(['Amara and Kamal are close.', 'Kamal and Tariq are partners.'])
  })
})

describe('the one tie a roster row has room for', () => {
  it('names the strongest feeling, warm or cold, in the words of the Bonds key', () => {
    const bonds = {
      bonds: [bond('amara', 'kamal', 25), bond('amara', 'tariq', -30)],
      asOfTick: NOW,
    }
    expect(strongestTie('amara', bonds, NOW, nameOf)).toBe('set against Tariq')
    expect(strongestTie('kamal', bonds, NOW, nameOf)).toBe('close to Amara')
  })

  it('says which way it is going when the level has moved', () => {
    const bonds = { bonds: [bond('amara', 'kamal', 25, 5)], asOfTick: NOW }
    expect(strongestTie('amara', bonds, NOW, nameOf)).toBe('close to Kamal, and warming')
  })

  it('says nothing while every tie is still small, and nothing with no ties read yet', () => {
    expect(
      strongestTie('amara', { bonds: [bond('amara', 'kamal', 5)], asOfTick: NOW }, NOW, nameOf),
    ).toBe(null)
    expect(strongestTie('amara', null, NOW, nameOf)).toBe(null)
    expect(
      strongestTie('tariq', { bonds: [bond('amara', 'kamal', 25)], asOfTick: NOW }, NOW, nameOf),
    ).toBe(null)
  })
})

describe('★ familyLine — who a person is to their own family', () => {
  const name = (id: string) => id[0]!.toUpperCase() + id.slice(1)
  const lineage = {
    parentOf: [
      { parentId: 'leyla', childId: 'tariq', tick: 1 },
      { parentId: 'kamal', childId: 'tariq', tick: 1 },
      { parentId: 'halim', childId: 'dilara', tick: 1 },
    ],
    partnerOf: [{ aId: 'kamal', bId: 'leyla' }],
  }

  it('names the marriage, the parents and the children, in that order', () => {
    expect(familyLine('kamal', lineage, name)).toBe('Married to Leyla. Parent to Tariq.')
    expect(familyLine('leyla', lineage, name)).toBe('Married to Kamal. Parent to Tariq.')
    expect(familyLine('tariq', lineage, name)).toBe('Child of Leyla and Kamal.')
    expect(familyLine('halim', lineage, name)).toBe('Parent to Dilara.')
    expect(familyLine('dilara', lineage, name)).toBe('Child of Halim.')
  })

  it('says nothing about somebody with no family, and reads a feed that has no marriages', () => {
    expect(familyLine('amara', lineage, name)).toBeNull()
    expect(familyLine('kamal', { parentOf: lineage.parentOf }, name)).toBe('Parent to Tariq.')
    expect(familyLine('amara', { parentOf: [] }, name)).toBeNull()
  })
})
