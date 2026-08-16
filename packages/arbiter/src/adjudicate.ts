import type Database from 'better-sqlite3'
import type { LlmClient } from '@sj/agents'
import { registerVerb, VERBS } from '@sj/engine'
import { CANON } from './canon.js'
import { CodexStore } from './codex.js'
import { codify as codifyRecipe, verbFromRecipe } from './codify.js'
import { assembleAdjudicationPrompt, FORBIDDEN_FRAMING } from './prompt.js'
import { ReviewStore } from './review.js'
import { RulebookStore } from './rulebook.js'
import { RulingsStore } from './rulings.js'
import { VerdictSchema, type Recipe, type Verdict } from './verdict.js'

// A cosine at or above this threshold returns the stored ruling verbatim, so a
// rephrasing of an already-ruled intent resolves to identical physics with zero
// LLM calls.
export const SIMILARITY_SHORT_CIRCUIT = 0.92

// Impossible classes that depend on who asked (skills, inventory) must never
// become global precedent; only context-independent classes short-circuit.
const CONTEXT_INDEPENDENT_IMPOSSIBLE: ReadonlySet<string> = new Set(['physically_impossible', 'beyond_adjacency'])

// Invalid LLM verdicts (e.g. a map naming a verb that does not exist) get this
// many total tries before the diegetic fallback below.
const MAX_LLM_ATTEMPTS = 2

// Returned — never recorded — when every try was invalid, so a bad run can
// never become immutable precedent.
const FALLBACK_IMPOSSIBLE: Verdict = {
  kind: 'impossible',
  reason: 'no clear way to do this presents itself',
  class: 'physically_impossible',
}

// Canned diegetic line replacing an impossible reason that leaks the machinery.
const CLEAN_IMPOSSIBLE_REASON = 'nothing in the town lends itself to this'

// The human-framing law over live LLM output: an attempt whose world text
// names the machinery is invalid (retry); world text is checked before record.
function framingTainted(v: Verdict): boolean {
  if (v.kind !== 'attempt') return false
  const texts = [v.summary, v.recipe.name, ...v.recipe.outcomeTable.map((r) => r.label)]
  return texts.some((t) => FORBIDDEN_FRAMING.test(t))
}

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

  // Restart resilience: the rulebook is durable but the verb registry is
  // in-memory — re-register every active codified verb in deterministic order.
  for (const row of rulebook.allActive()) {
    if (!VERBS[row.verb]) registerVerb(verbFromRecipe(JSON.parse(row.recipeJson) as Recipe))
  }

  return {
    async adjudicate(intent, agentCtx) {
      // Stage 1 — deterministic rulebook lookup (exact normalized-name match).
      const hit = rulebook.lookup(intent)
      if (hit) return { kind: 'map', verb: hit.verb, params: {} }

      // Stages 2 and 3 share one retrieval: similar[0] serves the short-circuit,
      // the full list becomes the LLM's precedent block.
      const similar = await rulings.similar(intent, 5)

      // Stage 2 — deterministic rulings similarity short-circuit.
      const top = similar[0]
      if (top && top.cosine >= SIMILARITY_SHORT_CIRCUIT) {
        const stored = JSON.parse(top.ruling.verdictJson) as Verdict
        if (stored.kind === 'attempt') {
          const row = rulebook.byId(stored.recipe.id)
          if (row === null) return stored
          if (row.revertedAtTick === null) return { kind: 'map', verb: stored.recipe.id, params: {} }
          // Reverted → fall through to the LLM (the admin re-decides after revert).
        } else if (stored.kind === 'map') {
          if (stored.verb.startsWith('recipe:')) {
            const row = rulebook.byId(stored.verb)
            if (row !== null && row.revertedAtTick === null) return stored
            // Reverted or never-codified recipe verb → fall through to the LLM.
          } else if (VERBS[stored.verb]) {
            return stored
          }
          // Unregistered verb → fall through to the LLM.
        } else if (stored.kind === 'impossible') {
          if (CONTEXT_INDEPENDENT_IMPOSSIBLE.has(stored.class)) return stored
          // Contextual (insufficient_skill/materials) → fall through to the LLM,
          // which sees the asking agent's own skills and inventory.
        }
      }

      // Stage 3 — only genuinely novel intents reach the LLM.
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
      let value: Verdict | null = null
      for (let i = 0; i < MAX_LLM_ATTEMPTS && value === null; i++) {
        const r = await deps.llm.object({ schema: VerdictSchema, system, messages })
        // A map naming an unregistered verb is a hallucination — retry, never
        // return or record it (finding 8).
        if (r.value.kind === 'map' && !VERBS[r.value.verb]) continue
        // An attempt that leaks the machinery is invalid — retry (finding 12).
        if (framingTainted(r.value)) continue
        value = r.value
      }
      if (value === null) return FALLBACK_IMPOSSIBLE
      if (value.kind === 'impossible' && FORBIDDEN_FRAMING.test(value.reason)) {
        value = { ...value, reason: CLEAN_IMPOSSIBLE_REASON }
      }

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
