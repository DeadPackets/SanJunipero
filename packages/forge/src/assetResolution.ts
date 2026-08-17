// THE C-LEVEL BAR. Treatment C of the interior-mock round is the quality the user chose:
// 4x town scale, a 128x64 interior tile, furniture authored at 128-192 px. This file is the
// one place that says, per asset class, how big the art is and how it gets there.
//
// GOVERNING RULE: INTEGER DOWNSCALE ONLY. A generation is always GEN_SIZE square. The shipped
// size is a crop of that generation divided by a whole number. A target that does not divide
// its source evenly is a bug, not a taste call — 512 / 192 = 2.667 is what made the pixels
// soft, and 512 / 24 = 21.33 is why every item in the game looks like mush.
//
// The factor floor is 2: dividing by one ships the generation's own painterly pixels, which
// is how the character cells ended up UPSCALED to 843 px of soft art off a 512 source.
import type { Footprint } from '@sj/shared'
import { GEN_SIZE } from './imageClient.js'
import type { Size } from './pixelGates.js'

export const TOWN_TILE = { w: 32, h: 16 } as const
export const INTERIOR_TILE = { w: 128, h: 64 } as const
export const MIN_DOWNSCALE_FACTOR = 2

export const C_LEVEL = {
  // 512 / 2. Anything larger than this cannot be an integer downscale of one generation.
  maxNativePx: GEN_SIZE / MIN_DOWNSCALE_FACTOR,
  // The zoom stops now go to 4x, so source art is authored for the deepest stop.
  zoomStops: [1, 2, 3, 4],
} as const

// The old ceiling, moved. It lived in three places and is quoted in the report:
//   packages/shared/src/interiorMeta.ts   LibraryItemManifestSchema.spritePx  max(24)
//   packages/forge/src/library/catalog.ts LibraryEntrySchema.spritePx         max(24)
//   packages/forge/src/library/catalog.ts WORLD_SPRITE_PX                      = 24
//   packages/forge/src/styleBible.ts      targetSize('item')                   = 24x24
export const WORLD_SPRITE_PX = 128
export const ICON_PX = 64

export type ClassResolution = { native: Size; rawCrop: Size; factor: number }

// The largest whole factor whose crop still fits inside one generation.
export function resolveScale(native: Size): ClassResolution {
  const factor = Math.min(Math.floor(GEN_SIZE / native.w), Math.floor(GEN_SIZE / native.h))
  if (factor < MIN_DOWNSCALE_FACTOR) throw new Error(
    `resolveScale: ${native.w}x${native.h} leaves factor ${factor}, below the floor of ` +
    `${MIN_DOWNSCALE_FACTOR}; the largest native size one ${GEN_SIZE} generation can hold is ` +
    `${C_LEVEL.maxNativePx}`)
  return { native, rawCrop: { w: native.w * factor, h: native.h * factor }, factor }
}

// A sprite covers the ground diamond of its footprint: (w+h) half-tiles wide.
const spanPx = (fp: Footprint, tile: { w: number }): number => (fp.w + fp.h) * (tile.w / 2)

export type SizedClass = 'item' | 'building'

export function nativeSizeFor(klass: SizedClass, fp: Footprint): Size {
  // Both classes are sized off the 128x64 tile: items because that is the interior tile,
  // buildings because the town's 32x16 tile must still read at the 4x zoom stop.
  const clamped = Math.min(spanPx(fp, INTERIOR_TILE), C_LEVEL.maxNativePx)
  return { w: clamped, h: clamped }
}

export type ResolutionRow = ClassResolution & {
  klass: string
  todayPx: number      // what the class ships at on main, for the "how far did it move" column
  note: string
}

const row = (klass: string, native: Size, todayPx: number, note: string): ResolutionRow =>
  ({ klass, todayPx, note, ...resolveScale(native) })

// One published table, per asset class: the native authored size, the crop taken from the
// generation, and the whole-number factor between them.
export function resolutionTable(): ResolutionRow[] {
  return [
    row('item', { w: 128, h: 128 }, 24, '1x1 furnishing or held item on the 128x64 interior tile'),
    row('item-1x2', { w: 192, h: 192 }, 24, 'bed, rug, bench, loom — a 1x2 footprint spans 192 px'),
    row('item-2x2', { w: 256, h: 256 }, 24, 'the largest furnishing one generation can hold'),
    row('icon', { w: 64, h: 64 }, 24, 'inventory and roster icon, resampled from the same generation'),
    row('interior-tile', { w: 128, h: 64 }, 32, 'one interior floor tile at 4x town scale'),
    row('terrain', { w: 256, h: 256 }, 128, 'a seamless ground material, sampled through the tile window'),
    row('building', { w: 256, h: 256 }, 128, 'a 2x2 dwelling; smaller footprints scale down with their span'),
    row('structure', { w: 256, h: 256 }, 128, 'wagon, scaffolding, standing stone — same bar as buildings'),
    row('character-cell', { w: 256, h: 256 }, 96, 'one pose cell; today these are UPSCALED off 512 to ~843'),
    row('portrait', { w: 256, h: 256 }, 128, 'bust portrait, one expression per generation'),
  ]
}
