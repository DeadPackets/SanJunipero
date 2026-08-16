import { describe, expect, it, vi } from 'vitest'
import { MINUTES_PER_DAY } from '@sj/shared'
import type { z } from 'zod'
import { FALLBACK_TURN, IntentSchema, TurnSchema, parseTurnWithRepair, reconsiderTick } from './turn.js'
import { FORBIDDEN_FRAMING } from './prompt/rulesOfBeing.js'

const validTurn = {
  thought: 'The well is low; I should fetch water before noon.',
  speech: 'Morning, Edda.',
  action: { verb: 'walk_to', params: { x: 4, y: 9 } },
  plan: [{ verb: 'draw_water', params: {} }],
  journal: 'Dry week. The garden worries me.',
  importance: 6,
  reconsider_at: '14:30',
}

describe('TurnSchema', () => {
  it('parses a valid turn', () => {
    const parsed = TurnSchema.parse(validTurn)
    expect(parsed.thought).toBe(validTurn.thought)
    expect(parsed.importance).toBe(6)
    expect(parsed.reconsider_at).toBe('14:30')
  })

  it('rejects extra key mood via strict', () => {
    expect(TurnSchema.safeParse({ ...validTurn, mood: 'sunny' }).success).toBe(false)
  })

  it('rejects importance 0 and 11', () => {
    expect(TurnSchema.safeParse({ ...validTurn, importance: 0 }).success).toBe(false)
    expect(TurnSchema.safeParse({ ...validTurn, importance: 11 }).success).toBe(false)
  })

  it('rejects bad reconsider_at clock strings', () => {
    expect(TurnSchema.safeParse({ ...validTurn, reconsider_at: '24:00' }).success).toBe(false)
    expect(TurnSchema.safeParse({ ...validTurn, reconsider_at: '9:30' }).success).toBe(false)
  })

  it('accepts freeform action and defaults intent params', () => {
    const t = TurnSchema.parse({ thought: 'hm', importance: 1, action: { freeform: 'whittle a spoon' } })
    expect(t.action).toEqual({ freeform: 'whittle a spoon' })
    expect(IntentSchema.parse({ verb: 'sit' }).params).toEqual({})
  })

  it('FALLBACK_TURN satisfies the schema', () => {
    expect(TurnSchema.parse(FALLBACK_TURN)).toEqual(FALLBACK_TURN)
  })

  it('every field carries a diegetic description the mind can learn from (finding 8)', () => {
    const shape = TurnSchema.shape
    for (const key of Object.keys(shape) as Array<keyof typeof shape>) {
      const desc = (shape[key] as z.ZodType).description
      expect(desc, String(key)).toBeTruthy()
      expect(desc).not.toMatch(FORBIDDEN_FRAMING)
    }
    expect((shape.reconsider_at as z.ZodType).description).toMatch(/\d{2}:\d{2}/)
  })
})

describe('parseTurnWithRepair', () => {
  it('returns parsed turn without calling repair when raw is valid', async () => {
    const repair = vi.fn()
    const alert = vi.fn()
    const turn = await parseTurnWithRepair(validTurn, repair, alert)
    expect(turn.thought).toBe(validTurn.thought)
    expect(repair).not.toHaveBeenCalled()
    expect(alert).not.toHaveBeenCalled()
  })

  it('uses the repaired object when repair fixes the turn', async () => {
    const repair = vi.fn(async (issues: string) => {
      expect(issues).toContain('thought')
      return validTurn
    })
    const alert = vi.fn()
    const turn = await parseTurnWithRepair({ importance: 3 }, repair, alert)
    expect(turn).toEqual(TurnSchema.parse(validTurn))
    expect(repair).toHaveBeenCalledTimes(1)
    expect(alert).not.toHaveBeenCalled()
  })

  it('falls back after a failed repair and alerts exactly once with issue text', async () => {
    const repair = vi.fn(async () => ({ importance: 99 }))
    const alert = vi.fn()
    const turn = await parseTurnWithRepair({ mood: 'broken' }, repair, alert)
    expect(turn).toEqual(FALLBACK_TURN)
    expect(repair).toHaveBeenCalledTimes(1)
    expect(alert).toHaveBeenCalledTimes(1)
    const detail = alert.mock.calls[0]![0] as string
    expect(detail).toContain('importance')
  })
})

describe('reconsiderTick', () => {
  it('returns today when the time is still ahead', () => {
    expect(reconsiderTick(MINUTES_PER_DAY * 3 + 10 * 60, '14:30')).toBe(MINUTES_PER_DAY * 3 + 14 * 60 + 30)
  })

  it('rolls to the same time next day when already past', () => {
    expect(reconsiderTick(MINUTES_PER_DAY * 3 + 15 * 60, '14:30')).toBe(MINUTES_PER_DAY * 4 + 14 * 60 + 30)
  })

  it('is strictly future when now equals the target', () => {
    expect(reconsiderTick(MINUTES_PER_DAY * 3 + 14 * 60 + 30, '14:30')).toBe(MINUTES_PER_DAY * 4 + 14 * 60 + 30)
  })
})
