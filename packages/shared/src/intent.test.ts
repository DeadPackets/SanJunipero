import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CLOSED_KEYS,
  ClosedIntentParams,
  Intent,
  NO_PARAMS,
  namedParams,
  ownSkillWords,
  skillWord,
  topSkillWord,
} from './intent.js'

const allNull = (): Record<string, unknown> => Object.fromEntries(CLOSED_KEYS.map((k) => [k, null]))

describe('ClosedIntentParams', () => {
  it('is exactly the thirteen keys the grammar names, in that order', () => {
    expect(Object.keys(ClosedIntentParams.shape)).toEqual([...CLOSED_KEYS])
    expect(CLOSED_KEYS).toHaveLength(13)
  })

  it('asks for every key and takes no other', () => {
    expect(ClosedIntentParams.parse(NO_PARAMS)).toEqual(allNull())
    for (const key of CLOSED_KEYS) {
      const { [key]: _left, ...missing } = allNull()
      expect(ClosedIntentParams.safeParse(missing).success, key).toBe(false)
    }
    expect(ClosedIntentParams.safeParse({ ...allNull(), whittledFrom: 'ash' }).success).toBe(false)
  })

  it('takes a number where the act names a place and a non-empty word everywhere else', () => {
    expect(ClosedIntentParams.safeParse({ ...allNull(), x: 4, y: 9 }).success).toBe(true)
    expect(ClosedIntentParams.safeParse({ ...allNull(), itemId: '' }).success).toBe(false)
    expect(ClosedIntentParams.safeParse({ ...allNull(), x: 'far' }).success).toBe(false)
  })

  it('emits a grammar every key of which is required, with no default and no propertyNames', () => {
    // The ai SDK converts at `io: 'input'`, so a `.default()` anywhere here would drop that key
    // out of `required` and hand a strict decoder the open object this shape exists to replace.
    for (const io of ['input', 'output'] as const) {
      const emitted = z.toJSONSchema(ClosedIntentParams, { io }) as {
        required: string[]
        additionalProperties: boolean
      }
      expect(emitted.required, io).toEqual([...CLOSED_KEYS])
      expect(emitted.additionalProperties, io).toBe(false)
      expect(JSON.stringify(emitted), io).not.toContain('propertyNames')
      expect(JSON.stringify(emitted), io).not.toContain('"default"')
    }
  })
})

describe('Intent', () => {
  it('takes any verb and only the closed params', () => {
    const minted = Intent.parse({ verb: 'recipe:smoke_fish', params: allNull() })
    expect(minted.verb).toBe('recipe:smoke_fish')
    expect(minted.params.itemId).toBeNull()
    expect(Intent.safeParse({ verb: '', params: allNull() }).success).toBe(false)
    expect(Intent.safeParse({ verb: 'walk', params: {} }).success).toBe(false)
    expect(Intent.safeParse({ verb: 'walk', params: allNull(), aside: 'x' }).success).toBe(false)
  })
})

describe('skill buckets', () => {
  it('says nothing under three, then turns over at three, eight and twenty', () => {
    expect(skillWord('fishing', 0)).toBeNull()
    expect(skillWord('fishing', 2)).toBeNull()
    expect(skillWord('fishing', 3)).toBe('has taken up fishing')
    expect(skillWord('fishing', 7)).toBe('has taken up fishing')
    expect(skillWord('fishing', 8)).toBe('is handy at fishing')
    expect(skillWord('fishing', 19)).toBe('is handy at fishing')
    expect(skillWord('fishing', 20)).toBe('is known for fishing')
    expect(skillWord('carpentry', 400)).toBe('is known for carpentry')
  })

  it('names the most worked track first, and breaks a tie on the track word', () => {
    expect(topSkillWord({ farming: 4, fishing: 30 })).toBe('is known for fishing')
    expect(topSkillWord({ masonry: 9, carpentry: 9 })).toBe('is handy at carpentry')
    expect(topSkillWord({ farming: 2 })).toBeNull()
    expect(topSkillWord({})).toBeNull()
  })

  it('says the same buckets back to the hands they belong to', () => {
    expect(ownSkillWords({ fishing: 22, farming: 3, medicine: 1 })).toEqual([
      'fishing you are known for',
      'farming you have taken up',
    ])
    expect(ownSkillWords({ masonry: 10 })).toEqual(['masonry you are handy at'])
    expect(ownSkillWords({})).toEqual([])
  })
})

describe('namedParams', () => {
  it('keeps what the act named and drops the keys it never asked for', () => {
    expect(namedParams({ ...allNull(), itemId: 'i1', targetId: 'omar' })).toEqual({
      itemId: 'i1',
      targetId: 'omar',
    })
    expect(namedParams(allNull())).toEqual({})
    expect(namedParams({ ...allNull(), x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
  })
})
