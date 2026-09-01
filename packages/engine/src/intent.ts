import type { SimConfig } from '@sj/shared'
import { effectiveConfig } from './laws.js'
import type { WorldState } from './state.js'
import { loneCandidateFor, markUnderAnotherKey } from './verbs/autofill.js'
import {
  approachFor,
  VERBS,
  walkDestination,
  workPenalty,
  type PendingEvent,
} from './verbs/index.js'

export type IntentResult = { ok: true; events: PendingEvent[] } | { ok: false; reason: string }

/** An act refused for nothing but the distance to it becomes the walk that closes the distance,
 *  with the act itself hung on the end of the legs. What the world holds against the act rather
 *  than the ground is refused as it always was, and so is a mark no road reaches. */
function walkFirst(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  verb: string,
  params: Record<string, unknown>,
  refusal: string,
): IntentResult {
  const to = approachFor(state, config, agentId, verb, params)
  if (to === null) return { ok: false, reason: refusal }
  const go = submitIntent(state, config, agentId, 'walk', to)
  if (!go.ok) return { ok: false, reason: refusal }
  return {
    ok: true,
    events: go.events.map((e) =>
      e.type === 'action_started'
        ? {
            ...e,
            payload: { ...(e.payload as Record<string, unknown>), then: { verb, params } },
          }
        : e,
    ),
  }
}

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
  // Sleep is allowed while collapsed: energy only regens asleep, so an
  // energy collapse would otherwise be unrecoverable.
  if (a.collapsedSinceTick !== null && verb !== 'eat' && verb !== 'sleep')
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
  // Asked for a thing the world already holds — asleep and told to sleep, inside the roof it is
  // told to enter. The act is over rather than wrong: it starts and completes in one breath.
  if (refusal !== null && def.settled?.(state, config, agentId, p) === true) {
    return {
      ok: true,
      events: [
        ...(a.asleep && verb !== 'sleep' ? [{ type: 'agent_woke', payload: { agentId } }] : []),
        { type: 'action_started', payload: { agentId, verb, params: p, duration: 0 } },
        { type: 'action_completed', payload: { agentId, verb } },
      ],
    }
  }
  // The mind chose the verb; where the world holds one thing that verb would take, read it in
  // rather than refuse (K20). The filled act rides the rest of this function as if it were named.
  if (refusal !== null) {
    // What the mind named outranks what the world would have guessed: the id it gave is right
    // 152 times in 154, and only a mark that fits nowhere falls through to the lone candidate.
    const filled =
      markUnderAnotherKey(state, config, agentId, verb, p) ??
      loneCandidateFor(state, config, agentId, verb, p)
    if (filled === null) return walkFirst(state, config, agentId, verb, p, refusal)
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
