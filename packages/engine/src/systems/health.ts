import { MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
import type { TickCtx } from '../worldTick.js'

// Four ways back, all of them arithmetic on one dawn payment. With mortality off the world
// keeps the old flat rates exactly, which is what holds the scripted fixture still.
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

export function healthSystem(ctx: TickCtx): void {
  const { health: cfg } = ctx.config
  const tick = ctx.state().tick
  const time = simTimeFromTick(tick)
  const ids = () => Object.keys(ctx.state().agents).sort()

  if (time.hour === 6 && time.minute === 0) {
    for (const id of ids()) {
      const a = ctx.state().agents[id]!
      if (!a.alive) continue
      if (a.hp < cfg.maxHp) {
        const tended = a.tendedTick !== undefined && tick - a.tendedTick <= MINUTES_PER_DAY
        const delta = recoveryDelta(ctx, a.needs.hunger, a.asleep, tended)
        if (delta > 0) ctx.emit('hp_changed', { agentId: id, delta })
      }
      const c = ctx.state().agents[id]!
      if (c.ill && c.hp >= cfg.maxHp) ctx.emit('agent_recovered', { agentId: id })
    }
  }
}
