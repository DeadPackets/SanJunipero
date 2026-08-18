import { MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
import type { TickCtx } from '../worldTick.js'

// C11 deviation 3 (controller ruling 3): the per-tick contagion loop that used to live at the
// foot of this file is gone. Illness spreads once, at midnight, from systems/illness.ts — two
// contagion systems at different cadences was one too many. Task 37 took the last of it: the
// dawn injury-infection roll went with it, and mints an affliction instead of a boolean.

// Four ways back, all of them arithmetic on one dawn payment. With mortality off the world
// keeps C9's flat rates exactly, which is what holds the G2 fixture still until Task 37.
function recoveryDelta(ctx: TickCtx, hunger: number, asleep: boolean, tended: boolean): number {
  const { health, mortality } = ctx.config
  const base = tended ? health.tendedRecoveryHpPerDay : health.recoveryHpPerDay
  if (!mortality.enabled) return base
  // A body with nothing in it does not mend itself; only another pair of hands can.
  if (!tended && hunger < mortality.fedThreshold) return 0
  return base * (tended ? mortality.tendMultiplier : 1) * (asleep ? mortality.sleepRegenMultiplier : 1)
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
