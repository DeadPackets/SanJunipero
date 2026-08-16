import { z } from 'zod'

export const BOND_KINDS = ['partner', 'kin', 'friend', 'rival', 'owe', 'work'] as const
export const BondKindSchema = z.enum(BOND_KINDS)
export type BondKind = z.infer<typeof BondKindSchema>

export const BondEventSchema = z.object({
  tick: z.number().int().nonnegative(),
  kind: z.string().min(1),
  note: z.string().min(1),
}).strict()
export type BondEvent = z.infer<typeof BondEventSchema>

export const BondSchema = z.object({
  id: z.string().min(1),                       // bondId(a, b) — the same name from either side
  aId: z.string().min(1),
  bId: z.string().min(1),
  kind: BondKindSchema,
  strength: z.number().min(0),
  formedTick: z.number().int().nonnegative(),
  lastUpdatedTick: z.number().int().nonnegative(),
  history: z.array(BondEventSchema),
}).strict()
export type Bond = z.infer<typeof BondSchema>

export const BondsResponseSchema = z.object({
  bonds: z.array(BondSchema),
  asOfTick: z.number().int().nonnegative(),
}).strict()
export type BondsResponse = z.infer<typeof BondsResponseSchema>

export function bondId(a: string, b: string): string {
  return [a, b].sort().join('|')
}

// One bond per pair, so its kind has to be decided when two people are several things at
// once. Closest claim wins and the history keeps everything: a couple who also traded are
// still a couple, and a fight outranks a shift worked side by side.
export const BOND_KIND_PRECEDENCE: readonly BondKind[] = ['partner', 'kin', 'rival', 'owe', 'work', 'friend']

export function strongerBondKind(a: BondKind, b: BondKind): BondKind {
  return BOND_KIND_PRECEDENCE.indexOf(a) <= BOND_KIND_PRECEDENCE.indexOf(b) ? a : b
}
