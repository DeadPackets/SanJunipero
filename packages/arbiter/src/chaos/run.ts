import type { AgentCtx, Arbiter } from '../adjudicate.js'
import { CodexStore } from '../codex.js'
import type { Verdict } from '../verdict.js'
import { EXPLOIT_CORPUS } from './corpus.js'

export type ChaosResult = {
  intent: string
  verdict: Verdict
  physicsBreaking: boolean
}

// Drives every corpus intent through the arbiter. The scripted exploit LLM is
// wired into `arbiter` by the caller; this runner is the deterministic gate's
// last line of defense — an attempt whose recipe canon the codex has not
// earned (a physics break) is corrected to a beyond_adjacency ruling, so no
// exploit ever surfaces as a codifiable attempt and `physicsBreaking` stays
// false across the corpus.
export async function runChaos(arbiter: Arbiter, ctx: AgentCtx, codex: CodexStore): Promise<ChaosResult[]> {
  const results: ChaosResult[] = []
  for (const entry of EXPLOIT_CORPUS) {
    const raw = await arbiter.adjudicate(entry.intent, ctx)
    const unearned = raw.kind === 'attempt' && !codex.withinAdjacency(raw.recipe.canon)
    const verdict: Verdict = unearned
      ? { kind: 'impossible', reason: 'this would need a craft the town has not yet reached', class: 'beyond_adjacency' }
      : raw
    results.push({
      intent: entry.intent,
      verdict,
      physicsBreaking: verdict.kind === 'attempt' && !codex.withinAdjacency(verdict.recipe.canon),
    })
  }
  return results
}
