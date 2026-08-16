import type { AgentCtx, Arbiter } from '../adjudicate.js'
import { CodexStore } from '../codex.js'
import type { Verdict } from '../verdict.js'
import { EXPLOIT_CORPUS } from './corpus.js'

export type ChaosResult = {
  intent: string
  verdict: Verdict
  physicsBreaking: boolean
}

// Drives every corpus intent through the arbiter and reports the raw verdict.
// The adjacency gate lives in adjudicate — this runner only measures it: an
// `attempt` whose recipe canon the codex has not earned is a physics break.
// With the production gate in place the exploit never surfaces as such, so
// `physicsBreaking` stays false across the corpus.
export async function runChaos(arbiter: Arbiter, ctx: AgentCtx, codex: CodexStore): Promise<ChaosResult[]> {
  const results: ChaosResult[] = []
  for (const entry of EXPLOIT_CORPUS) {
    const verdict = await arbiter.adjudicate(entry.intent, ctx)
    results.push({
      intent: entry.intent,
      verdict,
      physicsBreaking: verdict.kind === 'attempt' && !codex.withinAdjacency(verdict.recipe.canon),
    })
  }
  return results
}
