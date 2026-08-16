import { describe, expect, it } from 'vitest'
import { MomentSchema, MomentsResponseSchema, type Moment } from './moments.js'

const moment: Moment = {
  id: 7, day: 2, startTick: 2880, endTick: 2940,
  title: 'What the Fire Took', cast: ['alice', 'bob'], location: 'the plaza',
}

describe('MomentSchema', () => {
  it('round-trips a recorded day', () => {
    expect(MomentSchema.parse(moment)).toEqual(moment)
  })

  it('accepts a scene nobody was named in, in no particular place', () => {
    expect(MomentSchema.parse({ ...moment, cast: [], location: null }).location).toBeNull()
  })

  it('refuses a negative tick, a nameless scene, a stray field and a zero id', () => {
    expect(MomentSchema.safeParse({ ...moment, startTick: -1 }).success).toBe(false)
    expect(MomentSchema.safeParse({ ...moment, endTick: -1 }).success).toBe(false)
    expect(MomentSchema.safeParse({ ...moment, title: '' }).success).toBe(false)
    expect(MomentSchema.safeParse({ ...moment, extra: 1 }).success).toBe(false)
    expect(MomentSchema.safeParse({ ...moment, id: 0 }).success).toBe(false)
  })

  it('refuses a nameless member of the cast', () => {
    expect(MomentSchema.safeParse({ ...moment, cast: [''] }).success).toBe(false)
  })
})

describe('MomentsResponseSchema', () => {
  it('carries the recorded days, and an unnarrated town carries none', () => {
    expect(MomentsResponseSchema.parse({ moments: [moment] }).moments).toHaveLength(1)
    expect(MomentsResponseSchema.parse({ moments: [] }).moments).toEqual([])
  })

  it('refuses a stray field', () => {
    expect(MomentsResponseSchema.safeParse({ moments: [], extra: 1 }).success).toBe(false)
  })
})
