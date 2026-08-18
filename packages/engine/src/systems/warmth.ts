import { dayPhaseFromTick, simTimeFromTick, type SimConfig } from '@sj/shared'
import type { WorldState } from '../state.js'
import type { TickCtx } from '../worldTick.js'
import { awakeEnergyDecay, warmthTarget } from './needs.js'

// Cold is not a new way to die. It takes the warmth out of a body, and a body with no warmth
// left spends energy twice as fast — which walks it down the Task 9 collapse ladder and nowhere
// else. There is no second severity writer here, and ZERO RNG in this file.

// The two kinds that hold a fire somebody keeps fed. Not a dial: `structures.recipes` is closed
// after Task 2, so the list of things a town can warm itself at lives here.
export const HEAT_SOURCE_KINDS: ReadonlySet<string> = new Set(['hearth', 'fire_pit'])

// The one derivation of what the air is doing (G4): the season's band for this phase of the
// day, plus whatever the sky is taking off it.
export function ambientTempAt(state: WorldState, config: SimConfig): number {
  const band = config.warmth.ambient[simTimeFromTick(state.tick).season]
  const sky = config.warmth.weatherDelta as Record<string, number | undefined>
  return band[dayPhaseFromTick(state.tick)] + (sky[state.weather.kind] ?? 0)
}

// What a body is wearing, in degrees of band. Nothing on the slot is bare skin.
export function insulationOf(state: WorldState, config: SimConfig, agentId: string): number {
  const wornId = state.agents[agentId]?.equipped?.body
  const kind = wornId === undefined ? undefined : state.items[wornId]?.kind
  if (kind === undefined) return 0
  return (config.warmth.insulation as Record<string, number | undefined>)[kind] ?? 0
}

// A fire is warm while somebody keeps feeding it. Measured to the nearest footprint tile, so a
// long hearth warms whoever stands at its near end.
function besideAKeptFire(state: WorldState, config: SimConfig, agentId: string): boolean {
  const a = state.agents[agentId]!
  for (const s of Object.values(state.structures)) {
    if (!HEAT_SOURCE_KINDS.has(s.kind) || s.stage !== 'complete') continue
    if ((s.fueledUntilTick ?? 0) <= state.tick) continue
    const nx = Math.min(Math.max(a.x, s.x), s.x + s.w - 1)
    const ny = Math.min(Math.max(a.y, s.y), s.y + s.h - 1)
    if (Math.max(Math.abs(a.x - nx), Math.abs(a.y - ny)) <= config.warmth.heatRadius) return true
  }
  return false
}

// Out in it, colder than the body can hold, and away from a kept fire.
export function isExposed(state: WorldState, config: SimConfig, agentId: string): boolean {
  if (!config.warmth.enabled) return false
  const a = state.agents[agentId]
  if (a === undefined || !a.alive) return false
  if (a.insideId !== undefined) return false
  if (ambientTempAt(state, config) + insulationOf(state, config, agentId) >= config.warmth.comfortBand) return false
  return !besideAKeptFire(state, config, agentId)
}

// One writer of warmth, chosen by the flag: with the cold switched off `needsSystem` keeps C1's
// equalization, and with it on this law owns the number in both directions.
export function warmthSystem(ctx: TickCtx): void {
  const cfg = ctx.config.warmth
  if (!cfg.enabled) return
  const target = warmthTarget(ctx.state(), ctx.config)
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive) continue
    if (!isExposed(ctx.state(), ctx.config, id)) {
      const delta = (target - a.needs.warmth) * ctx.config.needs.warmthEqualizeFactorPerTick
      if (delta !== 0) ctx.emit('need_changed', { id, need: 'warmth', delta })
      continue
    }
    ctx.emit('need_changed', { id, need: 'warmth', delta: -cfg.exposureDecayPerTick })
    // The cold only costs energy once the body has no warmth left to spend, and `reason` marks
    // exactly that tick — it is what the fold counts, and what names the death that follows.
    const cold = ctx.state().agents[id]!
    if (cold.needs.warmth > 0 || cold.asleep || cold.needs.energy <= 0) continue
    ctx.emit('need_changed', { id, need: 'energy', delta: -awakeEnergyDecay(ctx.config, cold), reason: 'exposure' })
  }
}
