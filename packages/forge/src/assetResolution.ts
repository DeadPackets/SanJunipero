// INTEGER DOWNSCALE ONLY: a shipped size is a crop of the generation divided by a WHOLE number,
// factor floor 2. A fractional divide (512 / 192 = 2.667) is what makes the pixels soft.
import type { Footprint } from '@sj/shared'
import { GEN_SIZE } from './imageClient.js'
import type { Size } from './pixelGates.js'

export const TOWN_TILE = { w: 32, h: 16 } as const
export const INTERIOR_TILE = { w: 128, h: 64 } as const
export const MIN_DOWNSCALE_FACTOR = 2

// Buildings and character cells are asked for at 1024 directly, and the provider returns JPEG at
// any size — sample the MEDIAN of each block on the way down or the DCT ringing ships.
export const GENERATION_PX = {
  item: GEN_SIZE,
  icon: GEN_SIZE,
  terrain: GEN_SIZE,
  portrait: GEN_SIZE,
  'interior-tile': GEN_SIZE,
  building: 1024,
  structure: 1024,
  'character-cell': 1024,
} as const
export type GeneratedClass = keyof typeof GENERATION_PX

export const C_LEVEL = {
  // 512 / 2. Anything larger than this cannot be an integer downscale of a 512 generation.
  maxNativePx: GEN_SIZE / MIN_DOWNSCALE_FACTOR,
  // The zoom stops now go to 4x, so source art is authored for the deepest stop.
  zoomStops: [1, 2, 3, 4],
} as const

export const WORLD_SPRITE_PX = 128
export const ICON_PX = 64

export type ClassResolution = { native: Size; rawCrop: Size; factor: number }

// The largest whole factor whose crop still fits inside one generation.
export function resolveScale(native: Size, genPx: number = GEN_SIZE): ClassResolution {
  const factor = Math.min(Math.floor(genPx / native.w), Math.floor(genPx / native.h))
  if (factor < MIN_DOWNSCALE_FACTOR)
    throw new Error(
      `resolveScale: ${native.w}x${native.h} leaves factor ${factor}, below the floor of ` +
        `${MIN_DOWNSCALE_FACTOR}; the largest native size a ${genPx} generation can hold is ` +
        `${genPx / MIN_DOWNSCALE_FACTOR}`,
    )
  return { native, rawCrop: { w: native.w * factor, h: native.h * factor }, factor }
}

// A sprite covers the ground diamond of its footprint: (w+h) half-tiles wide.
const spanPx = (fp: Footprint, tile: { w: number }): number => (fp.w + fp.h) * (tile.w / 2)

export type SizedClass = 'item' | 'building'

export function nativeSizeFor(_klass: SizedClass, fp: Footprint): Size {
  // Both classes are sized off the 128x64 tile: items because that is the interior tile,
  // buildings because the town's 32x16 tile must still read at the 4x zoom stop.
  const clamped = Math.min(spanPx(fp, INTERIOR_TILE), C_LEVEL.maxNativePx)
  return { w: clamped, h: clamped }
}

export type ResolutionRow = ClassResolution & {
  klass: GeneratedClass | string
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
export function resolutionTable(): ResolutionRow[] {
  const g = GENERATION_PX
  return [
    row(
      'item',
      { w: 128, h: 128 },
      g.item,
      24,
      '1x1 furnishing or held item on the 128x64 interior tile',
    ),
    row(
      'item-1x2',
      { w: 192, h: 192 },
      g.item,
      24,
      'bed, rug, bench, loom — a 1x2 footprint spans 192 px',
    ),
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
      'wagon, scaffolding, standing stone — same bar as buildings',
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
