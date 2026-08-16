import type { SimEvent } from '@sj/shared'

// THE Style Bible rule, mechanized: grave scenes still the renderer.
export const GRAVE_EVENTS = ['agent_died'] as const
export const GRAVE_AFTERMATH = ['agent_injured'] as const // violence aftermath
export const GRAVE_HOLD_TICKS = 60 // one sim-hour of stillness after a death — (controller ruling) confirmed
export const AFTERMATH_HOLD_TICKS = 15 // a beat after violence — (controller ruling) confirmed

export function toneReducer(prev: { graveUntil: number }, evts: SimEvent[], tick: number): { graveUntil: number } {
  let graveUntil = prev.graveUntil
  for (const ev of evts) {
    if ((GRAVE_EVENTS as readonly string[]).includes(ev.type)) graveUntil = Math.max(graveUntil, tick + GRAVE_HOLD_TICKS)
    else if ((GRAVE_AFTERMATH as readonly string[]).includes(ev.type)) graveUntil = Math.max(graveUntil, tick + AFTERMATH_HOLD_TICKS)
  }
  return graveUntil === prev.graveUntil ? prev : { graveUntil }
}

export function isGrave(t: { graveUntil: number }, tick: number): boolean {
  return tick < t.graveUntil
}
