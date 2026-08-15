import type { TickCtx } from '../worldTick.js'

const clamp = (lo: number, hi: number, v: number) => Math.max(lo, Math.min(hi, v))

export function needsSystem(ctx: TickCtx): void {
  const { needs: cfg } = ctx.config
  const target = clamp(0, 100, 50 + 2 * (ctx.state().weather.temperatureC - 10))
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive) continue
    if (a.needs.hunger > 0) ctx.emit('need_changed', { id, need: 'hunger', delta: -cfg.hungerDecayPerTick })
    if (a.asleep) {
      if (a.needs.energy < 100) ctx.emit('need_changed', { id, need: 'energy', delta: cfg.energyRegenAsleepPerTick })
    } else if (a.needs.energy > 0) {
      ctx.emit('need_changed', { id, need: 'energy', delta: -cfg.energyDecayAwakePerTick })
    }
    if (a.needs.social > 0) ctx.emit('need_changed', { id, need: 'social', delta: -cfg.socialDecayPerTick })
    const warmthDelta = (target - a.needs.warmth) * cfg.warmthEqualizeFactorPerTick
    if (warmthDelta !== 0) ctx.emit('need_changed', { id, need: 'warmth', delta: warmthDelta })
  }
}
