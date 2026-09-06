import { describe, expect, it } from 'vitest'
import type { Bond } from '@sj/shared'
import { EMPTY_LINEAGE } from '../bondModel2.js'
import { strongestPairs, strongestTie } from './tieLine.js'

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
