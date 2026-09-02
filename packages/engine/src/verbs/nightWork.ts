import { type WorldState } from '../state.js'
import { dayPhaseFromTick, litSourceWithin, type SimConfig } from '@sj/shared'

export function fumblesInTheDark(state: WorldState, config: SimConfig, agentId: string): boolean {
  if (!config.light.enabled) return false
  if (dayPhaseFromTick(state.tick) !== 'night') return false
  const a = state.agents[agentId]
  if (a === undefined) return false
  return !litSourceWithin(state, a.x, a.y, state.tick, config, config.light.workRadius)
}

// The one derivation of what the dark costs. Never a refusal: burning fuel or burning time is
// the body's own choice, and the night is a price change rather than a curfew. Which acts pay it
// is each verb's own `needsLight`, never a list of names kept where the verbs cannot see it.
export function workPenalty(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  needsLight: boolean,
): number {
  return needsLight && fumblesInTheDark(state, config, agentId) ? config.light.nightWorkPenalty : 1
}
