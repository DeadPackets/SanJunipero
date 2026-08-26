import type { EngineBridge } from './bridge.js'
import type { DiscoveryCredit } from '@sj/shared'

// @sj/arbiter depends on @sj/agents, so this seam cannot import the arbiter's
// own types back without a package cycle. These are the structural minimums
// the arbiter's `AgentCtx` and `Verdict` already satisfy; the arbiter side
// pins the assignability so the two can never drift apart silently.
export type AgentCtx = {
  agentId: string
  name: string
  skills: Record<string, number>
  inventory: Array<{ kind: string; qty: number }>
  position: { x: number; y: number }
  // The world the asker is standing in. The live run's arbiter ruled three times that the
  // town has no well while five minds drank from one, because it was shown neither.
  visible: {
    structures: Array<{ kind: string; x: number; y: number }>
    ground: string[]
  }
  // ★ THE MIND'S OWN SENTENCE — the thought that reached for the act, verbatim. Amara wrote
  // "Four fish. They will spoil unless I smoke them." and the god was handed
  // "smoke_fish over green wood": no fish, no week, no reason. Motivation is what tells an
  // arbiter whether a first step exists, and it was the one thing thrown away.
  //
  // It rides HERE and not in the intent string because the intent string is a precedent key
  // (see `humanizeIntent`). Absent from a caller that has no turn behind the ask.
  saying?: string
}

export type Verdict =
  | { kind: 'map'; verb: string; params: Record<string, unknown> }
  | { kind: 'attempt'; recipe: { id: string }; summary: string }
  | { kind: 'impossible'; reason: string; class: string }

export type Adjudicator = (intent: string, ctx: AgentCtx) => Promise<Verdict>
/** Who worked it out, and the words they used. The arbiter never knows who is asking at
 *  codify time; the runtime always does, so the credit is threaded rather than guessed. */
export type Codifier = (
  recipe: { id: string },
  credit: DiscoveryCredit,
) => { ruleId: number; verb: string }

// Both halves of the arbiter the runtime needs: rule on it, then make it law.
export type SeamArbiter = { adjudicate: Adjudicator; codify: Codifier }

// ★ A REJECTED NAMED VERB, PUT BACK INTO THE WORDS THE MIND WOULD HAVE USED — and until this
// lane it was not put back into words at all.
//
// The arbiter lane's probe drove the real model on the same idea twice. Flattened, the god
// answered `{"kind":"map","verb":"go"}` — a verb that does not exist — and the ruling was
// thrown away. As a sentence, the god ruled `attempt`, within adjacency, one field short of
// codifying food preservation into the world's permanent laws. Same idea, same model, two
// answers, and the only difference was that one of them read like something a person said.
//
// `smoke_fish over green wood` is our field values joined by spaces: an underscored identifier,
// then bare values with no idea what they are for. `smoke fish over green wood` is English.
// The change is the underscore and nothing else, which is what keeps it safe:
//
// ★ VALUES ONLY, READ IN KEY ORDER, so the same act always renders the same way. The arbiter's
// stage 1 is `rulebook.lookup(normalizeIntent(intent))` — an EXACT match against a codified
// recipe's normalized name — and stage 2 is a 0.92 cosine over stored rulings. Both are
// precedent keys. Anything that varies per mind or per turn (a thought, a mood, a name) must
// never enter this string, or the second mind to try the same thing pays for a full
// adjudication instead of getting the answer free. The mind's own sentence rides in
// `AgentCtx.saying` for exactly that reason.
export function humanizeIntent(verb: string, params: Record<string, unknown>): string {
  const values = Object.keys(params)
    .sort()
    .map((k) => {
      const v = params[k]
      return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)
    })
  // ★ THE VERB ONLY. A param value is frequently a world id — `structure_1`, `node_e14` — and
  // an id with its underscore taken out is no longer the id. The invented verb is the one part
  // of this string a mind coined in English and our schema made into a token.
  return [verb.replace(/_/g, ' '), ...values].join(' ')
}

// The one call G9b and C8's supervisor make once both halves exist.
export function wireArbiter(runtime: { useArbiter(a: SeamArbiter): void }, arbiter: SeamArbiter): void {
  runtime.useArbiter(arbiter)
}

// What the arbiter is told about the asker. Everything comes from the world
// itself — the mind's own account of what it holds is never consulted.
export function buildAgentCtx(bridge: EngineBridge, agentId: string, saying?: string): AgentCtx {
  const body = bridge.agentFacts(agentId)
  if (body === null) throw new Error(`no such agent: ${agentId}`)
  const packet = bridge.perception(agentId)
  return {
    ...(saying === undefined || saying.length === 0 ? {} : { saying }),
    agentId,
    name: body.name,
    skills: body.skills,
    inventory: packet.self.inventory.map((i) => ({ kind: i.kind, qty: i.qty })),
    position: { x: packet.self.x, y: packet.self.y },
    visible: {
      structures: packet.visible.structures.map((s) => ({ kind: s.kind, x: s.x, y: s.y })),
      ground: bridge.groundKinds(agentId),
    },
  }
}
