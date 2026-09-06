import type { EngineBridge } from './bridge.js'
import { idNamed } from '../scene/scene.js'
import type { LawPredicate } from '@sj/engine'
import type { DiscoveryCredit, RosterEntry } from '@sj/shared'

// @sj/arbiter depends on @sj/agents, so the arbiter's own types cannot come back here without a
// package cycle. These are the structural minimums, and the arbiter side pins the assignability.
export type AgentCtx = {
  agentId: string
  name: string
  skills: Record<string, number>
  inventory: { kind: string; qty: number }[]
  position: { x: number; y: number }
  // The world the asker is standing in: an arbiter shown neither rules on a town it cannot see.
  visible: {
    structures: { kind: string; x: number; y: number }[]
    ground: string[]
  }
  // Who stands in sight, by the id a targeted routine takes: the arbiter writes what it is shown.
  people: { id: string; name: string }[]
  // The thought that reached for the act, verbatim. It rides here and not in the intent string
  // because that string is a precedent key (see `humanizeIntent`).
  saying?: string
}

type Verdict =
  | { kind: 'map'; verb: string; params: Record<string, unknown> }
  | { kind: 'attempt'; recipe: { id: string }; summary: string }
  | { kind: 'impossible'; reason: string; class: string }

export type Adjudicator = (intent: string, ctx: AgentCtx) => Promise<Verdict>
/** Who worked it out, and the words they used. The arbiter never knows who is asking at
 *  codify time; the runtime always does, so the credit is threaded rather than guessed. */
export type Codifier = (
  attempt: { recipe: { id: string }; summary: string },
  credit: DiscoveryCredit,
) => { ruleId: number; verb: string }

/** What the court makes of a rule a town just agreed: the shape the world can hold them to, the
 *  number of a standing rule it lets go of, and one sentence saying how the words were read. */
export type LawSeam = (ask: {
  text: string
  standing: { ordinal: number; text: string }[]
  places: { id: string; kind: string; name?: string }[]
}) => Promise<{ predicate: LawPredicate; repeals: number | null; why: string }>

// The four things the runtime needs of the arbiter: rule on it, make it law, say what laws the
// town already has, and say what the town has named for itself.
export type SeamArbiter = {
  adjudicate: Adjudicator
  codify: Codifier
  roster?: () => RosterEntry[]
  /** Names the town spoke for its own habits. Names only: the recognizer's words never cross. */
  customs?: () => readonly string[]
  habits?: () => readonly string[]
  /** What stands one step beyond what the town practices, in the codex's own words. */
  frontier?: () => readonly string[]
  /** Read a rule the town agreed. Absent, a rule is kept in words only. */
  compileLaw?: LawSeam
}

// Values only, in sorted key order: this string is a precedent key, so anything varying per
// mind or per turn must never enter it. The mind's own sentence rides in `AgentCtx.saying`.
export function humanizeIntent(verb: string, params: Record<string, unknown>): string {
  const values = Object.keys(params)
    .sort()
    .map((k) => {
      const v = params[k]
      return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)
    })
  // The verb only: a param value is often a world id, and an id with its underscore taken out
  // is no longer the id.
  return [verb.replace(/_/g, ' '), ...values].join(' ')
}

// The one call the supervisor makes once both halves exist.
export function wireArbiter(
  runtime: { useArbiter(a: SeamArbiter): void },
  arbiter: SeamArbiter,
): void {
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
    people: packet.visible.agents.map((a) => ({ id: a.id, name: a.name })),
    visible: {
      structures: packet.visible.structures.map((s) => ({ kind: s.kind, x: s.x, y: s.y })),
      ground: bridge.groundKinds(agentId),
    },
  }
}

/** A mapped verdict's targetId as the world knows it: the arbiter writes the name it read in the
 *  intent, and the engine answers only to ids. A name nobody in sight carries stays as written. */
export function aimedAt<P extends { targetId?: unknown }>(
  params: P,
  seen: readonly { id: string; name: string }[],
): P {
  if (typeof params.targetId !== 'string') return params
  const id = idNamed(
    params.targetId,
    seen.map((a) => a.id),
    (id) => seen.find((a) => a.id === id)?.name ?? null,
  )
  return id === null ? params : { ...params, targetId: id }
}
