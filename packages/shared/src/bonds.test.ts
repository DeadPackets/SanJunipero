import { describe, expect, it } from 'vitest'
import {
  BOND_KINDS, BOND_KIND_PRECEDENCE, BondSchema, BondsResponseSchema, bondId, strongerBondKind,
  type Bond,
} from './bonds.js'

const bond: Bond = {
  id: 'alice|bob',
  aId: 'alice', bId: 'bob',
  kind: 'partner',
  strength: 2,
  formedTick: 30,
  lastUpdatedTick: 90,
  history: [
    { tick: 30, kind: 'co_slept', note: 'kept house together' },
    { tick: 90, kind: 'co_slept', note: 'kept house together' },
  ],
}

describe('BondSchema', () => {
  it('round-trips a bond with its history intact', () => {
    expect(BondSchema.parse(bond)).toEqual(bond)
  })

  it('accepts a bond that has not been touched since it formed', () => {
    expect(BondSchema.safeParse({ ...bond, strength: 1, lastUpdatedTick: 30, history: [bond.history[0]!] }).success)
      .toBe(true)
  })

  it('refuses a stray field, an unknown kind, a negative strength and an empty note', () => {
    expect(BondSchema.safeParse({ ...bond, extra: 1 }).success).toBe(false)
    expect(BondSchema.safeParse({ ...bond, kind: 'nemesis' }).success).toBe(false)
    expect(BondSchema.safeParse({ ...bond, strength: -1 }).success).toBe(false)
    expect(BondSchema.safeParse({ ...bond, history: [{ tick: 1, kind: 'x', note: '' }] }).success).toBe(false)
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
