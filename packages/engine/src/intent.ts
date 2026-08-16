import type { SimConfig } from '@sj/shared'
import type { WorldState } from './state.js'
import { VERBS, type PendingEvent } from './verbs.js'

export type IntentResult = { ok: true; events: PendingEvent[] } | { ok: false; reason: string }

export function submitIntent(
  state: WorldState, config: SimConfig, agentId: string, verb: string, params: Record<string, unknown>,
): IntentResult {
  const a = state.agents[agentId]
  if (!a) return { ok: false, reason: 'no such agent' }
  if (!a.alive) return { ok: false, reason: 'the dead do not act' }
  // Sleep is allowed while collapsed: energy only regens asleep, so an
  // energy collapse would otherwise be unrecoverable.
  if (a.collapsedSinceTick !== null && verb !== 'eat' && verb !== 'sleep') return { ok: false, reason: 'collapsed and unable to act' }
  if (a.activity) return { ok: false, reason: `already busy with ${a.activity.verb}` }
  const def = VERBS[verb]
  if (!def) return { ok: false, reason: `unknown verb: ${verb}` }
  const invalid = def.validate(state, config, agentId, params)
  if (invalid) return { ok: false, reason: invalid }
  const duration = def.duration(state, config, agentId, params)
  const events: PendingEvent[] = []
  if (a.asleep && verb !== 'sleep') events.push({ type: 'agent_woke', payload: { agentId } })
  events.push({ type: 'action_started', payload: { agentId, verb, params, duration } })
  if (def.onStart) events.push(...def.onStart(state, config, agentId, params))
  return { ok: true, events }
}
