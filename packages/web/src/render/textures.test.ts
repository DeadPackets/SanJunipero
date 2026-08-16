import { describe, expect, it } from 'vitest'
import type { AssetRecord } from '@sj/shared'
import { resolveAssetId, textureUrlFor } from './textures.js'

const rec = (over: Partial<AssetRecord>): AssetRecord => ({
  id: 'asset_x', seq: 1, class: 'building', desc: 'hut: timber dwelling', kind: 'hut',
  footprint: { w: 2, h: 2 }, widthPx: 64, heightPx: 64, status: 'ready',
  score: 9, attempts: 1, costUsd: 0, createdAt: '2026-08-16 00:00:00', meta: null,
  ...over,
})

describe('resolveAssetId', () => {
  it('picks the newest ready record for the kind over an older one', () => {
    const records = [rec({ id: 'old', seq: 1 }), rec({ id: 'new', seq: 7 }), rec({ id: 'other', seq: 9, kind: 'barn' })]
    expect(resolveAssetId(records, 'building', 'hut')).toBe('new')
  })

  it('ignores placeholder-status records', () => {
    const records = [rec({ id: 'ready1', seq: 1 }), rec({ id: 'ph', seq: 5, status: 'placeholder', score: null })]
    expect(resolveAssetId(records, 'building', 'hut')).toBe('ready1')
  })

  it('resolves by the kind column, never by desc parsing', () => {
    // desc mentions hut, kind says otherwise: no match; null kind never matches either
    const records = [rec({ id: 'a', kind: 'shed', desc: 'hut lookalike' }), rec({ id: 'b', kind: null, desc: 'hut: timber' })]
    expect(resolveAssetId(records, 'building', 'hut')).toBeNull()
  })

  it('requires the class to match', () => {
    expect(resolveAssetId([rec({ class: 'item', footprint: { w: 1, h: 1 } })], 'building', 'hut')).toBeNull()
  })
})

describe('textureUrlFor', () => {
  it('serves the resolved asset png', () => {
    expect(textureUrlFor([rec({ id: 'asset_9' })], 'building', 'hut')).toBe('/assets/asset_9.png')
  })
  it('falls back to the class placeholder', () => {
    expect(textureUrlFor([], 'building', 'hut')).toBe('/assets/placeholder/building.png')
  })
})
