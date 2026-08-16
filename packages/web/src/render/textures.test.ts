import { describe, expect, it } from 'vitest'
import type { AssetRecord } from '@sj/shared'
import { buildingArt, characterArt, resolveAssetId, textureUrlFor } from './textures.js'

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

describe('characterArt (v4 manifest contract)', () => {
  const atlasMeta = JSON.stringify({
    version: 'v4-hires-atlas', figureH: 840,
    cells: { 'idle-sw': { x: 0, y: 0, w: 347, h: 848, feetX: 173, feetY: 843 } },
  })
  const charRec = (over: Partial<AssetRecord>): AssetRecord => rec({
    class: 'rig-part', kind: 'character:omar', desc: 'character sheet: omar', meta: atlasMeta,
    footprint: { w: 1, h: 1 }, ...over,
  })

  it('resolves a v4 atlas record to its immutable png + parsed manifest', () => {
    const art = characterArt([charRec({ id: 'asset_omar' })], 'omar')
    expect(art.url).toBe('/assets/asset_omar.png')
    expect(art.manifest?.figureH).toBe(840)
    expect(art.manifest?.cells['idle-sw']?.feetY).toBe(843)
  })

  it('falls back to the gateway character route with no manifest when meta is absent or not v4', () => {
    expect(characterArt([charRec({ meta: null })], 'omar')).toEqual({ url: '/assets/character/omar.png', manifest: null })
    expect(characterArt([], 'omar')).toEqual({ url: '/assets/character/omar.png', manifest: null })
  })

  it('newest ready atlas wins on regen', () => {
    const art = characterArt([charRec({ id: 'old', seq: 3 }), charRec({ id: 'new', seq: 8 })], 'omar')
    expect(art.url).toBe('/assets/new.png')
  })
})

describe('buildingArt (v4-hires-building manifest)', () => {
  const meta = JSON.stringify({
    version: 'v4-hires-building', kind: 'storehouse', footprint: { w: 2, h: 2 },
    cell: { w: 810, h: 866, feetX: 405, feetY: 861 },
  })

  it('feet-anchors and fits the art into the Style Bible 32·(w+h) square', () => {
    const art = buildingArt([rec({ id: 'asset_sh', kind: 'storehouse', meta })], 'storehouse', 2, 2)
    expect(art.url).toBe('/assets/asset_sh.png')
    expect(art.anchor).toEqual({ x: 405 / 810, y: 861 / 866 })
    expect(art.scale).toBeCloseTo(Math.min(128 / 810, 128 / 866), 10)
  })

  it('v2/no-meta records draw at natural size with the bottom-center law', () => {
    expect(buildingArt([rec({ id: 'hutv2', kind: 'hut' })], 'hut', 2, 2)).toEqual({ url: '/assets/hutv2.png', anchor: null, scale: null })
    expect(buildingArt([], 'hut', 2, 2)).toEqual({ url: '/assets/placeholder/building.png', anchor: null, scale: null })
  })
})
