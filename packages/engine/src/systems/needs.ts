import { isBeddedKind, simTimeFromTick, type SimConfig } from '@sj/shared'
import type { AgentBody, WorldState } from '../state.js'
import type { TickCtx } from '../tickCtx.js'
import { ageBand } from './aging.js'
import { queueNeed } from './needsBatch.js'

const clamp = (lo: number, hi: number, v: number) => Math.max(lo, Math.min(hi, v))

// The one derivation of the warmth a body drifts toward: warmthSystem takes the number
// over the moment the cold has teeth, and it must be the same number in both places.
export function warmthTarget(state: WorldState): number {
  return warmthTargetFromAir(state.weather.temperatureC)
}

/** The same curve, taking the air a particular body is actually in. `warmthTargetFor` in
 *  `warmth.ts` is the one caller that has a body to ask about; both land here. */
export function warmthTargetFromAir(temperatureC: number): number {
  return clamp(0, 100, 50 + 2 * (temperatureC - 10))
}

// A bed is a property of the kind, the same shape as the roof over it. One flat rate used to
// answer the bare ground, a storehouse floor and a bed alike.
export function sleepRegenPerTick(state: WorldState, config: SimConfig, agentId: string): number {
  const insideId = state.agents[agentId]?.insideId
  const kind = insideId === undefined ? undefined : state.structures[insideId]?.kind
  const inBed = kind !== undefined && isBeddedKind(config, kind)
  return config.needs.energyRegenAsleepPerTick * (inBed ? config.needs.bedRegenMultiplier : 1)
}

// What standing up and doing something costs, per tick. An old frame gives out sooner.
// Exported because the cold doubles exactly this, and never a second copy of it.
export function awakeEnergyDecay(config: SimConfig, a: AgentBody): number {
  const elder = ageBand(config, a.ageDays) === 'elder'
  return (
    config.needs.energyDecayAwakePerTick * (elder ? config.aging.elderEnergyDecayMultiplier : 1)
  )
}

// A conversation partner within earshot keeps social from decaying and instead regenerates it.
function socialRegenActive(ctx: TickCtx, id: string): boolean {
  const tick = ctx.state().tick
  const window = ctx.config.needs.socialRegenRecencyTicks
  const a = ctx.state().agents[id]!
  const aSpoke = a.lastSpokeTick !== undefined && tick - a.lastSpokeTick <= window
  const earshotSq = ctx.config.movement.earshotRadius * ctx.config.movement.earshotRadius
  for (const otherId of Object.keys(ctx.state().agents)) {
    if (otherId === id) continue
    const o = ctx.state().agents[otherId]!
    if (!o.alive) continue
    const dx = o.x - a.x
    const dy = o.y - a.y
    if (dx * dx + dy * dy > earshotSq) continue
    const oSpoke = o.lastSpokeTick !== undefined && tick - o.lastSpokeTick <= window
    if (aSpoke || oSpoke) return true
  }
  return false
}

export function needsSystem(ctx: TickCtx): void {
  const { needs: cfg } = ctx.config
  const target = warmthTarget(ctx.state())
  const winter = simTimeFromTick(ctx.state().tick).season === 'winter'
  const hungerDecay =
    cfg.hungerDecayPerTick * (winter ? ctx.config.seasons.winter.hungerDecayMultiplier : 1)
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive) continue
    if (a.needs.hunger > 0) queueNeed(ctx, id, 'hunger', -hungerDecay)
    if (a.asleep) {
      if (a.needs.energy < 100)
        queueNeed(ctx, id, 'energy', sleepRegenPerTick(ctx.state(), ctx.config, id))
    } else if (a.needs.energy > 0) {
      queueNeed(ctx, id, 'energy', -awakeEnergyDecay(ctx.config, a))
    }
    if (socialRegenActive(ctx, id)) {
      if (a.needs.social < 100) queueNeed(ctx, id, 'social', cfg.socialRegenConversingPerTick)
    } else if (a.needs.social > 0) {
      queueNeed(ctx, id, 'social', -cfg.socialDecayPerTick)
    }
    // Warmth changes hands the moment the cold has teeth: warmthSystem owns the number in
    // both directions from there, so a body is never written by two laws in one tick.
    if (ctx.config.warmth.enabled) continue
    queueNeed(ctx, id, 'warmth', (target - a.needs.warmth) * cfg.warmthEqualizeFactorPerTick)
  }
}
