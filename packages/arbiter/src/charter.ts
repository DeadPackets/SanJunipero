import type { ClosedKey, DiscoveryCredit } from '@sj/shared'
import type { OutcomeRow, Recipe, RecipeRequirement } from './verdict.js'

// What a minted verb is, for the world and for the town: the physics the engine runs, the
// words a mind is shown, and who first put it into the valley. One row of the rulebook.
export type VerbCharter = {
  id: string
  name: string
  gloss: string
  reads: ClosedKey[]
  durationTicks: number
  energyCost: number
  requires: RecipeRequirement[]
  costs: { kind: string; qty: number }[]
  outcomes: OutcomeRow[]
  unlocks?: { id: string; name: string; prerequisiteId: string }
  inventor: { agentId: string; saying: string }
  skillCheck?: { track: string; difficulty: number }
  canon: string[]
}

export type AttemptVerdict = {
  recipe: Recipe
  summary: string
  unlocks?: { id: string; name: string; prerequisiteId: string }
}

// The roster line a charter becomes is capped at forty tokens, and the gloss is the part of
// it a model wrote.
export const GLOSS_MAX_CHARS = 90

export function capGloss(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= GLOSS_MAX_CHARS) return flat
  const cut = flat.lastIndexOf(' ', GLOSS_MAX_CHARS)
  return flat.slice(0, cut > 0 ? cut : GLOSS_MAX_CHARS)
}

export function charterFromAttempt(attempt: AttemptVerdict, credit: DiscoveryCredit): VerbCharter {
  const r = attempt.recipe
  return {
    id: r.id,
    name: r.name,
    gloss: capGloss(attempt.summary),
    reads: [],
    durationTicks: r.durationTicks,
    energyCost: 0,
    requires: r.requires,
    costs: r.costs,
    outcomes: r.outcomeTable,
    ...(attempt.unlocks === undefined ? {} : { unlocks: attempt.unlocks }),
    inventor: { agentId: credit.agentId, saying: credit.saying ?? '' },
    ...(r.skillCheck === undefined ? {} : { skillCheck: r.skillCheck }),
    canon: r.canon,
  }
}

export function isCharterRow(parsed: unknown): parsed is VerbCharter {
  const p = parsed as { outcomes?: unknown; inventor?: unknown } | null
  return Array.isArray(p?.outcomes) && typeof p.inventor === 'object' && p.inventor !== null
}
