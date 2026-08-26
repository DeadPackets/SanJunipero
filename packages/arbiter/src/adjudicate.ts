import type Database from 'better-sqlite3'
import { scanRulingForGlassLeak, type LlmClient } from '@sj/agents'
import { registerVerb, VERBS } from '@sj/engine'
import type { DiscoveryCredit, DiscoveryKind } from '@sj/shared'
import { CANON } from './canon.js'
import { CodexStore } from './codex.js'
import { codify as codifyRecipe, verbFromRecipe } from './codify.js'
import {
  assembleExpressivePrompt, ExpressiveRulingSchema, expressiveRow, expressiveVerbFromRuling,
  isExpressive, isExpressiveRow, type ExpressiveRuling,
} from './expressive.js'
import { assembleAdjudicationPrompt, FORBIDDEN_FRAMING } from './prompt.js'
import { recipeSanityRefusal, type RecipeVocabulary } from './sanity.js'
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

// ★ THE CONTENTLESS REFUSAL, AND WHERE THE GLASS LINE IS DRAWN.
//
// Returned — never recorded — when every try was invalid, so a bad run can never become
// immutable precedent. The live proof caught what that costs: Amara reached the same idea three
// times in 34 ticks, because `no clear way to do this presents itself` told her nothing she
// could act on. Every novel intent therefore cost up to 3x, in money and in her own attention.
//
// The trap is that this string is MIND-FACING — `refusalMemoryText` writes it verbatim into a
// memory the next prompt reads back — so the glass forbids naming the fix. The line this lane
// draws, and argues for:
//
//   A REFUSAL MAY NAME THE ATTEMPT AND THE MIND'S OWN HISTORY. IT MAY NEVER NAME THE ACT THAT
//   WOULD HAVE WORKED.
//
//   safe and useless   "no clear way to do this presents itself" — true, and unactionable
//   safe and learnable "it will not come together as it stands" — says the attempt was
//                      understood and did not hold, so trying the identical thing again is
//                      not new information. Names nothing absent and no next step.
//   NOT ALLOWED        "you cannot smoke fish without a rack" — hands over the solution and
//                      poisons every emergence measurement C8 exists to take.
//
// ★ THE CLASS STAYS `physically_impossible`, AND THAT IS A DELIBERATE NON-CHANGE. The honest
// cause here is "no method could be formed", and there is no class for it — but
// `ImpossibleClassSchema` is the MODEL'S answer space, handed to it as structured output, so a
// fifth option called `no_method_found` is an easy out the model can take on any hard intent.
// Buying an accurate label for our own fallback by widening the model's choices is a bad trade.
// The class is inert either way: the fallback is returned and never recorded, so
// `CONTEXT_INDEPENDENT_IMPOSSIBLE` never reads it, and the only live consumer is `CRAFT_HINT`.
//
// ★ IT DOES NOT EARN `CRAFT_HINT`. "Perhaps someone nearby knows the craft" asserts that
// somebody knows — a fact we do not have when the god could not form an answer at all. A door
// that may open onto nothing is a path invented for the mind, which is the thing this comment
// is about.
export const FALLBACK_IMPOSSIBLE: Verdict = {
  kind: 'impossible',
  reason: 'you turn it over and it will not come together as it stands',
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

// The other half of the same law. `framingTainted` only ever sees an `attempt`, so the coined
// word — which becomes a permanent verb AND an agent-visible chronicle line — went unchecked.
// The glass scan is the wider half: `FORBIDDEN_FRAMING` names the machinery BEHIND the mind
// and not one of `festival`, `faith`, `council`, `market` or `custom` is in it, so a coined
// word could have minted the town a permanent verb for the concept it is being watched to
// reach on its own.
export function wordTainted(word: string): boolean {
  return FORBIDDEN_FRAMING.test(word) || scanRulingForGlassLeak(word).length > 0
}

// A refusal is the one arbiter output written verbatim into a mind's memory
// (`refusalMemoryText`), so it is scanned on the wider roster and for directives too. Replaced
// rather than retried: a retry can end at `FALLBACK_IMPOSSIBLE` and lose the true reason,
// where a swap keeps the verdict and only loses the words.
function reasonTainted(reason: string): boolean {
  return FORBIDDEN_FRAMING.test(reason) || scanRulingForGlassLeak(reason).length > 0
}

export type AgentCtx = {
  agentId: string
  name: string
  skills: Record<string, number>
  inventory: Array<{ kind: string; qty: number }>
  position: { x: number; y: number }
  // What the asker can see. Absent from a caller that projects no world — and then the
  // arbiter judges as it always did, on the asker alone.
  visible?: {
    structures: Array<{ kind: string; x: number; y: number }>
    ground: string[]
  }
  // The asker's own sentence behind the ask. Threaded to the prompt, never to a precedent key.
  saying?: string
}

// What a codification just minted. Fired once, on the first insert, from BOTH paths — the
// recipe half and the coined-word half (F-B). The runner turns it into a world event.
export type Codified = {
  recipeId: string
  name: string
  kind: DiscoveryKind
  makes: string[]
  credit: DiscoveryCredit
}

export type ArbiterDeps = {
  db: Database.Database
  llm: LlmClient
  embedder: { embed(t: string): Promise<Float32Array> }
  tick?: () => number
  // The materials and buildings the town has words for. Rendered into the prompt AND enforced
  // against the answer, so the two can never disagree (canon-vocabulary law). A caller that
  // shows no table gets the checks that need no table; the rest wait for one.
  vocabulary?: { itemKinds: readonly string[]; structureKinds: readonly string[] }
  // Told what was just minted, so a caller that owns a world can put it in the record. The
  // arbiter itself never touches the world log — it does not have one.
  onCodified?: (d: Codified) => void
}

export type Arbiter = {
  adjudicate(intent: string, agentCtx: AgentCtx): Promise<Verdict>
  codify(recipe: Recipe, credit: DiscoveryCredit): { ruleId: number; verb: string }
  // Why this recipe may never become a verb, or null. The same gate adjudicate applies,
  // exposed so an operator queue can say what it refused and why.
  sanity(recipe: Recipe, agentCtx: AgentCtx): string | null
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
    if (VERBS[row.verb]) continue
    const parsed: unknown = JSON.parse(row.recipeJson)
    registerVerb(isExpressiveRow(parsed)
      ? expressiveVerbFromRuling(parsed.name, parsed)
      : verbFromRecipe(parsed as Recipe))
  }

  // The cheap approval: a word for an act that changes nothing. One small call, one rulebook
  // row, and thereafter the whole town has the verb for free.
  function codifyExpressive(ruling: ExpressiveRuling, tick: number, credit: DiscoveryCredit): string {
    const row = expressiveRow(ruling)
    const existing = rulebook.byId(row.id)
    if (existing !== null && existing.revertedAtTick === null) return row.id
    if (existing !== null) {
      rulebook.reactivate(row, tick)
      if (!VERBS[row.id]) registerVerb(expressiveVerbFromRuling(row.name, row))
      review.queue(existing.id, row.id, tick)
      return row.id
    }
    const ruleId = rulebook.insert(row, tick)
    if (!VERBS[row.id]) registerVerb(expressiveVerbFromRuling(row.name, row))
    review.queue(ruleId, row.id, tick)
    // F-B: the coined word is the second codification path and it reports too. A record that
    // hooked only codify() would leave the town inventing a name for dancing with no trace.
    deps.onCodified?.({ recipeId: row.id, name: row.name, kind: 'word', makes: [], credit })
    return row.id
  }

  // What the rulebook already makes, read fresh each time: a second waterskin is only a
  // second one against the first, and the first may have been codified a minute ago.
  function codifiedVocabulary(agentCtx: AgentCtx): RecipeVocabulary {
    const knownProducts = new Set<string>()
    const knownRecipeIds = new Set<string>()
    for (const row of rulebook.allActive()) {
      knownRecipeIds.add(row.recipeId)
      const parsed: unknown = JSON.parse(row.recipeJson)
      if (isExpressiveRow(parsed)) continue
      for (const r of (parsed as Recipe).outcomeTable) {
        for (const e of r.effects) if (e.op === 'spawn_item') knownProducts.add(e.kind)
      }
    }
    const shown = deps.vocabulary
    return {
      // Shown is enforced: the ground rides the asker block, so it is checked whenever the
      // asker block carries it, table or no table.
      ...(agentCtx.visible === undefined ? {} : { tileKinds: new Set(agentCtx.visible.ground) }),
      ...(shown === undefined
        ? {}
        : {
            itemKinds: new Set([...shown.itemKinds, ...agentCtx.inventory.map((i) => i.kind), ...knownProducts]),
            // A building the asker is looking at is a building the ruling may name, whether or
            // not the town knows how to raise one — the live run denied its own well.
            structureKinds: new Set([
              ...shown.structureKinds,
              ...(agentCtx.visible?.structures ?? []).map((s) => s.kind),
            ]),
          }),
      knownProducts,
      knownRecipeIds,
    }
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

      // Stage 2b — an act with nothing to adjudicate. It skips the recipe prompt entirely:
      // one small call names it, and a ruling nobody can parse falls through to the full path.
      if (isExpressive(intent)) {
        const cheap = assembleExpressivePrompt({ canon: CANON, agent: agentCtx, intent })
        const r = await deps.llm.object({ schema: ExpressiveRulingSchema, ...cheap })
        const ruling = ExpressiveRulingSchema.safeParse(r.value)
        if (ruling.success && !wordTainted(ruling.data.word)) {
          const verdict: Verdict = {
            kind: 'map',
            verb: codifyExpressive(ruling.data, tick(), { agentId: agentCtx.agentId, intent }),
            params: {},
          }
          await rulings.record(intent, verdict, tick())
          return verdict
        }
      }

      // Stage 3 — only genuinely novel intents reach the LLM.
      const precedent = similar.map(({ ruling }) => {
        const v = JSON.parse(ruling.verdictJson) as Verdict
        if (v.kind === 'attempt') return { summary: v.summary, verdictKind: 'attempt', recipeName: v.recipe.name } as const
        if (v.kind === 'impossible') return { summary: v.reason, verdictKind: 'impossible' } as const
        return { summary: v.verb, verdictKind: 'map' } as const
      })
      const vocab = codifiedVocabulary(agentCtx)
      const { system, messages } = assembleAdjudicationPrompt({
        canon: `${CANON}\n\nThe town currently knows: ${codex.known().join(', ')}`,
        // Without the frontier the model cannot tell an unearned rung one step
        // out from a craft the town wholly lacks (C9 batch-10, user ruling 1).
        frontier: codex.frontier(),
        agent: agentCtx,
        precedent,
        intent,
        ...(deps.vocabulary === undefined ? {} : { materials: deps.vocabulary }),
      })
      let value: Verdict | null = null
      for (let i = 0; i < MAX_LLM_ATTEMPTS && value === null; i++) {
        const r = await deps.llm.object({ schema: VerdictSchema, system, messages })
        // A map naming an unregistered verb is a hallucination — retry, never
        // return or record it (finding 8).
        if (r.value.kind === 'map' && !VERBS[r.value.verb]) continue
        // An attempt that leaks the machinery is invalid — retry (finding 12).
        if (framingTainted(r.value)) continue
        // A recipe that cannot stand as a permanent verb is invalid — retry. Codification is
        // forever, and the mini-rehearsal proved a bad one is minted in silence otherwise.
        if (r.value.kind === 'attempt' && recipeSanityRefusal(r.value.recipe, vocab) !== null) continue
        value = r.value
      }
      if (value === null) return FALLBACK_IMPOSSIBLE
      if (value.kind === 'impossible' && reasonTainted(value.reason)) {
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

    codify(recipe, credit) {
      return codifyRecipe(recipe, credit, {
        rulebook, review, codex, tick: tick(),
        ...(deps.onCodified === undefined ? {} : { onCodified: deps.onCodified }),
      })
    },

    sanity(recipe, agentCtx) {
      return recipeSanityRefusal(recipe, codifiedVocabulary(agentCtx))
    },

    revert(recipeId, reason) {
      review.revertByRecipe(recipeId, reason, tick())
    },
  }
}
