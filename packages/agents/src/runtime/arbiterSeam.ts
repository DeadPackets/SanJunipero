import type { EngineBridge } from './bridge.js'

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
}

export type Verdict =
  | { kind: 'map'; verb: string; params: Record<string, unknown> }
  | { kind: 'attempt'; recipe: { id: string }; summary: string }
  | { kind: 'impossible'; reason: string; class: string }

export type Adjudicator = (intent: string, ctx: AgentCtx) => Promise<Verdict>
export type Codifier = (recipe: { id: string }) => { ruleId: number; verb: string }

// Both halves of the arbiter the runtime needs: rule on it, then make it law.
export type SeamArbiter = { adjudicate: Adjudicator; codify: Codifier }

// A rejected named verb, put back into the words the mind would have used.
// Values only, read in key order, so the same intent always flattens the same
// way — the arbiter's precedent lookup depends on it.
export function flattenIntent(verb: string, params: Record<string, unknown>): string {
  const values = Object.keys(params)
    .sort()
    .map((k) => {
      const v = params[k]
      return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)
    })
  return [verb, ...values].join(' ')
}

// The one call G9b and C8's supervisor make once both halves exist.
export function wireArbiter(runtime: { useArbiter(a: SeamArbiter): void }, arbiter: SeamArbiter): void {
  runtime.useArbiter(arbiter)
}

// What the arbiter is told about the asker. Everything comes from the world
// itself — the mind's own account of what it holds is never consulted.
export function buildAgentCtx(bridge: EngineBridge, agentId: string): AgentCtx {
  const body = bridge.agentFacts(agentId)
  if (body === null) throw new Error(`no such agent: ${agentId}`)
  const packet = bridge.perception(agentId)
  return {
    agentId,
    name: body.name,
    skills: body.skills,
    inventory: packet.self.inventory.map((i) => ({ kind: i.kind, qty: i.qty })),
    position: { x: packet.self.x, y: packet.self.y },
  }
}
