import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  G9ReportSchema, checkG9Report, voiceOrdered, MAX_MEAN_WORDS_PER_UTTERANCE, type G9Report,
} from './g9report.js'

// Re-asserts GATE G9b (addendum §17) against the committed `data/g9-report.json`
// WITHOUT re-spending: the run script wrote the evidence, this test re-checks
// the shape and the thresholds. Run via `pnpm test:live` only.
const REPORT_PATH = new URL('../../data/g9-report.json', import.meta.url)

function loadReport(): G9Report {
  const raw = JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as unknown
  return G9ReportSchema.parse(raw)
}

describe('GATE G9b — committed run evidence', () => {
  it('has a schema-valid g9-report.json', () => {
    expect(() => loadReport()).not.toThrow()
  })

  it('re-asserts §17 criteria 1–8 against the committed evidence', () => {
    const report = loadReport()
    const e = report.evidence

    // 1. Two full sim-days at least, no crash, nothing left hanging on the bridge.
    expect(e.ticksRun, '1.run').toBe(report.totalTicks)
    expect(report.totalTicks, '1.run').toBeGreaterThanOrEqual(2 * 1440)
    expect(e.crashAlerts, '1.run').toBe(0)
    expect(e.drainedAgainCount, '1.run').toBe(0)

    // 2. The child is a mind, derived from both parents, seeded only from the public record.
    const child = e.child
    expect(child, '2.child').not.toBeNull()
    expect(child!.turns, '2.child').toBeGreaterThanOrEqual(5)
    expect(child!.personaNamesBothParents, '2.child').toBe(true)
    expect(child!.seedEntries, '2.child').toBeGreaterThanOrEqual(1)
    expect(child!.seedAllPublic, '2.child').toBe(true)
    expect(child!.socialName, '2.child').not.toBeNull()
    expect(child!.motherTurnTickAfterBirth, '2.child').toBeGreaterThan(child!.motherBirthMemoryTick!)

    // 3. Adjudicate once, physics forever.
    expect(e.codifiedVerbs.length, '3.codify').toBeGreaterThanOrEqual(1)
    expect(e.repeatArbiterCalls, '3.codify').toBe(0)

    // 4. The novel-intent route fires live, end to end (§17.4 restated, user
    // ruling 2026-08-17): a live codification is the route completing, an
    // unknown verb or recipe reaching the arbiter is the route firing. A
    // rejection that never routed buys nothing.
    expect(
      e.codifiedVerbs.length >= 1 || e.adjudicationsAfterUnknownVerb >= 1, '4.route',
    ).toBe(true)
    expect(e.unknownVerbRefusalMemories, '4.route').toBe(0)

    // 5. Budget held, no reflection lost, the operator was told about the burn.
    expect(report.totalCostUsd, '5.budget').toBeLessThanOrEqual(report.capUsd + report.expectedCallCostUsd)
    expect(e.reflectionsResolved, '5.budget').toBe(e.reflectionsStarted)
    expect(e.spendProjections.length, '5.budget').toBeGreaterThanOrEqual(2)
    expect(e.forcedSpendAlert, '5.budget').toBe(true)
    expect(e.spendAlertRows, '5.budget').toBeGreaterThanOrEqual(1)

    // 6. Nobody speechifies, and the budgets are visible in the medians.
    for (const v of e.voice) {
      expect(v.meanWords, `6.voice ${v.agentId}`).toBeLessThanOrEqual(MAX_MEAN_WORDS_PER_UTTERANCE)
    }
    expect(voiceOrdered(e.voice), '6.voice').toBeNull()

    // 7. Ownership reached the words a mind actually read.
    expect(e.ownershipPhraseCount, '7.ownership').toBeGreaterThanOrEqual(1)
    if (e.theftCount > 0) expect(e.witnessProseCount, '7.ownership').toBeGreaterThanOrEqual(1)

    // 8. The operator changed a law mid-run and the log still replays to the same world.
    expect(e.adminPostStatus, '8.laws').toBe(202)
    expect(e.lawFlips.length, '8.laws').toBeGreaterThanOrEqual(1)
    expect(e.lawHistoryEntries, '8.laws').toBeGreaterThanOrEqual(1)
    expect(e.replayHashMatches, '8.laws').toBe(true)

    // Every criterion must independently pass its own check.
    const checks = checkG9Report(report)
    expect(checks, JSON.stringify(checks, null, 2)).toEqual({
      '1.two-days-no-crash-drain-clean': null,
      '2.child-mind-lives': null,
      '3.codified-live-then-free': null,
      '4.novel-intent-route-fires-live': null,
      '5.budget-reflections-alerting': null,
      '6.voice-budgets-bite': null,
      '7.ownership-reaches-the-prose': null,
      '8.laws-flip-live-and-replay': null,
    })
  })
})
