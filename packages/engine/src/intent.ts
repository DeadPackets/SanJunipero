import type { SimConfig } from '@sj/shared'
import { effectiveConfig } from './laws.js'
import type { WorldState } from './state.js'
import { VERBS, workPenalty, type PendingEvent } from './verbs.js'

export type IntentResult = { ok: true; events: PendingEvent[] } | { ok: false; reason: string }

export function submitIntent(
  state: WorldState, baseConfig: SimConfig, agentId: string, verb: string, params: Record<string, unknown>,
): IntentResult {
  // Derived here, not at the call site: every verb is judged under the world's live laws.
  const config = effectiveConfig(baseConfig, state.laws)
  const a = state.agents[agentId]
  if (!a) return { ok: false, reason: 'no such agent' }
  if (!a.alive) return { ok: false, reason: 'the dead do not act' }
  // Sleep is allowed while collapsed: energy only regens asleep, so an
  // energy collapse would otherwise be unrecoverable.
  if (a.collapsedSinceTick !== null && verb !== 'eat' && verb !== 'sleep') return { ok: false, reason: 'collapsed and unable to act' }
  const def = VERBS[verb]
  if (!def) return { ok: false, reason: `unknown verb: ${verb}` }
  // ★ THE ONE INTERRUPT POLICY STILL HOLDS, AND IT IS ABOUT THE HANDS. A verb that declares
  // `atOnce` does not use them: it never takes the activity slot and is never refused for
  // busy-ness. `speak` is the whole of that list. Everything else waits its turn exactly as it
  // always has, and nothing here can end a running activity early.
  const usesHands = def.atOnce === undefined
  if (a.activity && usesHands) return { ok: false, reason: `already busy with ${a.activity.verb}` }
  const invalid = def.validate(state, config, agentId, params)
  if (invalid) return { ok: false, reason: invalid }
  const events: PendingEvent[] = []
  if (a.asleep && verb !== 'sleep') events.push({ type: 'agent_woke', payload: { agentId } })
  if (def.atOnce !== undefined) {
    events.push(...def.atOnce(state, config, agentId, params))
    return { ok: true, events }
  }
  // The one place a duration is settled, so the dark can charge for work without every verb
  // having to remember that it is night (G4).
  const penalty = workPenalty(state, config, agentId, verb)
  const base = def.duration(state, config, agentId, params)
  const duration = penalty === 1 ? base : Math.ceil(base * penalty)
  events.push({ type: 'action_started', payload: { agentId, verb, params, duration } })
  if (def.onStart) events.push(...def.onStart(state, config, agentId, params))
  return { ok: true, events }
}
