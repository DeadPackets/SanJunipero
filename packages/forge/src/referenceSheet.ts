// The reference sheet is the palette and nothing else: ONE reference object of a different subject
// costs a generation its architecture (measured A/B, $0.2053). `style-anchor.png` is never attached.
import { encodePng } from './post/raw.js'
import { MASTER_PALETTE, paletteRgb } from './palette.js'

/** Edge of one swatch square, in pixels. Big enough that the provider cannot read the chart
 *  as texture and small enough that the whole palette fits one modest image. */
export const REF_SWATCH_PX = 64
export const REF_SWATCH_COLS = 8

/** The one reference this project attaches to a generation: every MASTER_PALETTE member as a
 *  flat square, no subject, no architecture, no projection. */
export async function paletteSwatchPng(): Promise<Buffer> {
  const rgb = paletteRgb(MASTER_PALETTE)
  const rows = Math.ceil(rgb.length / REF_SWATCH_COLS)
  const width = REF_SWATCH_COLS * REF_SWATCH_PX,
    height = rows * REF_SWATCH_PX
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < rgb.length; i++) {
    const [r, g, b] = rgb[i]!
    const cx = (i % REF_SWATCH_COLS) * REF_SWATCH_PX,
      cy = Math.floor(i / REF_SWATCH_COLS) * REF_SWATCH_PX
    for (let y = cy; y < cy + REF_SWATCH_PX; y++)
      for (let x = cx; x < cx + REF_SWATCH_PX; x++) {
        data.set([r, g, b, 255], (y * width + x) * 4)
      }
  }
  return encodePng({ width, height, data })
}

/** Every reference a generation may carry. Exactly one entry, and it is not a picture of
 *  anything. Kept as an array because `createForge` and the judges take a list. */
export async function loadReferenceSheet(): Promise<Buffer[]> {
  return [await paletteSwatchPng()]
}
