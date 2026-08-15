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
  it('throws TypeError naming the constructor for non-plain objects', () => {
    expect(() => stableStringify({ a: new Map() })).toThrow(TypeError)
    expect(() => stableStringify({ a: new Map() })).toThrow(/Map/)
    expect(() => stableStringify(new Set([1]))).toThrow(/Set/)
    expect(() => stableStringify({ d: new Date(0) })).toThrow(/Date/)
    expect(() => stableStringify(new Uint8Array(2))).toThrow(/Uint8Array/)
    expect(() => stableStringify(() => 1)).toThrow(/Function/)
  })
  it('still accepts plain nested objects, arrays, and null-prototype objects', () => {
    expect(stableStringify({ a: [{ b: 1 }], c: null })).toBe('{"a":[{"b":1}],"c":null}')
    const np = Object.create(null) as Record<string, unknown>
    np.x = 1
    expect(stableStringify(np)).toBe('{"x":1}')
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
