import { describe, it, expect } from 'vitest'
import { AssetRecordSchema } from './assetCodex.js'

const valid = {
  id: 'a-1',
  seq: 1,
  class: 'building',
  desc: 'a bakery',
  footprint: { w: 2, h: 2 },
  widthPx: 128,
  heightPx: 128,
  status: 'ready',
  score: 8,
  attempts: 1,
  costUsd: 0.14,
  createdAt: '2026-08-15T00:00:00Z',
}

describe('AssetRecordSchema', () => {
  it('accepts a valid record', () => {
    expect(AssetRecordSchema.parse(valid).class).toBe('building')
  })
  it('is strict — unknown keys rejected', () => {
    expect(() => AssetRecordSchema.parse({ ...valid, extra: 1 })).toThrow()
  })
  it('rejects attempts > 3 and footprints > 4x4', () => {
    expect(() => AssetRecordSchema.parse({ ...valid, attempts: 4 })).toThrow()
    expect(() => AssetRecordSchema.parse({ ...valid, footprint: { w: 5, h: 1 } })).toThrow()
  })
  it('placeholder records carry a null score', () => {
    expect(
      AssetRecordSchema.parse({ ...valid, status: 'placeholder', score: null }).score,
    ).toBeNull()
  })
})
