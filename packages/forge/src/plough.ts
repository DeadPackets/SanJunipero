// The model supplies the soil and the code supplies the furrow: an image model does not draw a
// texture that closes itself, and a ploughed field is PERIODIC — arithmetic, not painting.
import { paletteRgb } from './palette.js'
import { quantize } from './post/quantize.js'
import type { RawImage } from './post/raw.js'

// The material repeats every 256 px of SCREEN space and a town tile is 32 px wide. 64 puts a
// furrow every ~29 px across the ridge, which reads as ploughing; 32 and 8 both read as corduroy.
export const FURROW_PITCH_PX = 64
// Earth's own grain runs about 12 tones peak to peak, so a furrow has to clear that to read as
// structure rather than more grain, without turning the field into stripes.
export const FURROW_DEPTH = 0.26

// A cosine over the whole pitch is CORDUROY — every pixel is on a slope. Ploughing is mostly flat
// soil with a cut in it, and `lip` is the share of the pitch that cut occupies.
export const FURROW_LIP = 0.30

function ridge(phase: number, lip: number): number {
  if (phase >= lip) return 0
  // one full cycle squeezed into the lip: down into the trough, up over the crest, back
  return -Math.sin(2 * Math.PI * (phase / lip))
}

// The furrow follows a GROUND axis: a 32x16 tile puts the two ground axes at slope +/- 1/2 on
// screen, so the ridge is a function of x + 2y. A pitch that divides 256 still wraps by arithmetic.
export function ploughFurrows(
  m: RawImage, opts: { pitch?: number; depth?: number; lip?: number } = {},
): RawImage {
  const pitch = opts.pitch ?? FURROW_PITCH_PX
  const depth = opts.depth ?? FURROW_DEPTH
  const lip = opts.lip ?? FURROW_LIP
  if (!Number.isInteger(pitch) || pitch < 2 || m.width % pitch !== 0 || m.height % pitch !== 0) throw new Error(
    `ploughFurrows: pitch ${pitch} does not divide the ${m.width}x${m.height} px material, so the ` +
    'furrow would break across the wrap — which is the whole defect this exists to avoid')

  const out: RawImage = { width: m.width, height: m.height, data: new Uint8ClampedArray(m.data) }
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      const k = 1 + depth * ridge(((x + 2 * y) % pitch) / pitch, lip)
      const i = (y * m.width + x) * 4
      for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(m.data[i + c]! * k)
      out.data[i + 3] = 255
    }
  }
  const q = quantize(out, paletteRgb())
  for (let i = 3; i < q.data.length; i += 4) q.data[i] = 255
  return q
}
