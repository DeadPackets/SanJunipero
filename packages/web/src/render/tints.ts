import type { Season } from '@sj/shared'

// LUT reuses forge's calibrated atmosphere TINTS — the palette was locked under these.
export const CLOCK_STOPS: Array<{ minute: number; tint: [number, number, number] }> = [
  { minute: 0, tint: [0.45, 0.52, 0.95] }, // deep night   (forge TINTS.night)
  { minute: 300, tint: [0.45, 0.52, 0.95] }, // 05:00 still night
  { minute: 390, tint: [1.0, 0.94, 0.78] }, // 06:30 golden dawn (TINTS.dawn clamped ≤1)
  { minute: 480, tint: [1.0, 1.0, 1.0] }, // 08:00 full day
  { minute: 1050, tint: [1.0, 1.0, 1.0] }, // 17:30 day holds
  { minute: 1140, tint: [1.0, 0.94, 0.78] }, // 19:00 golden dusk
  { minute: 1230, tint: [0.45, 0.52, 0.95] }, // 20:30 night
  { minute: 1440, tint: [0.45, 0.52, 0.95] },
]

export const STORM_DIAG: [number, number, number] = [0.72, 0.82, 0.76] // grey-green (TINTS.storm)
// TINTS.winter blue 1.10 exceeds ColorMatrix-safe 1.0 headroom on lit pixels — clamped; r/g keep the ratio
export const WINTER_DIAG: [number, number, number] = [0.86, 0.93, 1.0]

export function clockTint(minuteOfDay: number): number {
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
  const ch = (i: 0 | 1 | 2): number =>
    Math.round((lo.tint[i] + (hi.tint[i] - lo.tint[i]) * t) * 255)
  return (ch(0) << 16) | (ch(1) << 8) | ch(2)
}

function diagMatrix([r, g, b]: [number, number, number]): Float32Array {
  // pixi ColorMatrixFilter layout: 4 rows × 5 columns
  const m = new Float32Array(20)
  m[0] = r
  m[6] = g
  m[12] = b
  m[18] = 1
  return m
}

export function gradingMatrix(weatherKind: string, season: Season): Float32Array | null {
  if (weatherKind === 'storm' || weatherKind === 'rain') return diagMatrix(STORM_DIAG)
  if (season === 'winter' && (weatherKind === 'snow' || weatherKind === 'clear'))
    return diagMatrix(WINTER_DIAG)
  return null // identity — no filter attached
}
