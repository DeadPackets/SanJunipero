import type { SimConfig } from '@sj/shared'
import { effectiveConfig } from './laws.js'
import type { WorldState } from './state.js'
import { readAsPerson } from './verbs/autofill.js'
import {
  approachFor,
  steppingOutWouldHelp,
  VERBS,
  walkDestination,
  workPenalty,
  type PendingEvent,
} from './verbs/index.js'

export type IntentResult = { ok: true; events: PendingEvent[] } | { ok: false; reason: string }

// The same act, hung on the end of the one that makes it possible.
const carrying = (
  go: IntentResult,
  verb: string,
  params: Record<string, unknown>,
): IntentResult =>
  !go.ok
    ? go
    : {
        ok: true,
        events: go.events.map((e) =>
          e.type === 'action_started'
            ? { ...e, payload: { ...(e.payload as Record<string, unknown>), then: { verb, params } } }
            : e,
        ),
      }

/** An act refused for nothing but the way to it becomes the act that opens the way — the door
 *  out, or the walk over — with the act itself hung on the end of that one. What the world holds
 *  against the act rather than the ground is refused as it always was, and so is a mark no road
 *  reaches. */
function walkFirst(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  verb: string,
  params: Record<string, unknown>,
  refusal: string,
): IntentResult {
  if (state.agents[agentId]!.insideId !== undefined) {
    if (!steppingOutWouldHelp(state, config, agentId, verb, params)) {
      return { ok: false, reason: refusal }
    }
    const out = carrying(submitIntent(state, config, agentId, 'exit', {}), verb, params)
    return out.ok ? out : { ok: false, reason: refusal }
  }
  const to = approachFor(state, config, agentId, verb, params)
  if (to === null) return { ok: false, reason: refusal }
  const go = carrying(submitIntent(state, config, agentId, 'walk', to), verb, params)
  return go.ok ? go : { ok: false, reason: refusal }
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
  const first = def.validate(state, config, agentId, p)
  if (first !== null) {
    // The mind chose the verb; the mark it wrote is read the way a person would read it (K20),
    // and two things it fits equally are asked back about rather than picked between.
    const read = readAsPerson(state, config, agentId, verb, p)
    if (read !== null && 'refusal' in read) return { ok: false, reason: read.refusal }
    if (read !== null) p = read.params
    const refusal = read === null ? first : def.validate(state, config, agentId, p)
    // Asked for a thing the world already holds — asleep and told to sleep, inside the roof it
    // is told to enter. The act is over rather than wrong, and ends in the breath it began.
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
    if (refusal !== null) return walkFirst(state, config, agentId, verb, p, refusal)
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
