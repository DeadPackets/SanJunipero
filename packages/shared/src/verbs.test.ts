import { describe, expect, it } from 'vitest'
import { pastParticiple, verbPhrasePast } from './verbs.js'

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
