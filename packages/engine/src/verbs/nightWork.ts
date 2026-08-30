import { type WorldState } from '../state.js'
import { dayPhaseFromTick, litSourceWithin, type SimConfig } from '@sj/shared'

// Everything else costs the same in the dark as at noon: the night is a price change, not a curfew.
export const NIGHT_WORK_VERBS: ReadonlySet<string> = new Set([
  'build',
  'craft',
  'till',
  'pave',
  'dig_channel',
])

export function fumblesInTheDark(state: WorldState, config: SimConfig, agentId: string): boolean {
  if (!config.light.enabled) return false
  if (dayPhaseFromTick(state.tick) !== 'night') return false
  const a = state.agents[agentId]
  if (a === undefined) return false
  return !litSourceWithin(state, a.x, a.y, state.tick, config, config.light.workRadius)
}

// The one derivation of what the dark costs. Never a refusal: burning fuel or burning time is
// the body's own choice.
export function workPenalty(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  verb: string,
): number {
  return NIGHT_WORK_VERBS.has(verb) && fumblesInTheDark(state, config, agentId)
    ? config.light.nightWorkPenalty
    : 1
}
