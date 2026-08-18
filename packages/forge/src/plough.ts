// PLOUGHED SOIL, BY CONSTRUCTION.
//
// `terrain_farmland_0` was REJECTED BY THE USER: it self-tiles into rows of isometric
// cottages, because the style anchor attached to every terrain call IS a cottage and the
// model copied it whole. Every mechanical gate passed it — a cottage wraps as cleanly as
// soil — which is why this material is the project's standing exhibit for "gates are
// necessary, never sufficient".
//
// Re-generating with a GROUND material as the reference fixed the subject and then hit the
// wall the terrain round already documented: three attempts, blocked, the eye scoring the
// tiling 1.67/10, the model drawing a field boundary round the square every time. An image
// model does not draw a texture that closes itself, and a furrow is the least forgiving thing
// to ask it for — a ploughed field is PERIODIC, and periodicity is arithmetic, not painting.
//
// So the model supplies the soil and the code supplies the furrow. The pitch divides the
// material exactly, so the ridge cannot break across the wrap: furrows read as furrows
// because they are the same furrow, continued.
import { paletteRgb } from './palette.js'
import { quantize } from './post/quantize.js'
import type { RawImage } from './post/raw.js'

// The material repeats every 256 px of SCREEN space (groundField.materialUv wraps the bake
// coordinates, not world coordinates) and a town tile is 32 px wide. 64 puts a furrow every
// ~29 px measured across the ridge, which reads as ploughing; 32 and 8 both read as corduroy.
export const FURROW_PITCH_PX = 64
// How far the ridge and the trough move off the soil's own tone. Measured against the shipped
// materials: earth's own grain runs about 12 tones peak to peak, so a furrow has to clear
// that to read as structure rather than more grain, without turning the field into stripes.
export const FURROW_DEPTH = 0.26

// The ridge profile across one pitch. A cosine over the whole pitch is CORDUROY — every pixel
// is on a slope, so the field reads as fabric. Ploughing is mostly flat soil with a cut in it:
// a narrow shadowed trough, the turned crest lit beside it, and the rest of the pitch left as
// the material the model drew. `lip` is the share of the pitch the cut occupies.
export const FURROW_LIP = 0.30

function ridge(phase: number, lip: number): number {
  if (phase >= lip) return 0
  // one full cycle squeezed into the lip: down into the trough, up over the crest, back
  return -Math.sin(2 * Math.PI * (phase / lip))
}

// The furrow follows a GROUND axis, not a screen axis. The ground field wraps the material in
// screen space (groundField.materialUv takes bake coordinates), and a 32x16 tile puts the two
// ground axes at slope +/- 1/2 on screen — so the ridge is a function of x + 2y, which draws
// a line running down-left exactly along the tile lattice. It still wraps by arithmetic: a
// pitch that divides 256 also divides the 256 and 512 the two wraps add to the phase.
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
