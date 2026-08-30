import { DAYS_PER_YEAR, simTimeFromTick, type SimConfig } from '@sj/shared'
import type { TickCtx } from '../tickCtx.js'
import { dropHeldItems, placeGrave } from './mortality.js'

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
  const {
    elderFromYears,
    naturalDeathBaseChancePerDay,
    naturalDeathChancePerYearOver,
    deathOfOldAgeEnabled,
  } = ctx.config.aging
  for (const id of Object.keys(ctx.state().agents).sort()) {
    if (!ctx.state().agents[id]!.alive) continue
    // Bodies age either way; only the death roll answers to the flag, and when it is
    // off the roll is not drawn at all.
    ctx.emit('agent_aged', { agentId: id })
    if (!deathOfOldAgeEnabled) continue
    const years = Math.floor(ctx.state().agents[id]!.ageDays / DAYS_PER_YEAR)
    if (years < elderFromYears) continue
    const chance =
      naturalDeathBaseChancePerDay + naturalDeathChancePerYearOver * (years - elderFromYears)
    if (ctx.rng.get('aging').next() < chance) {
      dropHeldItems(ctx, id)
      ctx.emit('agent_died', { agentId: id, cause: 'old_age' })
      placeGrave(ctx, id)
    }
  }
}
