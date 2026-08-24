import { z } from 'zod'

// Shared schema for `data/g3-report.json`: the run script writes it and checks 1–8 against
// what it just ran. Keeping the shape in one module stops the writer and the checker from
// drifting apart.

export const G3NightlyEditOutcomeSchema = z.object({
  day: z.number().int(),
  // pass: 'applied' | 'rejected:<reason>' | 'no_proposal'
  // fail: 'missing' | 'unadjudicated' | 'failed:<msg>'
  outcome: z.string().min(1),
}).strict()
export type G3NightlyEditOutcome = z.infer<typeof G3NightlyEditOutcomeSchema>

// What the harness observed of the proposeEdit call itself for one night.
export type ProposeEditRecord = 'no_proposal' | 'proposed' | `failed:${string}`

// Controller ruling (run 6): the spec's "≤1 personality edit via drift-limiter"
// makes zero edits compliant — a night passes when proposeEdit ran and returned
// a schema-valid verdict: an adjudicated proposal (applied/rejected) or an
// explicit no_proposal.
export function resolveNightlyEditOutcome(
  proposeEdit: ProposeEditRecord | undefined,
  adjudication: string | undefined,
): string {
  if (adjudication !== undefined) return adjudication
  if (proposeEdit === undefined) return 'missing'
  if (proposeEdit === 'proposed') return 'unadjudicated'
  return proposeEdit
}

export function nightlyEditOutcomePasses(outcome: string): boolean {
  return outcome === 'applied' || outcome.startsWith('rejected:') || outcome === 'no_proposal'
}

export const G3EvidenceSchema = z
  .object({
    sleptCount: z.number().int(),
    wokeCount: z.number().int(),
    eatCompletedCount: z.number().int(),
    deathPathReached: z.boolean(),
    finalHunger: z.number(),
    maxConsecutiveActionStartedWithoutTurn: z.number().int(),
    journalCount: z.number().int(),
    dayNodeDays: z.array(z.number().int()),
    factCount: z.number().int(),
    autobiographyParagraphs: z.number().int(),
    nightlyEditOutcomes: z.array(G3NightlyEditOutcomeSchema),
    cacheReadConsecutivePairFound: z.boolean(),
    recallVerbatimRowCount: z.number().int(),
    allLlmRowsHaveCost: z.boolean(),
    budgetTripped: z.boolean(),
  })
  .strict()
export type G3Evidence = z.infer<typeof G3EvidenceSchema>

export const G3ReportSchema = z
  .object({
    generatedAt: z.string(),
    agentId: z.string(),
    model: z.string(),
    totalTicks: z.number().int(),
    realMsPerTick: z.number(),
    totalCostUsd: z.number(),
    costByCaller: z.record(z.string(), z.number()),
    cacheHitRate: z.number(), // cache_read_tokens / input_tokens over all 'turn' calls, 0..1
    llmCallCount: z.number().int(),
    excerpts: z.object({ thought: z.string(), speech: z.string().nullable() }).strict(),
    evidence: G3EvidenceSchema,
  })
  .strict()
export type G3Report = z.infer<typeof G3ReportSchema>

// The executable form of the roadmap gate, assertions 1–8 (assertion 9 is the
// `pnpm test && pnpm typecheck` run). Returns a map of assertion name -> detail;
// a null detail means PASS.
export function checkG3Report(report: G3Report): Record<string, string | null> {
  const e = report.evidence
  const out: Record<string, string | null> = {
    '1.sleeps-wakes': e.sleptCount >= 2 && e.wokeCount >= 2 ? null : `slept=${e.sleptCount} woke=${e.wokeCount}`,
    '2.eats': e.eatCompletedCount >= 2 && !e.deathPathReached
      ? null
      : `eats=${e.eatCompletedCount} deathPath=${e.deathPathReached}`,
    '3.plans': e.maxConsecutiveActionStartedWithoutTurn >= 2 ? null : `maxConsecutive=${e.maxConsecutiveActionStartedWithoutTurn}`,
    '4.journals': e.journalCount >= 1 ? null : `journalCount=${e.journalCount}`,
    '5.reflects': (() => {
      const hasDay0 = e.dayNodeDays.includes(0)
      const hasDay1 = e.dayNodeDays.includes(1)
      const facts = e.factCount >= 1
      const auto = e.autobiographyParagraphs === 2
      const edits = e.nightlyEditOutcomes.filter((o) => o.day === 0 || o.day === 1)
      const bothResolved = edits.length === 2 && edits.every((o) => nightlyEditOutcomePasses(o.outcome))
      return hasDay0 && hasDay1 && facts && auto && bothResolved
        ? null
        : `days=${e.dayNodeDays.join(',')} facts=${e.factCount} auto=${e.autobiographyParagraphs} edits=${JSON.stringify(e.nightlyEditOutcomes)}`
    })(),
    '6.cacheReadTokens': e.cacheReadConsecutivePairFound ? null : 'no consecutive pair with cache_read_tokens > 0',
    '7.recall-verbatim': e.recallVerbatimRowCount >= 1 ? null : `verbatimRows=${e.recallVerbatimRowCount}`,
    '8.cost': e.allLlmRowsHaveCost && !e.budgetTripped && report.totalCostUsd < 5
      ? null
      : `allHaveCost=${e.allLlmRowsHaveCost} budgetTripped=${e.budgetTripped} total=$${report.totalCostUsd.toFixed(6)}`,
  }
  return out
}

export function g3GatePassed(report: G3Report): boolean {
  return Object.values(checkG3Report(report)).every((detail) => detail === null)
}
