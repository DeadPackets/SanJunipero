import { describe, expect, it } from 'vitest'
import { parseBuildingManifest, parseCharacterAtlasManifest } from './assetManifest.js'

const atlas = {
  version: 'v4-hires-atlas',
  figureH: 840,
  cells: { 'idle-sw': { x: 0, y: 0, w: 347, h: 848, feetX: 173, feetY: 843 } },
}
const building = {
  version: 'v4-hires-building',
  kind: 'storehouse',
  footprint: { w: 2, h: 2 },
  cell: { w: 810, h: 866, feetX: 405, feetY: 861 },
}

describe('asset manifest parsing', () => {
  it('parses a character atlas manifest', () => {
    expect(parseCharacterAtlasManifest(JSON.stringify(atlas))?.cells['idle-sw']?.feetY).toBe(843)
  })
  it('parses a building manifest', () => {
    expect(parseBuildingManifest(JSON.stringify(building))?.cell.feetX).toBe(405)
  })
  it('returns null on null, junk JSON, wrong version, and cross-parses', () => {
    expect(parseCharacterAtlasManifest(null)).toBeNull()
    expect(parseCharacterAtlasManifest('{nope')).toBeNull()
    expect(parseCharacterAtlasManifest(JSON.stringify({ ...atlas, version: 'v2' }))).toBeNull()
    expect(parseCharacterAtlasManifest(JSON.stringify(building))).toBeNull()
    expect(parseBuildingManifest(JSON.stringify(atlas))).toBeNull()
  })
})
