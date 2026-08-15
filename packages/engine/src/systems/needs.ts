import type { TickCtx } from '../worldTick.js'

const clamp = (lo: number, hi: number, v: number) => Math.max(lo, Math.min(hi, v))

// A conversation partner within earshot keeps social from decaying and instead regenerates it.
const SPOKE_RECENCY_TICKS = 60

function socialRegenActive(ctx: TickCtx, id: string): boolean {
  const tick = ctx.state().tick
  const a = ctx.state().agents[id]!
  const aSpoke = a.lastSpokeTick !== undefined && tick - a.lastSpokeTick <= SPOKE_RECENCY_TICKS
  for (const otherId of Object.keys(ctx.state().agents)) {
    if (otherId === id) continue
    const o = ctx.state().agents[otherId]!
    if (!o.alive) continue
    const dx = o.x - a.x
    const dy = o.y - a.y
    if (dx * dx + dy * dy > ctx.config.movement.earshotRadius * ctx.config.movement.earshotRadius) continue
    const oSpoke = o.lastSpokeTick !== undefined && tick - o.lastSpokeTick <= SPOKE_RECENCY_TICKS
    if (aSpoke || oSpoke) return true
  }
  return false
}

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
    if (socialRegenActive(ctx, id)) {
      if (a.needs.social < 100) ctx.emit('need_changed', { id, need: 'social', delta: cfg.socialRegenConversingPerTick })
    } else if (a.needs.social > 0) {
      ctx.emit('need_changed', { id, need: 'social', delta: -cfg.socialDecayPerTick })
    }
    const warmthDelta = (target - a.needs.warmth) * cfg.warmthEqualizeFactorPerTick
    if (warmthDelta !== 0) ctx.emit('need_changed', { id, need: 'warmth', delta: warmthDelta })
  }
}
