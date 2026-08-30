// LUT reuses forge's calibrated atmosphere TINTS — the palette was locked under these.
export const CLOCK_STOPS: { minute: number; tint: [number, number, number] }[] = [
  { minute: 0, tint: [0.45, 0.52, 0.95] }, // deep night   (forge TINTS.night)
  { minute: 300, tint: [0.45, 0.52, 0.95] }, // 05:00 still night
  { minute: 390, tint: [1.0, 0.94, 0.78] }, // 06:30 golden dawn (TINTS.dawn clamped ≤1)
  { minute: 480, tint: [1.0, 1.0, 1.0] }, // 08:00 full day
  { minute: 1050, tint: [1.0, 1.0, 1.0] }, // 17:30 day holds
  { minute: 1140, tint: [1.0, 0.94, 0.78] }, // 19:00 golden dusk
  { minute: 1230, tint: [0.45, 0.52, 0.95] }, // 20:30 night
  { minute: 1440, tint: [0.45, 0.52, 0.95] },
]

/** Blue held at 1.00, red pulled, green near the shipped value: a blue cast instead of the
 *  grey-green one, at the same luma. The night contrast floor is met by grading the picture
 *  and not the words (D5), never by this table. */
export const WEATHER_DIAG: Readonly<Record<string, [number, number, number]>> = {
  cloudy: [0.94, 0.96, 1.0],
  rain: [0.84, 0.92, 1.0],
  storm: [0.72, 0.84, 1.0],
  snow: [0.9, 0.95, 1.0],
}
function clockStops(minuteOfDay: number): [number, number, number] {
  const m = Math.min(Math.max(minuteOfDay, 0), 1440)
  let lo = CLOCK_STOPS[0]!,
    hi = CLOCK_STOPS.at(-1)!
  for (let i = 0; i < CLOCK_STOPS.length - 1; i++) {
    if (m >= CLOCK_STOPS[i]!.minute && m <= CLOCK_STOPS[i + 1]!.minute) {
      lo = CLOCK_STOPS[i]!
      hi = CLOCK_STOPS[i + 1]!
      break
    }
  }
  const t = hi.minute === lo.minute ? 0 : (m - lo.minute) / (hi.minute - lo.minute)
  const ch = (i: 0 | 1 | 2): number => lo.tint[i] + (hi.tint[i] - lo.tint[i]) * t
  return [ch(0), ch(1), ch(2)]
}

export function clockTint(minuteOfDay: number): number {
  const [r, g, b] = clockStops(minuteOfDay)
  const ch = (v: number): number => Math.round(v * 255)
  return (ch(r) << 16) | (ch(g) << 8) | ch(b)
}

const relLum = ([r, g, b]: [number, number, number]): number => 0.2126 * r + 0.7152 * g + 0.0722 * b
const NIGHT_LUM = relLum(CLOCK_STOPS[0]!.tint)

/** THE ONE DAY CLOCK for the picture: 0 at deep night, 1 at full day, read off the tint's own
 *  luminance. Pool strength, window glow and the sky gradient all take it, so nothing steps
 *  on an hour the sky has not reached. The engine's `dayPhaseFromTick` stays sim truth. */
export function skyLevel(minuteOfDay: number): number {
  if (minuteOfDay !== lastMinute) {
    const l = relLum(clockStops(minuteOfDay))
    lastMinute = minuteOfDay
    lastSky = Math.min(1, Math.max(0, (l - NIGHT_LUM) / (1 - NIGHT_LUM)))
  }
  return lastSky
}
// asked every frame by every light for a value that moves once a sim minute
let lastMinute = -1
let lastSky = 0

function diagMatrix([r, g, b]: [number, number, number]): Float32Array {
  // pixi ColorMatrixFilter layout: 4 rows × 5 columns
  const m = new Float32Array(20)
  m[0] = r
  m[6] = g
  m[12] = b
  m[18] = 1
  return m
}

export function gradingMatrix(weatherKind: string): Float32Array | null {
  const diag = WEATHER_DIAG[weatherKind]
  return diag === undefined ? null : diagMatrix(diag) // null: identity, no filter attached
}
