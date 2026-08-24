import { dayPhaseFromTick, isHearthKind, simTimeFromTick, type SimConfig } from '@sj/shared'
import type { WorldState } from '../state.js'
import type { TickCtx } from '../worldTick.js'
import { awakeEnergyDecay, warmthTargetFromAir } from './needs.js'

// Cold is not a new way to die. It takes the warmth out of a body, and a body with no warmth
// left spends energy twice as fast — which walks it down the Task 9 collapse ladder and nowhere
// else. There is no second severity writer here, and ZERO RNG in this file.

// ★ THE ROSTER IS GONE. This was `new Set(['hearth', 'fire_pit'])` — two names somebody
// remembered, and the reason no verb in the world could reach the fire in a house. It is
// `structures.recipes[kind].hearth` now, the same shape `roofed` took, so a kind that holds a
// fire says so once and every law reads the one answer (G4).
export function isHeatSource(config: SimConfig, kind: string): boolean {
  return isHearthKind(config, kind)
}

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
// long hearth warms whoever stands at its near end — and a body INSIDE a building is at its
// fire whatever tile it is standing on, because the fire is in the room with it.
export function besideAKeptFire(state: WorldState, config: SimConfig, agentId: string): boolean {
  const a = state.agents[agentId]!
  for (const s of Object.values(state.structures)) {
    if (!isHeatSource(config, s.kind) || s.stage !== 'complete') continue
    if ((s.fueledUntilTick ?? 0) <= state.tick) continue
    if (a.insideId === s.id) return true
    if (a.insideId !== undefined) continue // a wall stops the heat as squarely as it stops sound
    const nx = Math.min(Math.max(a.x, s.x), s.x + s.w - 1)
    const ny = Math.min(Math.max(a.y, s.y), s.y + s.h - 1)
    if (Math.max(Math.abs(a.x - nx), Math.abs(a.y - ny)) <= config.warmth.heatRadius) return true
  }
  return false
}

// ★ THE WARMTH A PARTICULAR BODY DRIFTS TOWARD, with what is on its back and the fire it is
// sitting at both counted. Until this, a fed fire only decided whether a body was FREEZING:
// `isExposed` stops at the exposure drain, and everybody who was not freezing drifted to the
// weather's own bare number. So a hearth was worth exactly as much as no hearth to anybody
// already under a roof — a thing the world draws that changes nothing, which is arm B's shape.
// Measured on a winter night: 10 without, 34 with, and the shiver line is 30.
//
// It only ever goes UP. Nothing here can make a body colder than the air it stands in, so no
// night is worse than it was — which is the distinction R2 turned on, and it holds here too.
export function warmthTargetFor(state: WorldState, config: SimConfig, agentId: string): number {
  const fire = besideAKeptFire(state, config, agentId) ? config.warmth.fireWarmth : 0
  return warmthTargetFromAir(state.weather.temperatureC + insulationOf(state, config, agentId) + fire)
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
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive) continue
    if (!isExposed(ctx.state(), ctx.config, id)) {
      const target = warmthTargetFor(ctx.state(), ctx.config, id)
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
