import type { EngineBridge } from './bridge.js'
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

// The three things the runtime needs of the arbiter: rule on it, make it law, and say what
// laws the town already has so every mind is told them.
export type SeamArbiter = {
  adjudicate: Adjudicator
  codify: Codifier
  roster?: () => RosterEntry[]
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
    visible: {
      structures: packet.visible.structures.map((s) => ({ kind: s.kind, x: s.x, y: s.y })),
      ground: bridge.groundKinds(agentId),
    },
  }
}
