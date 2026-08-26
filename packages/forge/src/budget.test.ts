import { describe, it, expect } from 'vitest'
import { BudgetGuard, BudgetExceededError } from './budget.js'

describe('BudgetGuard', () => {
  it('accumulates spends under the cap', () => {
    const b = new BudgetGuard(5)
    b.spend(1.5)
    b.spend(2.0)
    expect(b.total).toBeCloseTo(3.5)
  })
  it('throws BEFORE recording a spend that would cross the cap', () => {
    const b = new BudgetGuard(5)
    b.spend(4.9)
    expect(() => b.spend(0.2)).toThrow(BudgetExceededError)
    expect(b.total).toBeCloseTo(4.9)
  })
  it('rejects negative spends', () => {
    expect(() => new BudgetGuard(5).spend(-1)).toThrow(/negative/i)
  })
})
