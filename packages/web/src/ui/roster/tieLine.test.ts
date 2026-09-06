import { describe, expect, it } from 'vitest'
import type { Bond } from '@sj/shared'
import { strongestTie } from './tieLine.js'

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
