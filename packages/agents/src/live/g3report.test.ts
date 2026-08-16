import { describe, expect, it } from 'vitest'
import {
  checkG3Report,
  nightlyEditOutcomePasses,
  resolveNightlyEditOutcome,
  type G3NightlyEditOutcome,
  type G3Report,
} from './g3report.js'

function reportWith(nightlyEditOutcomes: G3NightlyEditOutcome[]): G3Report {
  return {
    generatedAt: '2026-08-15T00:00:00.000Z',
    agentId: 'tamar',
    model: 'test-model',
    totalTicks: 2880,
    realMsPerTick: 250,
    totalCostUsd: 0.01,
    costByCaller: { turn: 0.01 },
    cacheHitRate: 0.5,
    llmCallCount: 100,
    excerpts: { thought: 'a thought', speech: null },
    evidence: {
      sleptCount: 2,
      wokeCount: 2,
      eatCompletedCount: 2,
      deathPathReached: false,
      finalHunger: 80,
      maxConsecutiveActionStartedWithoutTurn: 3,
      journalCount: 2,
      dayNodeDays: [0, 1],
      factCount: 4,
      autobiographyParagraphs: 2,
      nightlyEditOutcomes,
      cacheReadConsecutivePairFound: true,
      recallVerbatimRowCount: 1,
      allLlmRowsHaveCost: true,
      budgetTripped: false,
    },
  }
}

describe('resolveNightlyEditOutcome', () => {
  it('returns the drift-limiter adjudication when one exists', () => {
    expect(resolveNightlyEditOutcome('proposed', 'applied')).toBe('applied')
    expect(resolveNightlyEditOutcome('proposed', 'rejected:too_many_edits')).toBe('rejected:too_many_edits')
  })

  it('returns no_proposal for an explicit schema-valid no_proposal verdict', () => {
    expect(resolveNightlyEditOutcome('no_proposal', undefined)).toBe('no_proposal')
  })

  it('returns missing when proposeEdit never ran', () => {
    expect(resolveNightlyEditOutcome(undefined, undefined)).toBe('missing')
  })

  it('returns unadjudicated for a proposal the drift-limiter never saw', () => {
    expect(resolveNightlyEditOutcome('proposed', undefined)).toBe('unadjudicated')
  })

  it('passes through a failed call (schema-invalid or transport)', () => {
    expect(resolveNightlyEditOutcome('failed:schema-invalid output', undefined)).toBe('failed:schema-invalid output')
  })
})

describe('nightlyEditOutcomePasses (controller ruling: zero edits is compliant)', () => {
  it.each(['applied', 'rejected:drift', 'no_proposal'])('passes %s', (o) => {
    expect(nightlyEditOutcomePasses(o)).toBe(true)
  })

  it.each(['missing', 'unadjudicated', 'failed:schema-invalid output'])('fails %s', (o) => {
    expect(nightlyEditOutcomePasses(o)).toBe(false)
  })
})

describe('checkG3Report assertion 5 — fabricated reflection outcomes', () => {
  it('passes with an applied edit one night and an explicit no_proposal the other', () => {
    const report = reportWith([
      { day: 0, outcome: 'applied' },
      { day: 1, outcome: 'no_proposal' },
    ])
    expect(checkG3Report(report)['5.reflects']).toBeNull()
  })

  it('passes with explicit no_proposal on both nights', () => {
    const report = reportWith([
      { day: 0, outcome: 'no_proposal' },
      { day: 1, outcome: 'no_proposal' },
    ])
    expect(checkG3Report(report)['5.reflects']).toBeNull()
  })

  it('fails when a night produced schema-invalid proposeEdit output', () => {
    const report = reportWith([
      { day: 0, outcome: 'applied' },
      { day: 1, outcome: 'failed:schema-invalid output' },
    ])
    expect(checkG3Report(report)['5.reflects']).not.toBeNull()
  })

  it('fails when a night is missing its proposeEdit call', () => {
    const report = reportWith([
      { day: 0, outcome: 'no_proposal' },
      { day: 1, outcome: 'missing' },
    ])
    expect(checkG3Report(report)['5.reflects']).not.toBeNull()
  })

  it('fails when a proposal was never adjudicated by the drift-limiter', () => {
    const report = reportWith([
      { day: 0, outcome: 'unadjudicated' },
      { day: 1, outcome: 'no_proposal' },
    ])
    expect(checkG3Report(report)['5.reflects']).not.toBeNull()
  })
})
