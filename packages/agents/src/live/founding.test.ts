import { describe, expect, it } from 'vitest'
import { FOUNDER_IDS, founderSex, foundingIds } from '@sj/shared'
import { FOUNDER_MINDS } from './founderMinds.js'

// Whose name shows up anywhere in somebody else's card: backstory, voice, worries, sayings.
const NAMED_IN = new Map(
  FOUNDER_MINDS.map((m) => {
    const text = JSON.stringify(m)
    return [
      m.id,
      FOUNDER_MINDS.filter(
        (o) => o.id !== m.id && new RegExp(`\\b${o.identity.name}\\b`).test(text),
      ).map((o) => o.id),
    ] as const
  }),
)

describe('★ a founding is taken a whole household at a time', () => {
  // The cards name each other. A founding cut through a marriage leaves somebody speaking about
  // a person the valley does not have, which is the invented-relationship fault, seeded by us.
  it('★ leaves nobody talking about a person who is not in the valley, at any size', () => {
    for (let n = 1; n <= FOUNDER_IDS.length; n++) {
      const here = new Set<string>(foundingIds(n))
      expect([n, here.size > 0]).toEqual([n, true])
      for (const id of here)
        for (const other of NAMED_IN.get(id) ?? [])
          expect([n, id, other, here.has(other)]).toEqual([n, id, other, true])
    }
  })

  it('grows by whole groups and never shrinks as the number asked for goes up', () => {
    let last = 0
    for (let n = 1; n <= FOUNDER_IDS.length; n++) {
      const size = foundingIds(n).length
      expect([n, size <= Math.max(n, 3)]).toEqual([n, true])
      expect([n, size >= last]).toEqual([n, true])
      last = size
    }
    expect(foundingIds(FOUNDER_IDS.length).length).toBe(FOUNDER_IDS.length)
    expect([...foundingIds(6)]).toEqual(['yusuf', 'nadia', 'omar', 'salma', 'farida', 'bashir'])
  })

  // A body folded without this field reads as 'f' everywhere the world asks, so no pair could
  // ever conceive and every man's invention was told to the town as something "she" did.
  it('★ gives every founder the sex its own card declares', () => {
    for (const m of FOUNDER_MINDS) expect([m.id, founderSex(m.id)]).toEqual([m.id, m.sex])
  })
})
