import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { G3ReportSchema, checkG3Report, nightlyEditOutcomePasses, type G3Report } from './g3report.js'

// Re-asserts GATE G3's assertions 1–8 against the committed `data/g3-report.json`
// WITHOUT re-spending: the run script wrote the evidence, this test re-checks
// the evidence shape and thresholds. Run via `pnpm test:live` only.
const REPORT_PATH = new URL('../../data/g3-report.json', import.meta.url)

function loadReport(): G3Report {
  const raw = JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as unknown
  return G3ReportSchema.parse(raw)
}

describe('GATE G3 — committed run evidence', () => {
  it('has a schema-valid g3-report.json', () => {
    expect(() => loadReport()).not.toThrow()
  })

  it('re-asserts 1–8 against the committed evidence', () => {
    const report = loadReport()
    const checks = checkG3Report(report)

    expect(report.evidence.sleptCount, '1.sleeps/wakes').toBeGreaterThanOrEqual(2)
    expect(report.evidence.wokeCount, '1.sleeps/wakes').toBeGreaterThanOrEqual(2)

    expect(report.evidence.eatCompletedCount, '2.eats').toBeGreaterThanOrEqual(2)
    expect(report.evidence.deathPathReached, '2.eats').toBe(false)

    expect(report.evidence.maxConsecutiveActionStartedWithoutTurn, '3.plans').toBeGreaterThanOrEqual(2)

    expect(report.evidence.journalCount, '4.journals').toBeGreaterThanOrEqual(1)

    expect(report.evidence.dayNodeDays, '5.reflects').toEqual(expect.arrayContaining([0, 1]))
    expect(report.evidence.factCount, '5.reflects').toBeGreaterThanOrEqual(1)
    expect(report.evidence.autobiographyParagraphs, '5.reflects').toBe(2)
    const nightly = report.evidence.nightlyEditOutcomes.filter((o) => o.day === 0 || o.day === 1)
    expect(nightly, '5.reflects').toHaveLength(2)
    for (const o of nightly) {
      expect(nightlyEditOutcomePasses(o.outcome), `5.reflects night ${o.day}`).toBe(true)
    }

    expect(report.evidence.cacheReadConsecutivePairFound, '6.cacheReadTokens').toBe(true)
    expect(report.cacheHitRate, '6.cacheReadTokens').toBeGreaterThan(0)

    expect(report.evidence.recallVerbatimRowCount, '7.recall-verbatim').toBeGreaterThanOrEqual(1)

    expect(report.evidence.allLlmRowsHaveCost, '8.cost').toBe(true)
    expect(report.evidence.budgetTripped, '8.cost').toBe(false)
    expect(report.totalCostUsd, '8.cost').toBeLessThan(5)

    // Every programmatic assertion must independently pass its own check.
    expect(checks, JSON.stringify(checks)).toEqual({
      '1.sleeps-wakes': null,
      '2.eats': null,
      '3.plans': null,
      '4.journals': null,
      '5.reflects': null,
      '6.cacheReadTokens': null,
      '7.recall-verbatim': null,
      '8.cost': null,
    })
  })
})
