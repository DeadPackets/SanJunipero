import { describe, it, expect } from 'vitest'
import { makePlaceholder } from './placeholder.js'
import { mechanicalGate } from './gate.js'

describe('makePlaceholder', () => {
  it('is target-sized, palette-compliant, and deterministic', () => {
    const a = makePlaceholder('building', { w: 64, h: 64 })
    const b = makePlaceholder('building', { w: 64, h: 64 })
    expect(a.data).toEqual(b.data)
    expect(mechanicalGate(a, { w: 64, h: 64, requireAlpha: false }).ok).toBe(true)
  })
  it('has the dark border', () => {
    const p = makePlaceholder('item', { w: 8, h: 8 })
    expect([...p.data.slice(0, 3)]).toEqual([0x24, 0x1f, 0x2b])
  })
})
