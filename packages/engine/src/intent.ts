import type { SimConfig } from '@sj/shared'
import { effectiveConfig } from './laws.js'
import type { WorldState } from './state.js'
import { loneCandidateFor, markUnderAnotherKey } from './verbs/autofill.js'
import { VERBS, walkDestination, workPenalty, type PendingEvent } from './verbs/index.js'

export type IntentResult = { ok: true; events: PendingEvent[] } | { ok: false; reason: string }

// The road out of a collapse. World one closed every one of these: Amara died ten feet from a
// neighbour's door having tried fifteen times to shout, and been refused each time.
const DOWNED_VERBS: ReadonlySet<string> = new Set(['eat', 'sleep', 'speak', 'walk'])

export function submitIntent(
  state: WorldState,
  baseConfig: SimConfig,
  agentId: string,
  verb: string,
  params: Record<string, unknown>,
): IntentResult {
  // Derived here, not at the call site: every verb is judged under the world's live laws.
  const config = effectiveConfig(baseConfig, state.laws)
  const a = state.agents[agentId]
  if (!a) return { ok: false, reason: 'no such agent' }
  if (!a.alive) return { ok: false, reason: 'the dead do not act' }
  if (a.collapsedSinceTick !== null && !DOWNED_VERBS.has(verb))
    return { ok: false, reason: 'collapsed and unable to act' }
  const def = VERBS[verb]
  if (!def) return { ok: false, reason: `unknown verb: ${verb}` }
  // A verb that declares `atOnce` does not use the hands: it never takes the activity slot and is
  // never refused for busy-ness. Nothing here can end a running activity early.
  const usesHands = def.atOnce === undefined
  if (a.activity && usesHands) return { ok: false, reason: `already busy with ${a.activity.verb}` }
  // A named place settles to its tile before anybody judges the act, so validate, duration and
  // the fold read the same two numbers; one it cannot settle is left for validate to refuse.
  let p = params
  if (verb === 'walk') {
    const to = walkDestination(state, config, agentId, params)
    if (!('refusal' in to)) p = { ...params, ...to }
  }
  const refusal = def.validate(state, config, agentId, p)
  // The mind chose the verb; where the world holds one thing that verb would take, read it in
  // rather than refuse (K20). The filled act rides the rest of this function as if it were named.
  if (refusal !== null) {
    // What the mind named outranks what the world would have guessed: the id it gave is right
    // 152 times in 154, and only a mark that fits nowhere falls through to the lone candidate.
    const filled =
      markUnderAnotherKey(state, config, agentId, verb, p) ??
      loneCandidateFor(state, config, agentId, verb, p)
    if (filled === null) return { ok: false, reason: refusal }
    p = filled
  }
  const events: PendingEvent[] = []
  if (a.asleep && verb !== 'sleep') events.push({ type: 'agent_woke', payload: { agentId } })
  if (def.atOnce !== undefined) {
    events.push(...def.atOnce(state, config, agentId, p))
    return { ok: true, events }
  }
  // The one place a duration is settled, so the dark can charge for work without every verb
  // having to remember that it is night.
  const penalty = workPenalty(state, config, agentId, verb)
  const base = def.duration(state, config, agentId, p)
  const duration = penalty === 1 ? base : Math.ceil(base * penalty)
  events.push({ type: 'action_started', payload: { agentId, verb, params: p, duration } })
  if (def.onStart) events.push(...def.onStart(state, config, agentId, p))
  return { ok: true, events }
}
