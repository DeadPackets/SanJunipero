import { BODY_TERMS } from '@sj/shared'

// ★ HOW HARD A MOMENT LANDS, AND NOTHING HERE DECIDES WHAT MATTERS. The rank is `BODY_TERMS`,
// read by event type, and a type that table does not name lands as the smallest beat there is.

export type BeatName = 'swell' | 'beat' | 'flick' | 'tap' | 'settle'

/** A single arch: up, and back to rest. */
const arch = (p: number): number => Math.sin(Math.PI * p)
/** A thing dropping into place: at the peak on arrival, squashing under itself, then still. */
const land = (p: number): number => (1 - p) * (1 - p) * Math.cos(3 * Math.PI * p)

/** The five, loudest first. `peak` is the scale at the far end of the curve. */
export const BEATS: Readonly<
  Record<BeatName, { ms: number; peak: number; curve: (p: number) => number }>
> = {
  swell: { ms: 560, peak: 1.26, curve: arch },
  beat: { ms: 380, peak: 1.16, curve: arch },
  flick: { ms: 260, peak: 1.1, curve: arch },
  tap: { ms: 160, peak: 1.05, curve: arch },
  settle: { ms: 420, peak: 1.2, curve: land },
}

/** The rungs the bands break on, read off `BODY_TERMS` rows and never transcribed: when the
 *  world re-ranks a parting or a discovery, the picture re-ranks with it. */
const SWELL_AT = BODY_TERMS.agent_born!
const BEAT_AT = BODY_TERMS.agent_departed!
const FLICK_AT = BODY_TERMS.discovery_made!

/** ★ The shape a moment is drawn in, and null for one no body is left to carry. A death is the
 *  only one: `rendersOnMap` drops a body the tick it stops being alive. */
export function beatFor(type: string): BeatName | null {
  if (type === 'agent_died') return null
  if (type === 'structure_completed') return 'settle'
  const weight = BODY_TERMS[type] ?? 0
  if (weight >= SWELL_AT) return 'swell'
  if (weight >= BEAT_AT) return 'beat'
  return weight >= FLICK_AT ? 'flick' : 'tap'
}

/** The scale multiplier `ageMs` into a beat, and null once it is over. */
export function beatScale(name: BeatName, ageMs: number): number | null {
  const b = BEATS[name]
  const p = ageMs / b.ms
  if (p < 0 || p >= 1) return null
  return 1 + (b.peak - 1) * b.curve(p)
}
