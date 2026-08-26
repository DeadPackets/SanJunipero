export class BudgetExceededError extends Error {
  constructor(
    public capUsd: number,
    public attemptedTotal: number,
  ) {
    super(`budget cap $${capUsd} would be exceeded (attempted total $${attemptedTotal.toFixed(4)})`)
  }
}

export class BudgetGuard {
  #total = 0
  constructor(private capUsd: number) {}
  spend(usd: number): void {
    if (usd < 0) throw new Error('negative spend')
    if (this.#total + usd > this.capUsd)
      throw new BudgetExceededError(this.capUsd, this.#total + usd)
    this.#total += usd
  }
  get total(): number {
    return this.#total
  }
}
