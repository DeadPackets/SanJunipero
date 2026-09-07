import { describe, expect, it } from 'vitest'
import { pastParticiple, verbPhraseGerund, verbPhrasePast } from './verbs.js'

describe('pastParticiple', () => {
  it('knows the irregulars and builds the rest', () => {
    expect(pastParticiple('build')).toBe('built')
    expect(pastParticiple('weave')).toBe('woven')
    expect(pastParticiple('chop')).toBe('chopped')
    expect(pastParticiple('craft')).toBe('crafted')
  })

  // ★ A minted verb id is only `/^[a-z][a-z0-9_]{1,40}$/`, so the court can coin one of these,
  // and the table is a plain object: the lookup used to hand back a function.
  it('★ treats a name every plain object answers to as an ordinary word', () => {
    for (const slug of ['constructor', 'tostring', 'valueof', 'hasownproperty']) {
      expect(typeof pastParticiple(slug), slug).toBe('string')
      expect(pastParticiple(slug), slug).toBe(`${slug}ed`)
    }
    expect(verbPhrasePast('constructor_gate')).toBe('constructored gate')
  })
})

describe('the present participle', () => {
  it('says lying, not lieing — the act two bodies are in the middle of', () => {
    expect(verbPhraseGerund('lie_with')).toBe('lying with')
    // r40 day 0: the chip on Tariq read "Making make tally board".
    expect(verbPhraseGerund('recipe:make_tally_board')).toBe('making tally board')
    expect(verbPhrasePast('recipe:make_tally_board')).toBe('made tally board')
    expect(verbPhraseGerund('recipe:plank')).toBe('making plank')
    expect(verbPhrasePast('lie_with')).toBe('lain with')
    expect(verbPhraseGerund('leave_partner')).toBe('leaving partner')
  })
})
