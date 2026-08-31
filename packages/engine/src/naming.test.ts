import { describe, expect, it } from 'vitest'
import { nameShaped, nameTravels, renames } from './naming.js'

describe('★ what reads as the name of a building', () => {
  it.each([
    'the old farmhouse',
    'House of Brilliant Things!',
    'Mill',
    "Amara's Rest",
    'One Two Three Four Five',
  ])('%s is a name', (text) => {
    expect(nameShaped(text)).toBe(true)
  })

  it.each([
    ['I miss the sea', 'says what one person felt'],
    ["I'm cold", 'the apostrophe hides nothing'],
    ['this roof kept us dry all winter', 'a sentence, and about us'],
    ['One Two Three Four Five Six', 'past five words'],
    ['   ', 'nothing at all'],
  ])('%s is not a name — %s', (text) => {
    expect(nameShaped(text)).toBe(false)
  })

  // Every first-person word, whatever punctuation it is wearing.
  it.each(['i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours'])(
    'never a name with %s in it',
    (word) => {
      expect(nameShaped(`The ${word} Place`)).toBe(false)
      expect(nameShaped(`(${word.toUpperCase()}) Hall`)).toBe(false)
    },
  )
})

describe('★ which names travel on the air', () => {
  it.each(['Mill', 'the well', 'the old farmhouse', "Yusuf's house"])(
    '%s can be passed to somebody who was never there',
    (name) => {
      expect(nameTravels(name)).toBe(true)
    },
  )

  it.each([
    ['hut', 'three letters is a mark, not a word'],
    ['the', 'names nothing on its own'],
    ['a', 'names nothing on its own'],
    ['have', 'four letters and still names nothing'],
    ['  IT  ', 'however it is cased or spaced'],
  ])('%s does not travel — %s', (name) => {
    expect(nameTravels(name)).toBe(false)
  })

  // The floor is on the air, never on the stone: a wall goes on saying what it says.
  it('is a rule about hearing, and says nothing about what may be carved', () => {
    expect(nameShaped('hut')).toBe(true)
    expect(nameTravels('hut')).toBe(false)
  })
})

describe('★ whose wall a name may be cut into', () => {
  const raisedBy = (builtBy: string | null) => ({ builtBy })

  it('the hand that raised it, with words that read as a name', () => {
    expect(renames(raisedBy('a1'), 'House of Brilliant Things!', 'a1')).toBe(true)
  })

  it('never another hand, however good the words', () => {
    expect(renames(raisedBy('a2'), 'House of Brilliant Things!', 'a1')).toBe(false)
  })

  it('never a building nobody raised', () => {
    expect(renames(raisedBy(null), 'Mill', 'a1')).toBe(false)
  })

  // The founding names hold because no mind's id is the genesis builder's — not because a
  // second rule protects them.
  it('never the founding eleven, whose builder no mind can be', () => {
    expect(renames(raisedBy('genesis'), 'Amara Was Here', 'amara')).toBe(false)
  })
})
