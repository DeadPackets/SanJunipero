import { describe, it, expect } from 'vitest'
import { GEN_SIZE } from './imageClient.js'
import { integerScaleGate } from './pixelGates.js'
import {
  C_LEVEL,
  MIN_DOWNSCALE_FACTOR,
  TOWN_TILE,
  INTERIOR_TILE,
  WORLD_SPRITE_PX,
  GENERATION_PX,
  resolveScale,
  nativeSizeFor,
  type ClassResolution,
} from './assetResolution.js'
import type { Size } from './pixelGates.js'

type ResolutionRow = ClassResolution & {
  klass: string
  genPx: number
  todayPx: number // what the class ships at on main, for the "how far did it move" column
  note: string
}

const row = (
  klass: string,
  native: Size,
  genPx: number,
  todayPx: number,
  note: string,
): ResolutionRow => ({ klass, genPx, todayPx, note, ...resolveScale(native, genPx) })

// One published table, per asset class: the native authored size, the crop taken from the
// generation, and the whole-number factor between them.
function resolutionTable(): ResolutionRow[] {
  const g = GENERATION_PX
  return [
    row(
      'item',
      { w: 128, h: 128 },
      g.item,
      24,
      '1x1 furnishing or held item on the 128x64 interior tile',
    ),
    row('item-1x2', { w: 192, h: 192 }, g.item, 24, 'bed, rug, bench or loom, a 1x2 spans 192 px'),
    row(
      'item-2x2',
      { w: 256, h: 256 },
      g.item,
      24,
      'the largest furnishing a 512 generation can hold',
    ),
    row(
      'icon',
      { w: 64, h: 64 },
      g.icon,
      24,
      'inventory and roster icon, resampled from the same generation',
    ),
    row(
      'interior-tile',
      { w: 128, h: 64 },
      g['interior-tile'],
      32,
      'one interior floor tile at 4x town scale',
    ),
    row(
      'terrain',
      { w: 256, h: 256 },
      g.terrain,
      128,
      'a seamless ground material, sampled through the tile window',
    ),
    // 256 is also the size that makes the RENDERER exact: buildingArt scales the cell to
    // 32*(w+h) world px, so a 2x2 at 256 is a clean 1/2, where today's 810 is 128/810.
    row(
      'building',
      { w: 256, h: 256 },
      g.building,
      128,
      'a 2x2 dwelling; the renderer then halves it exactly',
    ),
    row(
      'structure',
      { w: 256, h: 256 },
      g.structure,
      128,
      'wagon, scaffolding or standing stone, the same bar as buildings',
    ),
    row(
      'character-cell',
      { w: 256, h: 256 },
      g['character-cell'],
      96,
      'one pose cell; today these are UPSCALED to ~845',
    ),
    row(
      'portrait',
      { w: 256, h: 256 },
      g.portrait,
      128,
      'bust portrait, one expression per generation',
    ),
  ]
}

describe('resolveScale', () => {
  it('picks the largest integer factor that still fits the generation', () => {
    expect(resolveScale({ w: 128, h: 128 })).toEqual({
      native: { w: 128, h: 128 },
      rawCrop: { w: 512, h: 512 },
      factor: 4,
    })
  })
  it('crops the square generation when the native size is not a divisor of it', () => {
    // 192 does not divide 512; a 384x384 crop of the generation does, at factor 2.
    expect(resolveScale({ w: 192, h: 192 })).toEqual({
      native: { w: 192, h: 192 },
      rawCrop: { w: 384, h: 384 },
      factor: 2,
    })
  })
  it('handles the 2:1 interior tile: the crop is a letterbox of the square generation', () => {
    expect(resolveScale({ w: 128, h: 64 })).toEqual({
      native: { w: 128, h: 64 },
      rawCrop: { w: 512, h: 256 },
      factor: 4,
    })
  })
  it('refuses a native size that cannot be halved out of one generation', () => {
    expect(() => resolveScale({ w: 512, h: 512 })).toThrow(/factor 1/)
  })
  it('takes the generation size, because buildings and characters ask for 1024', () => {
    expect(GENERATION_PX.building).toBe(1024)
    expect(GENERATION_PX.item).toBe(GEN_SIZE)
    expect(resolveScale({ w: 256, h: 256 }, 1024)).toMatchObject({
      factor: 4,
      rawCrop: { w: 1024, h: 1024 },
    })
    expect(resolveScale({ w: 512, h: 512 }, 1024)).toMatchObject({ factor: 2 })
  })

  it('every scale it returns passes the integer-scale gate', () => {
    for (const s of [
      { w: 128, h: 128 },
      { w: 192, h: 192 },
      { w: 256, h: 256 },
      { w: 128, h: 64 },
      { w: 64, h: 64 },
    ]) {
      const r = resolveScale(s)
      expect(integerScaleGate(r.rawCrop, r.native).ok).toBe(true)
      expect(r.factor).toBeGreaterThanOrEqual(MIN_DOWNSCALE_FACTOR)
      expect(r.rawCrop.w).toBeLessThanOrEqual(GEN_SIZE)
      expect(r.rawCrop.h).toBeLessThanOrEqual(GEN_SIZE)
    }
  })
})

describe('the C-level bar', () => {
  it('keeps the town tile and the interior tile the mock measured', () => {
    expect(TOWN_TILE).toEqual({ w: 32, h: 16 })
    expect(INTERIOR_TILE).toEqual({ w: 128, h: 64 })
    expect(INTERIOR_TILE.w / TOWN_TILE.w).toBe(4)
  })
  it('moved the world sprite off 24, which never divided the 512 generation', () => {
    expect(WORLD_SPRITE_PX).toBe(128)
    expect(GEN_SIZE % 24).not.toBe(0)
    expect(integerScaleGate({ w: GEN_SIZE, h: GEN_SIZE }, { w: 24, h: 24 }).ok).toBe(false)
  })
  it('publishes one row per asset class, every one of them an integer downscale', () => {
    const rows = resolutionTable()
    expect(rows.map((r) => r.klass).sort()).toEqual([
      'building',
      'character-cell',
      'icon',
      'interior-tile',
      'item',
      'item-1x2',
      'item-2x2',
      'portrait',
      'structure',
      'terrain',
    ])
    for (const r of rows) {
      expect(integerScaleGate(r.rawCrop, r.native), r.klass).toMatchObject({ ok: true })
      expect(r.factor).toBeGreaterThanOrEqual(MIN_DOWNSCALE_FACTOR)
      expect(r.rawCrop.w, r.klass).toBeLessThanOrEqual(r.genPx)
      expect(r.rawCrop.h, r.klass).toBeLessThanOrEqual(r.genPx)
    }
  })
  it('every class is at least twice the resolution it ships at today', () => {
    for (const r of resolutionTable())
      expect(r.native.w / r.todayPx, r.klass).toBeGreaterThanOrEqual(2)
  })
})

describe('nativeSizeFor', () => {
  it('scales a floor item with its footprint span on the interior tile', () => {
    expect(nativeSizeFor('item', { w: 1, h: 1 })).toEqual({ w: 128, h: 128 })
    expect(nativeSizeFor('item', { w: 1, h: 2 })).toEqual({ w: 192, h: 192 })
    expect(nativeSizeFor('item', { w: 2, h: 2 })).toEqual({ w: 256, h: 256 })
  })
  it('scales a building with its footprint on the town tile at the 4x zoom stop', () => {
    expect(nativeSizeFor('building', { w: 1, h: 1 })).toEqual({ w: 128, h: 128 })
    expect(nativeSizeFor('building', { w: 2, h: 2 })).toEqual({ w: 256, h: 256 })
  })
  it('caps at the largest native one 512 generation can hold at factor 2', () => {
    expect(nativeSizeFor('building', { w: 4, h: 4 })).toEqual({
      w: C_LEVEL.maxNativePx,
      h: C_LEVEL.maxNativePx,
    })
    expect(C_LEVEL.maxNativePx).toBe(GEN_SIZE / MIN_DOWNSCALE_FACTOR)
  })
})
