import type { AssetClass, Footprint } from '@sj/shared'
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
  terrain: 'A seamless terrain tile sheet, 4 columns by 4 rows of 32x16 diamond ground tiles. The sheet fills the whole frame; no magenta background for terrain.',
  'rig-part': 'A character sprite sheet with exactly 4 facing directions left to right: south, west, north, east. Same character, consistent pixel style across all 4.',
  portrait: 'A large character portrait, bust framing, painted pixel-art style.',
}

export function buildAssetPrompt(desc: string, footprint: Footprint, klass: AssetClass): string {
  return `${STYLE_PROMPT} ${CLASS_HINTS[klass]} Subject: ${desc}. World footprint: ${footprint.w}x${footprint.h} tiles on a 32x16 pixel tile grid.`
}

// Final sprite canvas sizes (post NEAREST downscale from 512px generation).
// Buildings: 32·(w+h) px square → 1x1 = 64px, matching the Style Bible's
// "~64px sprite for a 1x1 building". Crops/rigs are 4-frame horizontal sheets.
export function targetSize(klass: AssetClass, fp: Footprint): { w: number; h: number } {
  switch (klass) {
    case 'building': return { w: 32 * (fp.w + fp.h), h: 32 * (fp.w + fp.h) }
    case 'item': return { w: 24, h: 24 }
    case 'crop': return { w: 128, h: 32 }
    case 'rig-part': return { w: 128, h: 32 }
    case 'terrain': return { w: 128, h: 64 }
    case 'portrait': return { w: 256, h: 256 }
  }
}
