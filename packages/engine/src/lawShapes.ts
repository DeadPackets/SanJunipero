import { z } from 'zod'

// The contract half of a social law: the shapes alone, with no reader of the world. A law is a
// field of the state and the state cannot import the judge that reads it, so the two live apart.

// A law rides in every prompt from the day it passes, so it is capped where a mind's speech is:
// long enough for a sentence somebody said out loud, short enough that eight of them are cheap.
export const LAW_TEXT_MAX = 120
export const LAWS_SHOWN = 8

// The five shapes the world can hold a town to. Everything else the town agrees on is `none`:
// remembered in words, quoted back in every prompt, and enforced by nobody but the neighbours.
export const LawPredicateSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('forbid'),
      verb: z.string().min(1),
      when: z.enum(['night', 'day']).optional(),
      where: z.enum(['square', 'house', 'field']).optional(),
      whose: z.literal('other').optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('require_before'),
      verb: z.string().min(1),
      before: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('common'),
      itemKind: z.string().min(1),
      structureId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('tithe'),
      itemKind: z.string().min(1),
      qty: z.number().int().min(1).max(20),
      to: z.string().min(1),
      every: z.enum(['day', 'week']),
    })
    .strict(),
  z.object({ kind: z.literal('none') }).strict(),
])
export type LawPredicate = z.infer<typeof LawPredicateSchema>

export type Law = {
  id: string
  ordinal: number
  text: string
  predicate: LawPredicate
  proposedBy: string
  ratifiedTick: number
  votes: { for: string[]; against: string[] }
  repealedTick: number | null
  why: string
}
