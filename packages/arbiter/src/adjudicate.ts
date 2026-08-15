import type Database from 'better-sqlite3'
import type { LlmClient } from '@sj/agents'
import { CANON } from './canon.js'
import { CodexStore } from './codex.js'
import { codify as codifyRecipe } from './codify.js'
import { assembleAdjudicationPrompt } from './prompt.js'
import { ReviewStore } from './review.js'
import { RulebookStore } from './rulebook.js'
import { RulingsStore } from './rulings.js'
import { VerdictSchema, type Recipe, type Verdict } from './verdict.js'

// A cosine at or above this threshold returns the stored ruling verbatim, so a
// rephrasing of an already-ruled intent resolves to identical physics with zero
// LLM calls.
export const SIMILARITY_SHORT_CIRCUIT = 0.92

export type AgentCtx = {
  agentId: string
  name: string
  skills: Record<string, number>
  inventory: Array<{ kind: string; qty: number }>
  position: { x: number; y: number }
}

export type ArbiterDeps = {
  db: Database.Database
  llm: LlmClient
  embedder: { embed(t: string): Promise<Float32Array> }
  tick?: () => number
}

export type Arbiter = {
  adjudicate(intent: string, agentCtx: AgentCtx): Promise<Verdict>
  codify(recipe: Recipe): { ruleId: number; verb: string }
  revert(recipeId: string, reason: string): void
}

export function makeArbiter(deps: ArbiterDeps): Arbiter {
  const rulebook = new RulebookStore(deps.db)
  const review = new ReviewStore(deps.db)
  const codex = new CodexStore(deps.db)
  const rulings = new RulingsStore(deps.db, deps.embedder)
  const tick = deps.tick ?? (() => 0)

  return {
    async adjudicate(intent, agentCtx) {
      // Stage 1 — deterministic rulebook lookup (exact normalized-name match).
      const hit = rulebook.lookup(intent)
      if (hit) return { kind: 'map', verb: hit.verb, params: {} }

      // Stage 2 — deterministic rulings similarity short-circuit.
      const top = (await rulings.similar(intent, 1))[0]
      if (top && top.cosine >= SIMILARITY_SHORT_CIRCUIT) {
        const stored = JSON.parse(top.ruling.verdictJson) as Verdict
        if (stored.kind === 'attempt') {
          const row = rulebook.byId(stored.recipe.id)
          if (row === null) return stored
          if (row.revertedAtTick === null) return { kind: 'map', verb: stored.recipe.id, params: {} }
          // Reverted → fall through to the LLM (the admin re-decides after revert).
        } else {
          return stored
        }
      }

      // Stage 3 — only genuinely novel intents reach the LLM.
      const similar = await rulings.similar(intent, 5)
      const precedent = similar.map(({ ruling }) => {
        const v = JSON.parse(ruling.verdictJson) as Verdict
        if (v.kind === 'attempt') return { summary: v.summary, verdictKind: 'attempt', recipeName: v.recipe.name } as const
        if (v.kind === 'impossible') return { summary: v.reason, verdictKind: 'impossible' } as const
        return { summary: v.verb, verdictKind: 'map' } as const
      })
      const { system, messages } = assembleAdjudicationPrompt({
        canon: `${CANON}\n\nThe town currently knows: ${codex.known().join(', ')}`,
        agent: agentCtx,
        precedent,
        intent,
      })
      const { value } = await deps.llm.object({ schema: VerdictSchema, system, messages })
      // Deterministic adjacency gate: an attempt whose recipe canon the codex
      // has not earned is beyond adjacency, never codifiable. Record the
      // corrected verdict so the exploit never becomes shared precedent.
      const verdict: Verdict =
        value.kind === 'attempt' && !codex.withinAdjacency(value.recipe.canon)
          ? { kind: 'impossible', reason: 'this would need a craft the town has not yet reached', class: 'beyond_adjacency' }
          : value

      // Stage 4 — record the ruling as shared precedent.
      await rulings.record(intent, verdict, tick())

      return verdict
    },

    codify(recipe) {
      return codifyRecipe(recipe, { rulebook, review, codex, tick: tick() })
    },

    revert(recipeId, reason) {
      review.revertByRecipe(recipeId, reason, tick())
    },
  }
}
