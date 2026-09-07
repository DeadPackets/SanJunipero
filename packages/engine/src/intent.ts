import type { SimConfig } from '@sj/shared'
import { effectiveConfig } from './laws.js'
import { judgeLaws, witnessesOf } from './socialLaws.js'
import type { WorldState } from './state.js'
import { readAsPerson, soleObstacle } from './verbs/autofill.js'
import {
  approachFor,
  asRead,
  steppingOutWouldHelp,
  VERBS,
  walkDestination,
  workPenalty,
  type PendingEvent,
} from './verbs/index.js'

export type IntentResult = { ok: true; events: PendingEvent[] } | { ok: false; reason: string }

// The road out of a collapse. World one closed every one of these: Amara died ten feet from a
// neighbour's door having tried fifteen times to shout, and been refused each time.
// forage and take: r34's Yusuf, down and starving, crawled round a berry bush for six hours and
// died with the berries a hand's reach away. What is within reach of the ground is reachable.
const DOWNED_VERBS: ReadonlySet<string> = new Set([
  'drink',
  'eat',
  'exit',
  'forage',
  'sleep',
  'speak',
  'take',
  'walk',
])

// r37: Dilara built at six energy until she fell, slept, and was woken at six by dawn, by cold
// and by her own plan, to fall again two hours on: twelve collapses in twenty-two hours. Below
// this a body keeps only the light acts, and asleep under the debuff line it is not woken by
// anything it wants itself.
export const SPENT_ENERGY = 10
const SPENT_VERBS: ReadonlySet<string> = new Set([
  ...DOWNED_VERBS,
  'drop',
  'enter',
  'give',
  'stop',
  'stow',
  'wake',
])
export const isLightWork = (verb: string): boolean =>
  SPENT_VERBS.has(verb) || verb.startsWith('express:')

// The same act, hung on the end of the one that makes it possible.
const carrying = (go: IntentResult, verb: string, params: Record<string, unknown>): IntentResult =>
  !go.ok
    ? go
    : {
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

/** An act refused for nothing but the way to it becomes the act that opens the way — the door
 *  out, or the walk over — with the act itself hung on the end of that one. */
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
  // A person walks off while the legs are going. Naming them makes the leg a chase, which
  // re-aims itself and has a clock; a coordinate leg lands short and is composed again forever.
  const after = params.targetId
  if (typeof after === 'string' && state.agents[after]?.alive === true) {
    const chase = carrying(
      submitIntent(state, config, agentId, 'walk', { targetId: after }),
      verb,
      params,
    )
    if (chase.ok) return chase
  }
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
  if (a.collapsedSinceTick !== null && !DOWNED_VERBS.has(verb))
    return { ok: false, reason: 'collapsed and unable to act' }
  if (a.asleep && a.needs.energy < config.needs.debuffThreshold && verb !== 'sleep')
    return {
      ok: false,
      reason: 'too spent to wake: the body sleeps on until it has something back',
    }
  if (a.collapsedSinceTick === null && a.needs.energy < SPENT_ENERGY && !isLightWork(verb))
    return {
      ok: false,
      reason: 'your arms will not do it: you are past working, and only sleep brings it back',
    }
  const def = VERBS[verb]
  if (!def) return { ok: false, reason: `unknown verb: ${verb}` }
  // A verb that declares `atOnce` does not use the hands: it never takes the activity slot and is
  // never refused for busy-ness. `stop` is the one that reaches into an act already running.
  const usesHands = def.atOnce === undefined
  if (a.activity && usesHands) return { ok: false, reason: `already busy with ${a.activity.verb}` }
  // Every params schema is strict, and a mind answers with keys the verb never reads — so the
  // surplus refused a correctly-named act, in words that blamed the name it had in fact written.
  let p = asRead(def, params)
  // A named place settles to its tile before anybody judges the act, so validate, duration and
  // the fold read the same two numbers; one it cannot settle is left for validate to refuse.
  const settleWalk = (act: Record<string, unknown>): Record<string, unknown> => {
    if (verb !== 'walk') return act
    const to = walkDestination(state, config, agentId, act)
    return 'refusal' in to ? act : { ...act, ...to }
  }
  p = settleWalk(p)
  const first = def.validate(state, config, agentId, p)
  if (first !== null) {
    // The mind chose the verb; its whole answer is read the way a person would read it (K20) —
    // a mark under a key this verb never reads is still one — and two equal fits are asked back about.
    const read = readAsPerson(state, config, agentId, verb, params)
    if (read !== null && 'refusal' in read) return { ok: false, reason: read.refusal }
    // Settled again, because a reading hands back the name a mind wrote and not the tile the
    // first pass found: without this, validate, `settled`, duration and the fold read a walk
    // that has no two numbers at all.
    if (read !== null) p = settleWalk(asRead(def, read.params))
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
    // Said in the truest words the verb has for it: the walk is still tried first either way.
    if (refusal !== null) {
      const cause = soleObstacle(state, config, agentId, verb, p) ?? refusal
      return walkFirst(state, config, agentId, verb, p, cause)
    }
  }
  // The town's own rules, judged where the world's are: a rule the town can hold somebody to
  // refuses in the town's words, and a rule it only forbids lets the act through witnessed.
  const judged = judgeLaws(state, config, agentId, verb, p, state.tick)
  if (judged !== null && 'refusal' in judged) return { ok: false, reason: judged.refusal }
  const witnessed: PendingEvent[] =
    judged === null
      ? []
      : judged.broken.map((lawId) => ({
          type: 'law_broken',
          payload: { lawId, agentId, verb, witnesses: witnessesOf(state, config, agentId) },
        }))
  const events: PendingEvent[] = []
  if (a.asleep && verb !== 'sleep') events.push({ type: 'agent_woke', payload: { agentId } })
  if (def.atOnce !== undefined) {
    events.push(...def.atOnce(state, config, agentId, p))
    return { ok: true, events: [...events, ...witnessed] }
  }
  // The one place a duration is settled, so the dark can charge for work without every verb
  // having to remember that it is night.
  const penalty = workPenalty(state, config, agentId, def.needsLight === true)
  const base = def.duration(state, config, agentId, p)
  const duration = penalty === 1 ? base : Math.ceil(base * penalty)
  events.push({ type: 'action_started', payload: { agentId, verb, params: p, duration } })
  if (def.onStart) events.push(...def.onStart(state, config, agentId, p))
  return { ok: true, events: [...events, ...witnessed] }
}
