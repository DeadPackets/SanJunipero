import { z } from 'zod'
import { median } from './g11report.js'

// Shared schema for `data/g9-report.json`: the run script writes it and checks addendum §17's
// G9b criteria 1–8 against what it just ran. One module so the writer and the checker cannot
// drift apart.

export const MAX_MEAN_WORDS_PER_UTTERANCE = 35

export const G9MindSchema = z.object({
  agentId: z.string(),
  turns: z.number().int(),
  reflections: z.number().int(),
}).strict()

export const G9ChildSchema = z.object({
  id: z.string(),
  registryName: z.string(),
  socialName: z.string().nullable(),
  bornTick: z.number().int(),
  turns: z.number().int(),
  personaNamesBothParents: z.boolean(),
  seedEntries: z.number().int(),
  // Every seed entry traces to a public event id and none quotes a parent's private memory.
  seedAllPublic: z.boolean(),
  motherBirthMemoryTick: z.number().int().nullable(),
  motherTurnTickAfterBirth: z.number().int().nullable(),
}).strict()

export const G9VoiceSchema = z.object({
  agentId: z.string(),
  budgetTypical: z.number().int().nullable(),
  utterances: z.number().int(),
  meanWords: z.number(),
  medianWords: z.number(),
}).strict()

export const G9LawFlipSchema = z.object({
  tick: z.number().int(),
  path: z.string(),
  value: z.unknown(),
}).strict()

export const G9SpendProjectionSchema = z.object({
  tick: z.number().int(),
  usdPerSimDay: z.number(),
  sampledCalls: z.number().int(),
}).strict()

export const G9EvidenceSchema = z.object({
  // 1 — the run itself
  ticksRun: z.number().int(),
  crashAlerts: z.number().int(),
  drainedIntents: z.number().int(),
  drainedAgainCount: z.number().int(),
  minds: z.array(G9MindSchema),
  // 2 — the birth
  child: G9ChildSchema.nullable(),
  // 3 — live adjudication and codification
  novelIntents: z.number().int(),
  codifiedVerbs: z.array(z.string()),
  repeatIntent: z.string().nullable(),
  repeatArbiterCalls: z.number().int(),
  // 4 — unknown-verb routing
  unknownVerbRejections: z.number().int(),
  unknownVerbRefusalMemories: z.number().int(),
  adjudicationsAfterUnknownVerb: z.number().int(),
  // 5 — budget, reflections, spend alerting
  reflectionsStarted: z.number().int(),
  reflectionsResolved: z.number().int(),
  reflectionFallbacks: z.number().int(),
  spendProjections: z.array(G9SpendProjectionSchema),
  forcedSpendAlert: z.boolean(),
  spendAlertRows: z.number().int(),
  // 6 — voice
  voice: z.array(G9VoiceSchema),
  // 7 — ownership in the prose a mind actually read
  ownershipPhraseCount: z.number().int(),
  witnessProseCount: z.number().int(),
  theftCount: z.number().int(),
  // 8 — world laws live
  adminPostStatus: z.number().int().nullable(),
  lawFlips: z.array(G9LawFlipSchema),
  lawHistoryEntries: z.number().int(),
  finalLaws: z.record(z.string(), z.unknown()),
  replayHashMatches: z.boolean(),
}).strict()
export type G9Evidence = z.infer<typeof G9EvidenceSchema>

export const G9ReportSchema = z.object({
  generatedAt: z.string(),
  model: z.string(),
  totalTicks: z.number().int(),
  realMsPerTick: z.number(),
  capUsd: z.number(),
  expectedCallCostUsd: z.number(),
  totalCostUsd: z.number(),
  costByCaller: z.record(z.string(), z.number()),
  llmCallCount: z.number().int(),
  excerpts: z.object({
    childThought: z.string().nullable(),
    motherBirthLine: z.string().nullable(),
    ownershipProse: z.string().nullable(),
    witnessProse: z.string().nullable(),
  }).strict(),
  evidence: G9EvidenceSchema,
}).strict()
export type G9Report = z.infer<typeof G9ReportSchema>

export { median }

// Budgets differentiate when the tersest persona's median utterance is shorter
// than the most talkative one's. Both need something said to be comparable.
export function voiceOrdered(voice: G9Report['evidence']['voice']): string | null {
  const budgeted = voice.filter((v) => v.budgetTypical !== null && v.utterances > 0)
  if (budgeted.length < 2) return `only ${budgeted.length} budgeted personas spoke`
  const sorted = [...budgeted].sort((a, b) => a.budgetTypical! - b.budgetTypical!)
  const tersest = sorted[0]!
  const chattiest = sorted[sorted.length - 1]!
  return tersest.medianWords < chattiest.medianWords
    ? null
    : `${tersest.agentId} median ${tersest.medianWords} is not under ${chattiest.agentId}'s ${chattiest.medianWords}`
}

// The executable form of addendum §17's G9b list. A null detail means PASS.
export function checkG9Report(report: G9Report): Record<string, string | null> {
  const e = report.evidence
  const child = e.child
  return {
    '1.two-days-no-crash-drain-clean':
      e.ticksRun === report.totalTicks && e.crashAlerts === 0 && e.drainedAgainCount === 0
        ? null
        : `ticks=${e.ticksRun}/${report.totalTicks} crashes=${e.crashAlerts} leftAfterDrain=${e.drainedAgainCount}`,
    '2.child-mind-lives': child === null
      ? 'no child was born'
      : child.turns >= 5 && child.personaNamesBothParents && child.seedEntries >= 1 && child.seedAllPublic
        && child.socialName !== null && child.motherBirthMemoryTick !== null
        && child.motherTurnTickAfterBirth !== null && child.motherTurnTickAfterBirth > child.motherBirthMemoryTick
        ? null
        : `turns=${child.turns} parents=${child.personaNamesBothParents} seed=${child.seedEntries}/${child.seedAllPublic}`
          + ` social=${JSON.stringify(child.socialName)} birthMemory=${child.motherBirthMemoryTick} motherTurn=${child.motherTurnTickAfterBirth}`,
    '3.codified-live-then-free':
      e.codifiedVerbs.length >= 1 && e.repeatIntent !== null && e.repeatArbiterCalls === 0
        ? null
        : `codified=${e.codifiedVerbs.join(',') || 'none'} repeat=${JSON.stringify(e.repeatIntent)} repeatCalls=${e.repeatArbiterCalls}`,
    // §17.4 as the user restated it on 2026-08-17: the route has to fire live
    // end-to-end. A live codification is that route completing; an unknown verb
    // or recipe that reaches the arbiter is that route firing. A rejection that
    // never routed scores nothing, so verb-spam cannot buy the criterion.
    '4.novel-intent-route-fires-live': (() => {
      const fired = e.codifiedVerbs.length >= 1 || e.adjudicationsAfterUnknownVerb >= 1
      return fired && e.unknownVerbRefusalMemories === 0
        ? null
        : `codified=${e.codifiedVerbs.join(',') || 'none'} routed=${e.adjudicationsAfterUnknownVerb}`
          + ` rejections=${e.unknownVerbRejections} refusalProse=${e.unknownVerbRefusalMemories}`
    })(),
    '5.budget-reflections-alerting': (() => {
      const withinCap = report.totalCostUsd <= report.capUsd + report.expectedCallCostUsd
      const lost = e.reflectionsStarted - e.reflectionsResolved
      const projected = e.spendProjections.length >= 2
      return withinCap && lost === 0 && projected && e.forcedSpendAlert && e.spendAlertRows >= 1
        ? null
        : `total=$${report.totalCostUsd.toFixed(6)} cap=$${report.capUsd} lostReflections=${lost}`
          + ` projections=${e.spendProjections.length} forcedAlert=${e.forcedSpendAlert} alertRows=${e.spendAlertRows}`
    })(),
    '6.voice-budgets-bite': (() => {
      const loud = e.voice.filter((v) => v.meanWords > MAX_MEAN_WORDS_PER_UTTERANCE)
      if (loud.length > 0) return `over ${MAX_MEAN_WORDS_PER_UTTERANCE} words/utterance: ${loud.map((v) => `${v.agentId}=${v.meanWords.toFixed(1)}`).join(', ')}`
      return voiceOrdered(e.voice)
    })(),
    '7.ownership-reaches-the-prose':
      e.ownershipPhraseCount >= 1 && (e.theftCount === 0 || e.witnessProseCount >= 1)
        ? null
        : `ownershipPhrases=${e.ownershipPhraseCount} thefts=${e.theftCount} witnessProse=${e.witnessProseCount}`,
    '8.laws-flip-live-and-replay':
      e.adminPostStatus === 202 && e.lawFlips.length >= 1 && e.lawHistoryEntries >= 1 && e.replayHashMatches
        ? null
        : `adminStatus=${e.adminPostStatus} flips=${e.lawFlips.length} history=${e.lawHistoryEntries} replay=${e.replayHashMatches}`,
  }
}

export function g9GatePassed(report: G9Report): boolean {
  return Object.values(checkG9Report(report)).every((detail) => detail === null)
}
