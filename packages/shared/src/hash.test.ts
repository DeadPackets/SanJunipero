import { describe, it, expect } from 'vitest'
import { stableStringify, stateHash } from './hash.js'

describe('stableStringify', () => {
  it('is key-order independent', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } }))
      .toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }))
  })
  it('preserves array order', () => {
    expect(stableStringify([2, 1])).not.toBe(stableStringify([1, 2]))
  })
})
describe('stateHash', () => {
  it('returns 64-char hex, stable across calls', () => {
    const h = stateHash({ x: 1 })
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(stateHash({ x: 1 })).toBe(h)
    expect(stateHash({ x: 2 })).not.toBe(h)
  })
})
