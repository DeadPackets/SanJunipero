import { decodePng, encodePng, downscaleNearest, centerCropToAspect } from './raw.js'
import { chromaKey } from './chromaKey.js'
import { quantize } from './quantize.js'
import { outlinePass } from './outline.js'
import type { AssetClass } from '../styleBible.js'

const KEYED: Record<AssetClass, boolean> = {
  building: true, item: true, crop: true, 'rig-part': true, terrain: false, portrait: false,
}

export async function postProcess(png: Buffer, klass: AssetClass, target: { w: number; h: number }): Promise<Buffer> {
  let img = await decodePng(png)
  if (KEYED[klass]) img = chromaKey(img)
  img = centerCropToAspect(img, target.w, target.h)
  img = downscaleNearest(img, target.w, target.h)
  img = quantize(img)
  if (KEYED[klass]) img = outlinePass(img)
  return encodePng(img)
}
