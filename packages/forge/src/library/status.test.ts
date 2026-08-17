import { describe, it, expect } from 'vitest'
import { CRITERIA, type VisionCriteria, type VisionVerdict } from '../visionQa/verdict.js'
import { spriteGateStatus } from './status.js'

function verdict(overall: VisionVerdict['overall']): VisionVerdict {
  const criteria = Object.fromEntries(
    CRITERIA.map(k => [k, { pass: true, score: 10, evidence: 'seen' }])) as VisionCriteria
  return {
    assetId: 'library:stool', model: 'google/gemini-3.7-flash', rubricVersion: 'v1',
    criteria, overall, feedback: '',
  }
}

describe('spriteGateStatus', () => {
  it('calls a clean sprite a pass even when the icon round that followed never closed', () => {
    expect(spriteGateStatus([verdict('pass')], 'blocked')).toBe('pass')
  })

  it('reads the LAST sprite verdict, not the first', () => {
    expect(spriteGateStatus([verdict('pass'), verdict('retry'), verdict('blocked')], 'pass'))
      .toBe('blocked')
    expect(spriteGateStatus([verdict('blocked'), verdict('pass')], 'blocked')).toBe('pass')
  })

  it('never leaks the mid-loop `retry` outcome into a reported status', () => {
    expect(spriteGateStatus([verdict('retry')], 'pass')).toBe('blocked')
  })

  it('falls back when the sprite was never judged — a keyless run has no verdicts', () => {
    expect(spriteGateStatus([], 'error')).toBe('error')
    expect(spriteGateStatus([], 'missing')).toBe('missing')
  })
})
