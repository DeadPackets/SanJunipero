import { MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
import type { AgentBody } from '../state.js'
import type { TickCtx } from '../tickCtx.js'
import { ailmentDrainPerTick } from './mortality.js'
import { isExposed } from './warmth.js'

// With mortality off the world keeps the flat rates, which is what holds the scripted fixture still.
function recoveryDelta(ctx: TickCtx, hunger: number, asleep: boolean, tended: boolean): number {
  const { health, mortality } = ctx.config
  const base = tended ? health.tendedRecoveryHpPerDay : health.recoveryHpPerDay
  if (!mortality.enabled) return base
  // A body with nothing in it does not mend itself; only another pair of hands can.
  if (!tended && hunger < mortality.fedThreshold) return 0
  return (
    base * (tended ? mortality.tendMultiplier : 1) * (asleep ? mortality.sleepRegenMultiplier : 1)
  )
}

// The road out of a collapse: with the fall the only thing wrong, a body mends by the tick.
// It mends past standing too, or it would clear collapseHp by a hair and drop straight back.
function mendsFromTheFall(ctx: TickCtx, id: string, a: AgentBody): boolean {
  if (a.hp >= ctx.config.health.maxHp) return false
  const fell = a.afflictions?.some((x) => x.kind === 'fatigue') ?? false
  if (!fell && a.collapsedSinceTick === null) return false
  if (a.needs.hunger < ctx.config.mortality.fedThreshold) return false
  if (ailmentDrainPerTick(ctx.state(), ctx.config, id) > 0) return false
  return !isExposed(ctx.state(), ctx.config, id)
}

export function healthSystem(ctx: TickCtx): void {
  const { health: cfg } = ctx.config
  const tick = ctx.state().tick
  const time = simTimeFromTick(tick)
  const dawn = time.hour === 6 && time.minute === 0

  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive) continue
    if (mendsFromTheFall(ctx, id, a)) {
      ctx.emit('hp_changed', { agentId: id, delta: cfg.downedRecoveryHpPerTick })
    } else if (dawn && a.hp < cfg.maxHp) {
      const tended = a.tendedTick !== undefined && tick - a.tendedTick <= MINUTES_PER_DAY
      const delta = recoveryDelta(ctx, a.needs.hunger, a.asleep, tended)
      if (delta > 0) ctx.emit('hp_changed', { agentId: id, delta })
    }
    if (!dawn) continue
    const c = ctx.state().agents[id]!
    if (c.ill && c.hp >= cfg.maxHp) ctx.emit('agent_recovered', { agentId: id })
  }
}
