import { describe, expect, it } from 'vitest'
import {
  BOND_KINDS, BOND_KIND_PRECEDENCE, BOND_RECENT_ACTS, BondSchema, BondsResponseSchema, bondFrom,
  bondId, strongerBondKind, type Bond, type BondAct,
} from './bonds.js'

const bond: Bond = bondFrom('alice', 'bob', [
  { tick: 30, kind: 'partner' },
  { tick: 90, kind: 'partner' },
], 120)

describe('BondSchema', () => {
  it('round-trips a bond with its window and its rollup intact', () => {
    expect(BondSchema.parse(bond)).toEqual(bond)
    expect(bond.recent).toEqual([{ tick: 30, kind: 'partner' }, { tick: 90, kind: 'partner' }])
    expect(bond.acts).toEqual([{ kind: 'partner', count: 2, firstTick: 30, lastTick: 90 }])
  })

  it('accepts a bond that has not been touched since it formed', () => {
    expect(BondSchema.safeParse(bondFrom('alice', 'bob', [{ tick: 30, kind: 'partner' }], 120)).success)
      .toBe(true)
  })

  it('refuses a stray field, an unknown kind, a negative strength and an act with no kind', () => {
    expect(BondSchema.safeParse({ ...bond, extra: 1 }).success).toBe(false)
    expect(BondSchema.safeParse({ ...bond, kind: 'nemesis' }).success).toBe(false)
    expect(BondSchema.safeParse({ ...bond, strength: -1 }).success).toBe(false)
    expect(BondSchema.safeParse({ ...bond, recent: [{ tick: 1, kind: 'x' }] }).success).toBe(false)
    expect(BondSchema.safeParse({ ...bond, recent: [{ tick: 1, kind: 'friend', note: 'x' }] }).success).toBe(false)
  })

  // A history that grew with the town's age is how the feed reached 83.7 MB at sim-day 20; a
  // .max() on the window fails loudly on both ends of the wire.
  it('refuses a window longer than the ceiling, however many acts formed the bond', () => {
    const many: BondAct[] = Array.from({ length: 500 }, (_, i) => ({ tick: i, kind: 'friend' as const }))
    const big = bondFrom('alice', 'bob', many, 600)
    expect(big.strength).toBe(500)
    expect(big.recent).toHaveLength(BOND_RECENT_ACTS)
    expect(big.acts).toEqual([{ kind: 'friend', count: 500, firstTick: 0, lastTick: 499 }])
    expect(BondSchema.safeParse(big).success).toBe(true)
    expect(BondSchema.safeParse({ ...big, recent: many }).success).toBe(false)
  })
})

describe('BondsResponseSchema', () => {
  it('carries the tick the answer was true at', () => {
    const parsed = BondsResponseSchema.parse({ bonds: [bond], asOfTick: 120 })
    expect(parsed.asOfTick).toBe(120)
    expect(parsed.bonds).toHaveLength(1)
  })

  it('accepts a town that has tied no one to anyone yet', () => {
    expect(BondsResponseSchema.parse({ bonds: [], asOfTick: 0 }).bonds).toEqual([])
  })

  it('refuses a stray field', () => {
    expect(BondsResponseSchema.safeParse({ bonds: [], asOfTick: 0, extra: true }).success).toBe(false)
  })
})

describe('bondId', () => {
  it('names a pair the same way from either side', () => {
    expect(bondId('bob', 'alice')).toBe('alice|bob')
    expect(bondId('alice', 'bob')).toBe(bondId('bob', 'alice'))
  })
})

describe('strongerBondKind', () => {
  it('ranks every kind, once', () => {
    expect([...BOND_KIND_PRECEDENCE].sort()).toEqual([...BOND_KINDS].sort())
  })

  it('lets the closest claim name the bond — a couple who also traded are still a couple', () => {
    expect(strongerBondKind('friend', 'partner')).toBe('partner')
    expect(strongerBondKind('partner', 'owe')).toBe('partner')
    expect(strongerBondKind('kin', 'friend')).toBe('kin')
    expect(strongerBondKind('work', 'rival')).toBe('rival')
    expect(strongerBondKind('friend', 'friend')).toBe('friend')
  })

  it('is order-independent', () => {
    for (const a of BOND_KINDS) {
      for (const b of BOND_KINDS) expect(strongerBondKind(a, b), `${a}/${b}`).toBe(strongerBondKind(b, a))
    }
  })
})
