import type { AssetClass, Footprint } from '@sj/shared'
import { nativeSizeFor } from './assetResolution.js'
export type { AssetClass, Footprint } from '@sj/shared'

export const STYLE_PROMPT = [
  'Cutesy isometric pixel-art sprite, 2:1 dimetric projection, fixed camera, light from the north-west.',
  'Hard pixels, no anti-aliasing, no gradients, chunky readable silhouette, rounded shapes, oversized doors and windows.',
  'Warm cozy pastel palette only: cream stone, honey wood, sage greens, dusty rose accents, saturated but soft.',
  'Stardew Valley style proportions and warmth; characters are 3 heads tall.',
  'The subject fills the frame, centered, on a SOLID PURE MAGENTA (#FF00FF) background.',
  'No shadows cast on the background, no ground plane unless it is part of the subject.',
].join(' ')

const CLASS_HINTS: Record<AssetClass, string> = {
  building: 'A single free-standing building sprite.',
  item: 'A single small hand-held item sprite.',
  crop: 'A crop sprite sheet with exactly 4 growth stages left to right, evenly spaced: sprout, young, mature, harvest-ready.',
  terrain:
    'A seamless terrain tile sheet, 4 columns by 4 rows of 32x16 diamond ground tiles. The sheet fills the whole frame; no magenta background for terrain.',
  'rig-part':
    'A character sprite sheet with exactly 4 facing directions left to right: south, west, north, east. Same character, consistent pixel style across all 4.',
  portrait: 'A large character portrait, bust framing, painted pixel-art style.',
}

// Non-character classes are told to match refs[0], which `loadReferenceSheet` makes the palette
// swatch; characters carry their own identity refs and get no such clause.
export const STYLE_ANCHOR_CLAUSE =
  'match the pixel density, palette warmth, and cute rounded style of the first reference image exactly'

/** Two halves because a redraw puts the eye's feedback BETWEEN them (addendum §1); joined in
 *  that order they are the whole prompt. */
export function assetPromptParts(
  desc: string,
  footprint: Footprint,
  klass: AssetClass,
): { boilerplate: string; commissionText: string } {
  const anchor =
    klass === 'rig-part' || klass === 'portrait' ? '' : ` Style: ${STYLE_ANCHOR_CLAUSE}.`
  return {
    boilerplate: `${STYLE_PROMPT} ${CLASS_HINTS[klass]}${anchor}`,
    commissionText: `Subject: ${desc}. World footprint: ${footprint.w}x${footprint.h} tiles on a 32x16 pixel tile grid.`,
  }
}

// Final sprite canvas sizes, post NEAREST downscale. Buildings are 32·(w+h) px square, so a 1x1 is
// the ~64 px sprite the Style Bible names; crops and rigs are 4-frame horizontal sheets.
export function targetSize(klass: AssetClass, fp: Footprint): { w: number; h: number } {
  switch (klass) {
    case 'building':
      return { w: 32 * (fp.w + fp.h), h: 32 * (fp.w + fp.h) }
    case 'item':
      return nativeSizeFor('item', fp)
    case 'crop':
      return { w: 128, h: 32 }
    case 'rig-part':
      return { w: 128, h: 32 }
    case 'terrain':
      return { w: 128, h: 64 }
    case 'portrait':
      return { w: 256, h: 256 }
  }
}
