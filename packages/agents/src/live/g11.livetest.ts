import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  G11ReportSchema, G11_MIN_SIM_DAYS, checkG11Report, chronicleViolations, survivalTax,
  type G11Report,
} from './g11report.js'

// Re-asserts GATE G11b (deep-world addendum §18, plus the batch-10 brief's binding additions)
// against the committed `data/g11-report.json` WITHOUT re-spending: the run script wrote the
// evidence, this test re-checks the shape and the thresholds. Run via `pnpm test:live` only.
const REPORT_PATH = new URL('../../data/g11-report.json', import.meta.url)

function loadReport(): G11Report {
  return G11ReportSchema.parse(JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as unknown)
}

describe('GATE G11b — committed run evidence', () => {
  it('has a schema-valid g11-report.json', () => {
    expect(() => loadReport()).not.toThrow()
  })

  it('re-asserts §18 criteria 1–11 against the committed evidence', () => {
    const report = loadReport()
    const e = report.evidence

    // 1. Two full sim-days on the 128x128 town, no crash, nothing hanging, budget held.
    expect(report.totalTicks / 1440, '1.run').toBeGreaterThanOrEqual(G11_MIN_SIM_DAYS)
    expect(e.ticksRun, '1.run').toBe(report.totalTicks)
    expect(e.crashAlerts, '1.run').toBe(0)
    expect(e.drainedAgainCount, '1.run').toBe(0)
    expect(e.overBudgetTicks, '1.run').toBe(0)
    expect(report.measurements.mapWidth, '1.run').toBeGreaterThanOrEqual(128)

    // 2–3. A body that drank because it was thirsty, and food gathered that got eaten.
    expect(e.unpromptedDrinks, '2.thirst').toBeGreaterThanOrEqual(1)
    expect(e.foodGathered, '3.food').toBeGreaterThanOrEqual(1)
    expect(e.gatheredFoodEaten, '3.food').toBeGreaterThanOrEqual(1)

    // 4. The seeded illness drew a visible response. Recovery and death both pass.
    expect(e.stagedAfflictionAgentId, '4.sickness').not.toBeNull()
    expect(e.stagedAfflictionResponses.length, '4.sickness').toBeGreaterThanOrEqual(1)

    // 5. The chronicle over every C11 event that fired names no mechanism, number or machinery.
    expect(e.chronicleLines, '5.chronicle').toBeGreaterThanOrEqual(1)
    expect(e.chronicleViolations, '5.chronicle').toEqual([])
    if (report.excerpts.chronicleLine !== null) {
      expect(chronicleViolations([report.excerpts.chronicleLine]), '5.chronicle').toEqual([])
    }

    // 6. Feet wore a trail on a route feet actually took.
    expect(e.tilesWorn, '6.trails').toBeGreaterThanOrEqual(1)

    // 7. Every C11 flag is an operator's to move; one was moved and the log still replays.
    expect(e.worldLawPaths.length, '7.laws').toBeGreaterThanOrEqual(14)
    expect(e.lawFlips.length, '7.laws').toBeGreaterThanOrEqual(1)
    expect(e.lawHistoryEntries, '7.laws').toBeGreaterThanOrEqual(1)
    expect(e.replayHashMatches, '7.laws').toBe(true)

    // 8. No cap by ruling; nothing lost, and a burn that bought nothing was reported.
    expect(e.reflectionsResolved, '8.spend').toBe(e.reflectionsStarted)
    expect(report.spend.llmCallCount, '8.spend').toBeGreaterThanOrEqual(1)
    if (e.deadCalls.calls > 0) expect(e.deadCallAlertRows, '8.spend').toBeGreaterThanOrEqual(1)

    // 9. A word bought once and used by somebody else for nothing; the pass ran; the ledger has firsts.
    expect(e.constructs.expressiveVerbs.length, '9.constructs').toBeGreaterThanOrEqual(1)
    expect(e.constructs.reusedBy, '9.constructs').not.toBeNull()
    expect(e.constructs.reusedBy, '9.constructs').not.toBe(e.constructs.firstExpressiveBy)
    expect(e.constructs.reuseArbiterCalls, '9.constructs').toBe(0)
    expect(e.constructs.passRan, '9.constructs').toBe(true)
    expect(e.constructs.passErrors, '9.constructs').toBe(0)
    if (e.constructs.recognized > 0) expect(e.constructs.namingLawHolds, '9.constructs').toBe(true)
    expect(e.tier1Milestones.length, '9.constructs').toBeGreaterThanOrEqual(1)

    // 10–11. A night somebody stood in, and the nightly semantic pass.
    expect(e.darkPerceptions, '10.night').toBeGreaterThanOrEqual(1)
    expect(e.semanticPassRan, '11.semantic').toBe(true)
    expect(e.semanticPassErrors, '11.semantic').toBe(0)

    // The brief's binding additions.
    expect(Object.values(report.opsPlane), 'A.ops').toEqual(Array(5).fill('wired'))
    expect(report.measurements.snapshotBytes, 'B.measure').toBeGreaterThan(0)
    expect(report.measurements.trafficKeys, 'B.measure').toBeGreaterThan(0)
    expect(e.fordBridge.buildable, 'C.ford').toBe(true)
    expect(e.farBankWalk.stoppedAtWaterEdge, 'D.far bank').toBe(true)
    expect(e.clothedSurviveLadder, 'E.ladder').toBe(true)
    expect(e.discretion.length, 'F.discretion').toBeGreaterThanOrEqual(1)
    // Reported, never gated (controller ruling 2026-08-17): the number is read, not thresholded.
    expect(survivalTax(e.discretion), 'F.discretion').toBeGreaterThanOrEqual(0)

    // Every criterion must independently pass its own check.
    const checks = checkG11Report(report)
    const failed = Object.entries(checks).filter(([, d]) => d !== null)
    expect(failed, JSON.stringify(checks, null, 2)).toEqual([])
  })
})
