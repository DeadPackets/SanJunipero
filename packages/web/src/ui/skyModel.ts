import { DAWN_HOUR, MINUTES_PER_DAY } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'

// ★ WHERE IN THE DAY YOU ARE. One traveller: the sun from dawn to dusk, then the moon over the
// same hours. The day bar's track and the light on the town both read it.

/** The sun is up between these. The SAME boundary `dayPhaseFromTick` calls night, so the arc
 *  and the light on the town can never disagree about when it got dark. */
export const SUN_UP_MIN = DAWN_HOUR * 60
export const SUN_DOWN_MIN = 21 * 60

export type SkyToken = { kind: 'sun' | 'moon'; along: number }

/** Which body is up, and how far along its own hours it has got — 0 at its rise, 1 at its set. */
export function skyToken(tick: number): SkyToken {
  const m = ((Math.floor(tick) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const lit = SUN_DOWN_MIN - SUN_UP_MIN
  if (m >= SUN_UP_MIN && m < SUN_DOWN_MIN) return { kind: 'sun', along: (m - SUN_UP_MIN) / lit }
  const dark = MINUTES_PER_DAY - lit
  const since = m >= SUN_DOWN_MIN ? m - SUN_DOWN_MIN : m + (MINUTES_PER_DAY - SUN_DOWN_MIN)
  return { kind: 'moon', along: since / dark }
}

// ── ★ the same traveller, on the town ────────────────────────────────────────────────────
//
// The token says where the sun and the moon are; the light on the ground reads the SAME token,
// so the mark over the town and the picture under it cannot disagree about the hour.

/** How high the moon is: 0 at its rise and set, 1 in the middle of the night, 0 all day. */
export function moonAltitude(tick: number): number {
  const t = skyToken(tick)
  return t.kind === 'moon' ? Math.sin(Math.PI * t.along) : 0
}

/** What a body's contact shadow does under the sun of this minute. */
export type ShadowCast = { scaleX: number; scaleY: number; dx: number; alpha: number }

/** Noon, and every hour of the night: the blob under the feet, unstretched. */
export const SHADOW_REST: ShadowCast = { scaleX: 1, scaleY: 1, dx: 0, alpha: 1 }

/** Under this height the sun is low enough to draw a shadow out. A fraction of the sun's own
 *  arc rather than an hour, so a longer day keeps the same golden band at each end of it. */
export const GOLDEN_ELEVATION = 0.42
export const SHADOW_MAX_STRETCH = 2.6
/** world px the far end of the longest shadow reaches from the feet that cast it */
const SHADOW_REACH_PX = 13
/** A shadow drawn thin loses its edge: the longest one is this much of the noon blob's ink. */
const SHADOW_MIN_ALPHA = 0.62

export function shadowCast(tick: number): ShadowCast {
  const t = skyToken(tick)
  if (t.kind !== 'sun') return SHADOW_REST
  const elevation = Math.sin(Math.PI * t.along)
  // A hump, not a ramp: the shadow draws out through the golden band and is back under the
  // feet as the sun touches the horizon, so nothing snaps at the minute the light goes.
  const u = Math.max(0, (GOLDEN_ELEVATION - elevation) / GOLDEN_ELEVATION)
  const low = Math.sin(Math.PI * u)
  if (low <= 0) return SHADOW_REST
  const stretch = 1 + (SHADOW_MAX_STRETCH - 1) * low
  return {
    scaleX: stretch,
    // the ground is 2:1 dimetric, so a shadow lying on it grows a third as fast in y as in x
    scaleY: 1 + (stretch - 1) / 3,
    dx: Math.cos(Math.PI * t.along) * SHADOW_REACH_PX * low,
    alpha: 1 - (1 - SHADOW_MIN_ALPHA) * low,
  }
}

// ── the words beside it ──────────────────────────────────────────────────────────────────

/** How cold it is. A town whose snapshot has not landed says nothing about the weather rather
 *  than inventing a temperature. */
export function skyTemp(state: WorldState | null): string {
  return state === null ? '' : `${Math.round(state.weather.temperatureC)}°`
}

/** The sky in two words: what it is doing and how cold it is. */
export function skyWord(state: WorldState | null): string {
  if (state === null) return ''
  return `${state.weather.kind.toUpperCase()} ${skyTemp(state)}`
}

/** The glyph key, so the bar and `WEATHER_GLYPH` cannot drift apart. */
export function skyKind(state: WorldState | null): string {
  return state?.weather.kind ?? '—'
}
