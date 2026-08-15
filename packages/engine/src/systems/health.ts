import { MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
import type { TickCtx } from '../worldTick.js'

const INJURY_HEAL_DAYS = 3

export function healthSystem(ctx: TickCtx): void {
  const { health: cfg } = ctx.config
  const tick = ctx.state().tick
  const time = simTimeFromTick(tick)
  const ids = () => Object.keys(ctx.state().agents).sort()

  if (time.hour === 6 && time.minute === 0) {
    const day = Math.floor(tick / MINUTES_PER_DAY)
    for (const id of ids()) {
      const a = ctx.state().agents[id]!
      if (!a.alive) continue
      for (const injury of a.injuries) {
        if (day >= injury.day + INJURY_HEAL_DAYS) continue
        const roll = ctx.rng.get('health').next()
        if (roll < cfg.infectionChancePerInjuryPerDay && !ctx.state().agents[id]!.ill) {
          ctx.emit('agent_infected', { agentId: id })
        }
      }
      const b = ctx.state().agents[id]!
      if (b.hp < cfg.maxHp) {
        const tended = b.tendedTick !== undefined && tick - b.tendedTick <= MINUTES_PER_DAY
        ctx.emit('hp_changed', { agentId: id, delta: tended ? cfg.tendedRecoveryHpPerDay : cfg.recoveryHpPerDay })
      }
      const c = ctx.state().agents[id]!
      if (c.ill && c.hp >= cfg.maxHp) ctx.emit('agent_recovered', { agentId: id })
    }
  }

  for (const id of ids()) {
    const a = ctx.state().agents[id]!
    if (!a.alive || !a.ill) continue
    for (const otherId of ids()) {
      if (otherId === id) continue
      const o = ctx.state().agents[otherId]!
      if (!o.alive || o.ill) continue
      const dx = o.x - a.x
      const dy = o.y - a.y
      if (dx * dx + dy * dy > cfg.contagionRadius * cfg.contagionRadius) continue
      if (ctx.rng.get('health').next() < cfg.contagionChancePerTick) {
        ctx.emit('agent_fell_ill', { agentId: otherId })
      }
    }
  }
}
