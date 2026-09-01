import { sanitizeSpokenText } from './speech.js'

/** A kind is a slug in the engine and PROSE to a viewer. One owner for the conversion, so a
 *  fourth call site cannot forget it the way three already did. */
export function kindWords(kind: string): string {
  return kind.replace(/_/g, ' ')
}

/** Structural, so the gateway and the viewer can both name a building without either of them
 *  reaching for the engine's `Structure`. */
export type Titled = {
  kind: string
  name?: string | undefined
  inscription?: { text: string } | undefined
}

/** What the town calls a building, everywhere a viewer reads its name: the name a hand carved
 *  into it, then the words of the inscription, and only then the kind it is. It takes the
 *  building, not an id, so no caller has a not-there case to invent an answer for. */
export function structureTitle(s: Titled): string {
  // A carved word is one mind's text landing in another's eye, so it goes through the same
  // sanitizer `placeName` names a place with. R4: a hover used to read "fire_pit".
  const written = s.name ?? s.inscription?.text
  const carved = written === undefined ? '' : sanitizeSpokenText(written)
  return carved === '' ? kindWords(s.kind) : carved
}

export type SitedThing = Titled & { x: number; y: number; w: number; h: number }

/** How close is "at". Two tiles is a person standing beside a thing, not walking past it. */
const AT_RADIUS_TILES = 2

/** Chebyshev distance from a point to a footprint — 0 while standing on it. */
function tilesFrom(s: SitedThing, x: number, y: number): number {
  const dx = Math.max(s.x - x, 0, x - (s.x + s.w - 1))
  const dy = Math.max(s.y - y, 0, y - (s.y + s.h - 1))
  return Math.max(dx, dy)
}

/** A tile already written as words is already an answer; only a raw pair is resolved. `segment.ts`
 *  is the one writer of that format, and this is its one reader. */
export function placeWordsForLocation(
  structures: readonly SitedThing[],
  location: string,
): string | null {
  const m = /^(\d+),(\d+)$/u.exec(location)
  return m === null ? location : placeWordsAt(structures, Number(m[1]), Number(m[2]))
}

/** R4: a place is words or it is nothing — a viewer is never handed a pair of numbers. */
export function placeWordsAt(
  structures: readonly SitedThing[],
  x: number,
  y: number,
): string | null {
  let best: SitedThing | null = null
  let bestAt = Infinity
  for (const s of structures) {
    const d = tilesFrom(s, x, y)
    if (d < bestAt) {
      bestAt = d
      best = s
    }
  }
  return best === null || bestAt > AT_RADIUS_TILES ? null : structureTitle(best)
}
