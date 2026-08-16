import { describe, it, expect } from 'vitest'
import {
  CRITERIA, HARD_FAIL_CRITERIA, VisionCriteriaSchema, VisionVerdictSchema,
  NA_CRITERIA_BY_CLASS, NA_CRITERION, deriveOverall, type VisionCriteria,
} from './verdict.js'

function crit(score = 10, pass = true) { return { pass, score, evidence: 'looks right' } }
function all(score = 10): VisionCriteria {
  return Object.fromEntries(CRITERIA.map(k => [k, crit(score)])) as VisionCriteria
}
const OPTS = { minScore: 7, attempt: 1, maxRetries: 3 }

describe('vision verdict schema', () => {
  it('round-trips a full valid verdict deep-equal', () => {
    const v = {
      assetId: 'asset_1', model: 'google/gemini-3.7-flash', rubricVersion: 'v1',
      criteria: all(9), overall: 'pass' as const, feedback: '',
    }
    const parsed = VisionVerdictSchema.parse(v)
    expect(parsed).toEqual(v)
    expect(VisionVerdictSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(v)
  })

  it('rejects an extra key, a score above 10, and empty evidence', () => {
    expect(() => VisionCriteriaSchema.parse({ ...all(), extra: crit() })).toThrow()
    expect(() => VisionCriteriaSchema.parse({ ...all(), palette: crit(11) })).toThrow()
    expect(() => VisionCriteriaSchema.parse({ ...all(), palette: { pass: true, score: 8, evidence: '' } })).toThrow()
    expect(() => VisionCriteriaSchema.parse({ ...all(), palette: undefined })).toThrow()
  })

  it('declares seven criteria with the two binary hard fails', () => {
    expect(CRITERIA).toEqual(['palette', 'singleFigure', 'transparency', 'proportion', 'facing', 'density', 'alignment'])
    expect(HARD_FAIL_CRITERIA).toEqual(['singleFigure', 'transparency'])
    for (const na of Object.values(NA_CRITERIA_BY_CLASS))
      for (const k of na) expect(CRITERIA).toContain(k)
  })
})

describe('deriveOverall', () => {
  it('all tens pass', () => {
    expect(deriveOverall(all(10), OPTS)).toBe('pass')
  })

  it('a hard-fail beats a passing score', () => {
    const c = { ...all(10), singleFigure: { pass: false, score: 9, evidence: 'two figures' } }
    expect(deriveOverall(c, OPTS)).toBe('retry')
  })

  it('one criterion below minScore retries', () => {
    expect(deriveOverall({ ...all(10), palette: crit(6) }, OPTS)).toBe('retry')
  })

  it('the same failure past the retry budget blocks', () => {
    expect(deriveOverall({ ...all(10), palette: crit(6) }, { ...OPTS, attempt: 4 })).toBe('blocked')
  })

  it('retry exhaustion never overrides a pass', () => {
    expect(deriveOverall(all(10), { ...OPTS, attempt: 4 })).toBe('pass')
  })

  it('skips N/A criteria entirely', () => {
    const c = { ...all(10), facing: { pass: false, score: 0, evidence: 'backwards' } }
    expect(deriveOverall(c, OPTS)).toBe('retry')
    expect(deriveOverall(c, { ...OPTS, naFor: ['facing'] })).toBe('pass')
    const t = { ...all(10), singleFigure: { pass: false, score: 0, evidence: 'terrain has no figure' } }
    expect(deriveOverall(t, { ...OPTS, naFor: NA_CRITERIA_BY_CLASS.terrain })).toBe('pass')
  })

  it('is exact on the minScore boundary', () => {
    expect(deriveOverall({ ...all(10), palette: crit(7) }, OPTS)).toBe('pass')
    expect(deriveOverall({ ...all(10), palette: crit(6.99) }, OPTS)).toBe('retry')
  })

  it('NA_CRITERION names the class and always passes', () => {
    expect(NA_CRITERION('icon')).toEqual({ pass: true, score: 10, evidence: 'not applicable for class icon' })
  })
})
