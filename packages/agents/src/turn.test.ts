import { describe, expect, it, vi } from 'vitest'
import { dayPhaseFromTick, FORBIDDEN_FRAMING, MINUTES_PER_DAY } from '@sj/shared'
import { z } from 'zod'
import * as engine from '@sj/engine'
import { IntentParamsSchema } from '@sj/engine/verbs'
import {
  FALLBACK_TURN,
  IntentSchema,
  TurnSchema,
  parseTurnWithRepair,
  reconsiderTick,
} from './turn.js'

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
    const t = TurnSchema.parse({
      thought: 'hm',
      importance: 1,
      action: { freeform: 'whittle a spoon' },
    })
    expect(t.action).toEqual({ freeform: 'whittle a spoon' })
    expect(IntentSchema.parse({ verb: 'sit' }).params).toEqual({})
  })

  it('FALLBACK_TURN satisfies the schema', () => {
    expect(TurnSchema.parse(FALLBACK_TURN)).toEqual(FALLBACK_TURN)
  })

  it('keeps a complete turn that wrote null where it had nothing to say', () => {
    // A null in an optional field is the model saying "none", not a malformed answer — a strict
    // optional throws away a whole valid turn over it.
    for (const key of ['speech', 'action', 'plan', 'journal', 'reconsider_at'] as const) {
      const parsed = TurnSchema.safeParse({ ...validTurn, [key]: null })
      expect(parsed.success, key).toBe(true)
    }
  })

  it('a null optional field reads as absent, so nothing downstream acts on it', () => {
    const t = TurnSchema.parse({
      thought: 'nothing to add',
      importance: 2,
      speech: null,
      action: null,
      plan: null,
      journal: null,
      reconsider_at: null,
    })
    expect(t.speech ?? undefined).toBeUndefined()
    expect(t.action ?? undefined).toBeUndefined()
    expect(t.plan ?? undefined).toBeUndefined()
    expect(t.journal ?? undefined).toBeUndefined()
    expect(t.reconsider_at ?? undefined).toBeUndefined()
  })

  it('still names exactly two required fields, and no transform blocks the emitted grammar', () => {
    // A `.transform()` normalising null to absent cannot be used: `z.toJSONSchema(..., { io:
    // 'output' })` throws on one, and that is the direction an output schema is converted in.
    for (const io of ['input', 'output'] as const) {
      const emitted = z.toJSONSchema(TurnSchema, { io }) as { required: string[] }
      expect(emitted.required, io).toEqual(['thought', 'importance'])
    }
  })

  it('every field carries a diegetic description the mind can learn from (finding 8)', () => {
    const shape = TurnSchema.shape
    for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
      const desc = (shape[key] as z.ZodType).description
      expect(desc, key).toBeTruthy()
      expect(desc).not.toMatch(FORBIDDEN_FRAMING)
    }
    expect((shape.reconsider_at as z.ZodType).description).toMatch(/\d{2}:\d{2}/)
  })
})

// Every parameter shape a registered Tier-1 verb reads. `ExpressiveParams` is not reachable
// from here — @sj/arbiter depends on @sj/agents — so its single key is named below.
const enginePlaces = Object.entries(engine as Record<string, unknown>)
  .filter(([name]) => name.endsWith('Params'))
  .map(([name, schema]) => [name, Object.keys((schema as z.ZodObject).shape)] as const)

describe('IntentSchema.params emits a grammar a constrained decoder can compile', () => {
  it('names every parameter every registered verb reads', () => {
    expect(enginePlaces.length).toBeGreaterThan(20)
    const named = new Set(Object.keys(IntentParamsSchema.shape))
    for (const [verbSchema, keys] of enginePlaces) {
      for (const key of keys) expect(named, `${verbSchema}.${key}`).toContain(key)
    }
    // @sj/arbiter's ExpressiveParams, which a coined verb is validated against.
    expect(named).toContain('targetId')
  })

  it('carries no propertyNames key, in either direction', () => {
    for (const io of ['input', 'output'] as const) {
      const json = JSON.stringify(z.toJSONSchema(TurnSchema, { io, unrepresentable: 'any' }))
      expect(json, io).not.toContain('propertyNames')
    }
  })

  it('still carries a parameter nobody has written down yet, for a verb minted at runtime', () => {
    const parsed = IntentSchema.parse({ verb: 'recipe:spoon', params: { whittledFrom: 'ash' } })
    expect(parsed.params).toEqual({ whittledFrom: 'ash' })
  })

  it('keeps the params every real act passes', () => {
    expect(IntentSchema.parse({ verb: 'walk', params: { x: 62, y: 70 } }).params).toEqual({
      x: 62,
      y: 70,
    })
    expect(
      IntentSchema.parse({ verb: 'give', params: { itemId: 'i1', targetId: 'omar' } }).params,
    ).toEqual({ itemId: 'i1', targetId: 'omar' })
    expect(
      IntentSchema.parse({ verb: 'build', params: { kind: 'house', x: 1, y: 2 } }).params,
    ).toEqual({ kind: 'house', x: 1, y: 2 })
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

describe('reconsiderTick on an absolute day and phase', () => {
  const day = (n: number): number => MINUTES_PER_DAY * (n - 1)

  it('resolves a named day and phase to the exact tick that phase begins', () => {
    expect(reconsiderTick(day(11) + 9 * 60, { day: 12, phase: 'dusk' })).toBe(day(12) + 19 * 60)
    expect(reconsiderTick(day(11) + 9 * 60, { day: 12, phase: 'day' })).toBe(day(12) + 7 * 60)
    expect(reconsiderTick(day(11) + 9 * 60, { day: 12, phase: 'night' })).toBe(day(12) + 21 * 60)
  })

  it('every anchor it resolves to is genuinely that phase of the day', () => {
    for (const phase of ['day', 'dusk', 'night'] as const) {
      expect(dayPhaseFromTick(reconsiderTick(0, { day: 3, phase }))).toBe(phase)
    }
  })

  it('a day already gone becomes the next time that phase comes round', () => {
    expect(reconsiderTick(day(14) + 9 * 60, { day: 12, phase: 'dusk' })).toBe(day(14) + 19 * 60)
    expect(reconsiderTick(day(14) + 20 * 60, { day: 12, phase: 'dusk' })).toBe(day(15) + 19 * 60)
  })

  it('is strictly future when now is exactly the anchor', () => {
    expect(reconsiderTick(day(12) + 19 * 60, { day: 12, phase: 'dusk' })).toBe(day(13) + 19 * 60)
  })

  it('rides the turn schema, and the model is shown the words it must answer with', () => {
    const t = TurnSchema.parse({ ...validTurn, reconsider_at: { day: 12, phase: 'dusk' } })
    expect(t.reconsider_at).toEqual({ day: 12, phase: 'dusk' })
    expect(
      TurnSchema.safeParse({ ...validTurn, reconsider_at: { day: 12, phase: 'teatime' } }).success,
    ).toBe(false)
    expect(TurnSchema.safeParse({ ...validTurn, reconsider_at: { day: 12 } }).success).toBe(false)
    const desc = (TurnSchema.shape.reconsider_at as z.ZodType).description ?? ''
    for (const word of ['day', 'dusk', 'night']) expect(desc).toContain(word)
  })
})

describe('reconsiderTick', () => {
  it('returns today when the time is still ahead', () => {
    expect(reconsiderTick(MINUTES_PER_DAY * 3 + 10 * 60, '14:30')).toBe(
      MINUTES_PER_DAY * 3 + 14 * 60 + 30,
    )
  })

  it('rolls to the same time next day when already past', () => {
    expect(reconsiderTick(MINUTES_PER_DAY * 3 + 15 * 60, '14:30')).toBe(
      MINUTES_PER_DAY * 4 + 14 * 60 + 30,
    )
  })

  it('is strictly future when now equals the target', () => {
    expect(reconsiderTick(MINUTES_PER_DAY * 3 + 14 * 60 + 30, '14:30')).toBe(
      MINUTES_PER_DAY * 4 + 14 * 60 + 30,
    )
  })
})
