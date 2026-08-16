import { DAYS_PER_YEAR, simTimeFromTick, type SimConfig } from '@sj/shared'
import { dropHeldItems, type TickCtx } from '../worldTick.js'

export type AgeBand = 'child' | 'adult' | 'elder'

export function ageBand(config: SimConfig, ageDays: number): AgeBand {
  const years = Math.floor(ageDays / DAYS_PER_YEAR)
  if (years < config.aging.childUntilYears) return 'child'
  if (years >= config.aging.elderFromYears) return 'elder'
  return 'adult'
}

export function agingSystem(ctx: TickCtx): void {
  const time = simTimeFromTick(ctx.state().tick)
  if (time.hour !== 0 || time.minute !== 0) return
  const { elderFromYears, naturalDeathBaseChancePerDay, naturalDeathChancePerYearOver } = ctx.config.aging
  for (const id of Object.keys(ctx.state().agents).sort()) {
    if (!ctx.state().agents[id]!.alive) continue
    ctx.emit('agent_aged', { agentId: id })
    const years = Math.floor(ctx.state().agents[id]!.ageDays / DAYS_PER_YEAR)
    if (years < elderFromYears) continue
    const chance = naturalDeathBaseChancePerDay + naturalDeathChancePerYearOver * (years - elderFromYears)
    if (ctx.rng.get('aging').next() < chance) {
      dropHeldItems(ctx, id)
      ctx.emit('agent_died', { agentId: id, cause: 'old_age' })
    }
  }
}
