import { simTimeFromTick, type SimConfig } from '@sj/shared'
import type { AgentBody, WorldState } from '../state.js'
import type { TickCtx } from '../worldTick.js'
import { ageBand } from './aging.js'

const clamp = (lo: number, hi: number, v: number) => Math.max(lo, Math.min(hi, v))

// The one derivation of the warmth a body drifts toward (G4): warmthSystem takes the number
// over the moment the cold has teeth, and it must be the same number in both places.
export function warmthTarget(state: WorldState, _config: SimConfig): number {
  return clamp(0, 100, 50 + 2 * (state.weather.temperatureC - 10))
}

// What standing up and doing something costs, per tick. An old frame gives out sooner.
// Exported because the cold doubles exactly this, and never a second copy of it.
export function awakeEnergyDecay(config: SimConfig, a: AgentBody): number {
  const elder = ageBand(config, a.ageDays) === 'elder'
  return config.needs.energyDecayAwakePerTick * (elder ? config.aging.elderEnergyDecayMultiplier : 1)
}

// A conversation partner within earshot keeps social from decaying and instead regenerates it.
function socialRegenActive(ctx: TickCtx, id: string): boolean {
  const tick = ctx.state().tick
  const window = ctx.config.needs.socialRegenRecencyTicks
  const a = ctx.state().agents[id]!
  const aSpoke = a.lastSpokeTick !== undefined && tick - a.lastSpokeTick <= window
  for (const otherId of Object.keys(ctx.state().agents)) {
    if (otherId === id) continue
    const o = ctx.state().agents[otherId]!
    if (!o.alive) continue
    const dx = o.x - a.x
    const dy = o.y - a.y
    if (dx * dx + dy * dy > ctx.config.movement.earshotRadius * ctx.config.movement.earshotRadius) continue
    const oSpoke = o.lastSpokeTick !== undefined && tick - o.lastSpokeTick <= window
    if (aSpoke || oSpoke) return true
  }
  return false
}

export function needsSystem(ctx: TickCtx): void {
  const { needs: cfg } = ctx.config
  const target = warmthTarget(ctx.state(), ctx.config)
  const winter = simTimeFromTick(ctx.state().tick).season === 'winter'
  const hungerDecay = cfg.hungerDecayPerTick * (winter ? ctx.config.seasons.winter.hungerDecayMultiplier : 1)
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive) continue
    if (a.needs.hunger > 0) ctx.emit('need_changed', { id, need: 'hunger', delta: -hungerDecay })
    if (a.asleep) {
      if (a.needs.energy < 100) ctx.emit('need_changed', { id, need: 'energy', delta: cfg.energyRegenAsleepPerTick })
    } else if (a.needs.energy > 0) {
      ctx.emit('need_changed', { id, need: 'energy', delta: -awakeEnergyDecay(ctx.config, a) })
    }
    if (socialRegenActive(ctx, id)) {
      if (a.needs.social < 100) ctx.emit('need_changed', { id, need: 'social', delta: cfg.socialRegenConversingPerTick })
    } else if (a.needs.social > 0) {
      ctx.emit('need_changed', { id, need: 'social', delta: -cfg.socialDecayPerTick })
    }
    // Warmth changes hands the moment the cold has teeth: warmthSystem owns the number in
    // both directions from there, so a body is never written by two laws in one tick.
    if (ctx.config.warmth.enabled) continue
    const warmthDelta = (target - a.needs.warmth) * cfg.warmthEqualizeFactorPerTick
    if (warmthDelta !== 0) ctx.emit('need_changed', { id, need: 'warmth', delta: warmthDelta })
  }
}
