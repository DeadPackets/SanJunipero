import { describe, expect, it } from 'vitest'
import { scanRulingForGlassLeak } from './glassScan.js'
import { SceneKind } from './protocol.js'
import {
  castWords,
  LEXICON,
  LEXICON_CAP_PER_LINE,
  lexiconHits,
  STAKE_TERMS,
  STAKES_BY_KIND,
  WHY_NAMES_MAX,
  WHY_PHRASE,
  whyOf,
} from './stakes.js'

describe('the words people say when something is at stake', () => {
  it('counts each of them, whole words only', () => {
    for (const word of LEXICON) expect(lexiconHits(`I ${word} it.`), word).toBe(1)
    expect(lexiconHits('Mineral water, however sorrowful.'), 'not "mine", not "sorry"').toBe(0)
    expect(lexiconHits('Never. Never. I swear it.')).toBe(3)
  })

  it('reads one line as one line, however often it says the word', () => {
    expect(lexiconHits('never never never never never never')).toBe(LEXICON_CAP_PER_LINE)
  })

  it('says nothing about a line with nothing at stake in it', () => {
    expect(lexiconHits('Two sacks by the door, then.')).toBe(0)
  })
})

describe('what the camera is allowed to say', () => {
  it('weighs every kind of scene the frame knows', () => {
    for (const kind of SceneKind.options) expect(STAKES_BY_KIND[kind], kind).toBeGreaterThan(0)
  })

  it('gives every term one phrase and no ops word', () => {
    expect(Object.keys(WHY_PHRASE).sort()).toEqual([...STAKE_TERMS].sort())
    for (const term of STAKE_TERMS) {
      expect(WHY_PHRASE[term], term).not.toContain('_')
      expect(scanRulingForGlassLeak(WHY_PHRASE[term]), term).toEqual([])
    }
  })

  it('names one, two and a crowd the way a reader would', () => {
    expect(castWords(['Nadia'])).toBe('Nadia')
    expect(castWords(['Nadia', 'Yusuf'])).toBe('Nadia & Yusuf')
    expect(castWords(['Nadia', 'Yusuf', 'Omar'])).toBe('Nadia, Yusuf & Omar')
    const crowd = ['Nadia', 'Yusuf', 'Omar', 'Salma', 'Bashir']
    expect(castWords(crowd).split(/,| &/)).toHaveLength(WHY_NAMES_MAX)
    expect(castWords([])).toBe('')
  })

  it('writes the caption as who, then why, and says only who when there is no why', () => {
    expect(whyOf('Nadia & Yusuf', ['quarrel', 'slight'])).toBe(
      'Nadia & Yusuf — falling out, a slight',
    )
    expect(whyOf('Omar', [])).toBe('Omar')
  })
})
