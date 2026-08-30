import { dayPhaseFromTick, isHearthKind, simTimeFromTick, type SimConfig } from '@sj/shared'
import type { WorldState } from '../state.js'
import type { TickCtx } from '../tickCtx.js'
import { awakeEnergyDecay, warmthTargetFromAir } from './needs.js'

// Cold is not a new way to die: it takes the warmth out of a body, and a body with no warmth
// left spends energy twice as fast, which walks it down the collapse ladder and nowhere else.

// A kind that holds a fire says so once, in structures.recipes[kind].hearth — the same shape roofed took.
export function isHeatSource(config: SimConfig, kind: string): boolean {
  return isHearthKind(config, kind)
}

// The one derivation of what the air is doing: the season's band for this phase of the
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

// A room is ONE PLACE: a body inside a building is at that building's fire whichever tile it
// stands on. How close you must be is a second question — stoke asks arm's reach, warmth heatRadius.
export const inTheRoomWith = (a: { insideId?: string }, s: { id: string }): boolean =>
  a.insideId === s.id
export const fireIsOnYourSide = (a: { insideId?: string }, s: { id: string }): boolean =>
  a.insideId === undefined || a.insideId === s.id

// A fire is warm while somebody keeps feeding it. Measured to the nearest footprint tile, so a
// long hearth warms whoever stands at its near end.
export function besideAKeptFire(state: WorldState, config: SimConfig, agentId: string): boolean {
  const a = state.agents[agentId]!
  for (const s of Object.values(state.structures)) {
    if (!isHeatSource(config, s.kind) || s.stage !== 'complete') continue
    if ((s.fueledUntilTick ?? 0) <= state.tick) continue
    if (!fireIsOnYourSide(a, s)) continue
    if (inTheRoomWith(a, s)) return true
    const nx = Math.min(Math.max(a.x, s.x), s.x + s.w - 1)
    const ny = Math.min(Math.max(a.y, s.y), s.y + s.h - 1)
    if (Math.max(Math.abs(a.x - nx), Math.abs(a.y - ny)) <= config.warmth.heatRadius) return true
  }
  return false
}

// Counts what is on the body's back and the fire it sits at, not just the weather's bare number.
// Only ever raises the target: nothing here can make a body colder than the air it stands in.
export function warmthTargetFor(state: WorldState, config: SimConfig, agentId: string): number {
  const fire = besideAKeptFire(state, config, agentId) ? config.warmth.fireWarmth : 0
  return warmthTargetFromAir(
    state.weather.temperatureC + insulationOf(state, config, agentId) + fire,
  )
}

// Out in it, colder than the body can hold, and away from a kept fire.
export function isExposed(state: WorldState, config: SimConfig, agentId: string): boolean {
  if (!config.warmth.enabled) return false
  const a = state.agents[agentId]
  if (!a?.alive) return false
  if (a.insideId !== undefined) return false
  if (
    ambientTempAt(state, config) + insulationOf(state, config, agentId) >=
    config.warmth.comfortBand
  )
    return false
  return !besideAKeptFire(state, config, agentId)
}

// One writer of warmth, chosen by the flag: with the cold switched off `needsSystem` keeps the old
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
    ctx.emit('need_changed', {
      id,
      need: 'energy',
      delta: -awakeEnergyDecay(ctx.config, cold),
      reason: 'exposure',
    })
  }
}
