import { z } from 'zod'
import type Database from 'better-sqlite3'
import { insertAlert, type LlmClient } from '@sj/llm'
import type { NarratorStore } from './store.js'
import type { Milestone } from './types.js'

// Tier 2.5 — the firsts no rule can catch. Every claim is checked back against the day's own
// words verbatim before it is allowed to be true.

export const SEMANTIC_CONCEPTS = [
  'god_afterlife',
  'fear_of_death',
  'love_expression',
  'justice_claim',
  'joke',
  'metaphor',
  'lie',
  'multi_day_plan',
  'past_reference',
] as const

// Narrator-side ops config, not world law (deviation 12): nothing here reaches physics, the
// hash or a prompt a mind reads.
export type SemanticConfig = {
  enabled: boolean
  concepts: readonly string[]
  minConfidence: number
  lieMinConfidence: number
  lieTopicWindowTicks: number
}

export const DEFAULT_SEMANTIC_CONFIG: SemanticConfig = {
  enabled: true,
  concepts: SEMANTIC_CONCEPTS,
  minConfidence: 0.8,
  lieMinConfidence: 0.9,
  lieTopicWindowTicks: 120,
}

export type TranscriptRecord = {
  sourceKind: 'speech' | 'thought' | 'journal'
  agentId: string
  day: number
  tick: number
  text: string
  eventSeq?: number
  memoryRef?: string
}

export type SemanticFirstRow = {
  conceptKind: string
  agentId: string
  day: number
  sourceKind: string
  eventSeq: number | null
  memoryRef: string | null
  quote: string
  quote2: string | null
  provenance2: string | null
  confidence: number
  rationale: string
}

export type SemanticCandidateRow = {
  conceptKind: string
  agentId: string
  day: number
  sourceKind: string
  quote: string
  confidence: number
  rationale: string
  // Why it is not a milestone. Every void has a name, so a night can be read back.
  reason: string
}

// The verdict shape, `.strict()`. A hit cites either a logged event or a remembered record —
// never neither, because a claim with no provenance cannot be checked.
const SemanticHitSchema = z
  .object({
    conceptKind: z.string().min(1),
    agentId: z.string().min(1),
    day: z.number().int().nonnegative(),
    sourceKind: z.enum(['speech', 'thought', 'journal']),
    eventSeq: z.number().int().nonnegative().optional(),
    memoryRef: z.string().min(1).optional(),
    quote: z.string().min(1),
    quote2: z.string().min(1).optional(),
    provenance2: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1),
  })
  .strict()
  .refine((h) => h.eventSeq !== undefined || h.memoryRef !== undefined, {
    message: 'a hit must cite an event or a remembered record',
  })
export const SemanticVerdictSchema = z.object({ hits: z.array(SemanticHitSchema) }).strict()
type SemanticHit = z.infer<typeof SemanticHitSchema>

// Every id the model must answer with is on the page in front of it (canon-vocabulary law),
// and so is the whole of the lie contract. This prompt is ops-side and no mind ever reads it.
const SEMANTIC_HEADER = `You read one day of a town's words: what people said aloud, what passed through their minds, and what they wrote in their own books. You are looking for the FIRST time each of these appears, and for nothing else. Answer with the id, exactly as written here:`

// Every id the model must answer with, with the plain sentence that says what it is. The pass
// renders only the ones still unfound, which is what makes the nightly cost decay to nothing.
const CONCEPT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  god_afterlife:
    'god_afterlife: speaking of gods, of the dead continuing, of anything beyond the world',
  fear_of_death: 'fear_of_death: naming death as a thing to be afraid of',
  love_expression: 'love_expression: saying love, in whatever words they have for it',
  justice_claim: 'justice_claim: claiming something is owed, deserved, or unfair',
  joke: 'joke: saying a thing for the laugh in it',
  metaphor: 'metaphor: not the plain thing, but one thing said as another',
  lie: 'lie: saying one thing while holding another — see the contract below',
  multi_day_plan: 'multi_day_plan: an intention reaching past today',
  past_reference: 'past_reference: telling something that happened before today',
}

const VERBATIM_RULE = `Every quote you give must be copied from the record VERBATIM, character for character, or the hit is thrown away unread. Quote the shortest passage that carries it.`

const LIE_CONTRACT = `The lie contract, and there is no lie without all of it:
1. Both sides quoted — the words said aloud AND that same person's own thought, memory or journal, each with its own provenance.
2. The same claim, not merely the same subject: the two must contradict on one thing about one entity.
3. The inner record must come before the words, or at the same moment. A thought that changes after speaking is a change of mind, and no lie.
4. Not irony, not politeness, not a joke; if the same words are a joke, they are not a lie.
5. Being wrong is not lying. Compare the person against themselves and never against what you know to be true; an honest error is honest.`

const CONFIDENCE_RULE =
  'Give a confidence between 0 and 1 for every hit, and one plain sentence of rationale.'

// The contract rides along only while a lie is still to be found — one more way the nightly
// prompt shrinks as the town's firsts land.
export function semanticInstruction(concepts: readonly string[]): string {
  const rows = concepts
    .map((c) => CONCEPT_DESCRIPTIONS[c])
    .filter((d): d is string => d !== undefined)
  const parts = [SEMANTIC_HEADER, rows.join('\n'), VERBATIM_RULE]
  if (concepts.includes('lie')) parts.push(LIE_CONTRACT)
  parts.push(CONFIDENCE_RULE)
  return parts.join('\n')
}

// The whole catalog, for the guard tests and for a reader.
export const SEMANTIC_INSTRUCTION = semanticInstruction(SEMANTIC_CONCEPTS)

function renderRecords(records: TranscriptRecord[]): string {
  return records
    .map((r) => {
      const ref = r.eventSeq !== undefined ? `eventSeq ${r.eventSeq}` : `memoryRef ${r.memoryRef}`
      return `[${r.sourceKind} | ${r.agentId} | tick ${r.tick} | ${ref}] ${r.text}`
    })
    .join('\n')
}

const findRecord = (records: TranscriptRecord[], hit: SemanticHit): TranscriptRecord | undefined =>
  records.find(
    (r) =>
      (hit.eventSeq !== undefined && r.eventSeq === hit.eventSeq) ||
      (hit.memoryRef !== undefined && r.memoryRef === hit.memoryRef),
  )

const findInner = (records: TranscriptRecord[], hit: SemanticHit): TranscriptRecord | undefined =>
  records.find((r) => r.memoryRef === hit.provenance2 || String(r.eventSeq) === hit.provenance2)

export type SemanticPassDeps = {
  db: Database.Database
  store: NarratorStore
  llm: LlmClient
  day: number
  records: TranscriptRecord[]
  config?: Partial<SemanticConfig>
}

// One batched pass per night, after the chapters. Cost decays toward nothing on its own: a
// concept already found is never scanned for again.
export async function detectSemanticFirsts(deps: SemanticPassDeps): Promise<Milestone[]> {
  const cfg: SemanticConfig = { ...DEFAULT_SEMANTIC_CONFIG, ...deps.config }
  if (!cfg.enabled) return []

  const found = deps.store.semanticFirstKinds()
  const remaining = cfg.concepts.filter((c) => !found.has(c))
  if (remaining.length === 0 || deps.records.length === 0) return []

  const system = semanticInstruction(remaining)
  // The generator throws on a verdict that does not fit the schema, so a second parse here is
  // unreachable. A night nobody can read has no semantic firsts, and it says so in an alert.
  let value: z.infer<typeof SemanticVerdictSchema>
  try {
    value = (
      await deps.llm.object({
        schema: SemanticVerdictSchema,
        system,
        messages: [{ role: 'user', content: renderRecords(deps.records) }],
      })
    ).value
  } catch (err) {
    insertAlert(deps.db, {
      agentId: null,
      kind: 'semantic_firsts_unreadable',
      detail: `day ${deps.day}: the verdict did not parse — ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
    })
    return []
  }
  const hits = value.hits

  // A joke and a lie cannot both be true of the same words (contract 4). Read the jokes
  // first, whatever confidence they carry, so the lie meets them already there.
  const jokedWords = new Set(hits.filter((h) => h.conceptKind === 'joke').map((h) => h.quote))

  const out: Milestone[] = []
  const accepted = new Set<string>()
  for (const hit of hits) {
    const void_ = (reason: string): void => {
      deps.store.insertSemanticCandidate({
        conceptKind: hit.conceptKind,
        agentId: hit.agentId,
        day: hit.day,
        sourceKind: hit.sourceKind,
        quote: hit.quote,
        confidence: hit.confidence,
        rationale: hit.rationale,
        reason,
      })
    }
    if (!remaining.includes(hit.conceptKind)) {
      void_('not_in_the_catalog')
      continue
    }

    const source = findRecord(deps.records, hit)
    if (!source?.text.includes(hit.quote)) {
      void_('quote_not_in_source')
      continue
    }
    if (source.agentId !== hit.agentId) {
      void_('quote_belongs_to_another_body')
      continue
    }

    const isLie = hit.conceptKind === 'lie'
    if (isLie) {
      if (jokedWords.has(hit.quote)) {
        void_('joke_on_the_same_words')
        continue
      }
      if (hit.quote2 === undefined || hit.provenance2 === undefined) {
        void_('one_sided_suspicion')
        continue
      }
      const inner = findInner(deps.records, hit)
      if (!inner?.text.includes(hit.quote2)) {
        void_('inner_quote_not_in_source')
        continue
      }
      if (inner.agentId !== hit.agentId) {
        void_('inner_record_belongs_to_another_body')
        continue
      }
      if (inner.tick > source.tick) {
        void_('inner_record_postdates_speech')
        continue
      }
      if (source.tick - inner.tick > cfg.lieTopicWindowTicks) {
        void_('sides_out_of_window')
        continue
      }
    }
    if (hit.confidence < (isLie ? cfg.lieMinConfidence : cfg.minConfidence)) {
      void_('below_confidence')
      continue
    }

    // Everything above is mechanical, so a bad second hit still says why it failed; a GOOD
    // second hit of a concept already taken tonight is simply a recurrence.
    if (accepted.has(hit.conceptKind)) continue
    accepted.add(hit.conceptKind)
    deps.store.insertSemanticFirst({
      conceptKind: hit.conceptKind,
      agentId: hit.agentId,
      day: hit.day,
      sourceKind: hit.sourceKind,
      eventSeq: hit.eventSeq ?? null,
      memoryRef: hit.memoryRef ?? null,
      quote: hit.quote,
      quote2: hit.quote2 ?? null,
      provenance2: hit.provenance2 ?? null,
      confidence: hit.confidence,
      rationale: hit.rationale,
    })
    out.push({
      kind: `first_${hit.conceptKind}`,
      tier: 2.5,
      domain: 'semantic',
      label: SEMANTIC_LABELS[hit.conceptKind] ?? 'the first of its kind',
      eventSeq: hit.eventSeq ?? 0,
      day: hit.day,
      tick: source.tick,
      agentIds: [hit.agentId],
    })
  }
  return out
}

// The human sentence for each, for a reader. Never the concept id, and never a number (G10).
const SEMANTIC_LABELS: Readonly<Record<string, string>> = {
  god_afterlife: 'the first talk of what comes after',
  fear_of_death: 'the first time dying was named as a fear',
  love_expression: 'the first time love was said out loud',
  justice_claim: 'the first claim that something was owed',
  joke: 'the first joke',
  metaphor: 'the first thing said as another thing',
  lie: 'the first time one of them said one thing and thought another',
  multi_day_plan: 'the first plan reaching past today',
  past_reference: 'the first time somebody told what had happened before',
}
