import { describe, expect, it } from 'vitest'
import { checkG9Report, g9GatePassed, type G9Report } from './g9report.js'

// A report that passes every criterion; each row below spoils exactly one.
function passingReport(evidence: Partial<G9Report['evidence']> = {}): G9Report {
  return {
    generatedAt: '2026-08-17T00:00:00.000Z',
    model: 'test-model',
    totalTicks: 5760,
    realMsPerTick: 250,
    capUsd: 8,
    expectedCallCostUsd: 0.01,
    totalCostUsd: 1.6,
    costByCaller: { turn: 1.6 },
    llmCallCount: 900,
    excerpts: { childThought: null, motherBirthLine: null, ownershipProse: null, witnessProse: null },
    evidence: {
      ticksRun: 5760,
      crashAlerts: 0,
      drainedIntents: 6,
      drainedAgainCount: 0,
      minds: [],
      child: {
        id: 'agent_31', registryName: 'Talia', socialName: 'Talia', bornTick: 1440, turns: 68,
        personaNamesBothParents: true, seedEntries: 20, seedAllPublic: true,
        motherBirthMemoryTick: 1440, motherTurnTickAfterBirth: 1877,
      },
      novelIntents: 6,
      codifiedVerbs: ['recipe:smoked_fish'],
      repeatIntent: 'I hang the fish in the smoke',
      repeatArbiterCalls: 0,
      unknownVerbRejections: 0,
      unknownVerbRefusalMemories: 0,
      adjudicationsAfterUnknownVerb: 0,
      reflectionsStarted: 18,
      reflectionsResolved: 18,
      reflectionFallbacks: 7,
      spendProjections: [
        { tick: 480, usdPerSimDay: 0.01, sampledCalls: 6 },
        { tick: 540, usdPerSimDay: 0.02, sampledCalls: 12 },
      ],
      forcedSpendAlert: true,
      spendAlertRows: 1,
      voice: [
        { agentId: 'ada', budgetTypical: 9, utterances: 20, meanWords: 3.1, medianWords: 2 },
        { agentId: 'cass', budgetTypical: 20, utterances: 20, meanWords: 15.2, medianWords: 16 },
      ],
      ownershipPhraseCount: 273,
      witnessProseCount: 0,
      theftCount: 0,
      adminPostStatus: 202,
      lawFlips: [{ tick: 1801, path: 'spoilage.enabled', value: false }],
      lawHistoryEntries: 2,
      finalLaws: {},
      replayHashMatches: true,
      ...evidence,
    },
  }
}

const KEY_4 = '4.novel-intent-route-fires-live'
const detail4 = (r: G9Report): string | null => {
  const checks = checkG9Report(r)
  return KEY_4 in checks ? checks[KEY_4] ?? null : 'the criterion is missing'
}

// §17.4 as the user restated it on 2026-08-17: the criterion measures whether the
// NOVEL-INTENT ROUTE fires live end-to-end, not whether a mind invents a verb
// *name*. Run 4 proved the old wording rewarded incoherence — a fed, articulate
// town uses `craft` and `build`, so it scored zero while proposing new physics.
describe('§17.4 restated — the novel-intent route fires live (user-approved 2026-08-17)', () => {
  it('passes on a live codification alone, with no unknown verb anywhere in the run', () => {
    expect(detail4(passingReport())).toBeNull()
  })

  it('passes on an unknown-verb routing that reached the arbiter, with nothing codified', () => {
    expect(detail4(passingReport({
      codifiedVerbs: [],
      unknownVerbRejections: 3,
      adjudicationsAfterUnknownVerb: 1,
    }))).toBeNull()
  })

  it('fails when nothing was codified and no rejection ever reached the arbiter', () => {
    expect(detail4(passingReport({ codifiedVerbs: [], adjudicationsAfterUnknownVerb: 0 })))
      .toMatch(/codified=none/)
  })

  it('does not score verb-spam: rejections that never routed are worth nothing', () => {
    expect(detail4(passingReport({
      codifiedVerbs: [],
      unknownVerbRejections: 40,
      adjudicationsAfterUnknownVerb: 0,
    }))).not.toBeNull()
  })

  it('still fails when the proposal died as refusal prose in a mind’s memory', () => {
    expect(detail4(passingReport({ unknownVerbRefusalMemories: 1 }))).toMatch(/refusalProse=1/)
  })
})

describe('the rest of the G9b criteria still bite', () => {
  it('the passing report passes all eight', () => {
    expect(g9GatePassed(passingReport())).toBe(true)
    expect(Object.keys(checkG9Report(passingReport()))).toHaveLength(8)
  })

  it('§17.3 still needs a codification and a free repeat', () => {
    const checks = checkG9Report(passingReport({ codifiedVerbs: [], adjudicationsAfterUnknownVerb: 1 }))
    expect(checks['3.codified-live-then-free']).toMatch(/codified=none/)
  })

  it('§17.3 fails on a repeat that spent an arbiter call', () => {
    expect(checkG9Report(passingReport({ repeatArbiterCalls: 1 }))['3.codified-live-then-free'])
      .toMatch(/repeatCalls=1/)
  })
})
