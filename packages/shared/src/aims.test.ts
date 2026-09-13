import { describe, expect, it } from 'vitest'
import { AimSchema, aimOfDoc } from './aims.js'

const doc = (current: unknown): string => JSON.stringify({ current })

describe('what a mind is about, said outward', () => {
  it('carries every line the document holds, not only the first', () => {
    expect(
      aimOfDoc(
        doc({
          mood: 'wary',
          goals: ['keep the fire in', 'owe Bob a loaf'],
          worries: ['the roof', 'the well'],
        }),
      ),
    ).toEqual({
      mood: 'wary',
      goal: 'keep the fire in',
      worry: 'the roof',
      goals: ['keep the fire in', 'owe Bob a loaf'],
      worries: ['the roof', 'the well'],
    })
  })

  it('keeps the one line a reader that wants one line already reads', () => {
    const aim = aimOfDoc(
      doc({ mood: ' glad ', goals: ['   ', 'plant the south field'], worries: [] }),
    )
    expect(aim.goal).toBe('plant the south field')
    expect(aim.mood).toBe('glad')
    expect(aim.worry).toBeNull()
    expect(aim.worries).toEqual([])
  })

  it('reads a document that is not one of ours as nothing at all', () => {
    for (const bad of ['a prose card', '{}', '{"current":null}'])
      expect(aimOfDoc(bad)).toEqual({ mood: null, goal: null, worry: null, goals: [], worries: [] })
  })

  it('takes an older answer that has no lists, so an older gateway still parses', () => {
    const parsed = AimSchema.parse({
      agentId: 'alice',
      mood: null,
      goal: null,
      worry: null,
      day: 3,
    })
    expect(parsed.goals).toEqual([])
    expect(parsed.worries).toEqual([])
  })
})
