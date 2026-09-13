import { agentName } from '@sj/shared'
import type { Moment } from '@sj/shared'
import type { PeopleIndex } from './bondModel2.js'
import { art } from './pixelArt.js'

export const THUMB_CAST_MAX = 2

export type ThumbLabel = { day: number; cast: string; location: string | null }

// A postcard, not a screenshot: a real capture of the scene would need a second headless renderer.
// The deep link and the playback are the substance; this is the affordance.
export function thumbLabel(m: Moment, people: PeopleIndex): ThumbLabel {
  const named = m.cast.slice(0, THUMB_CAST_MAX).map((id) => agentName(people, id))
  const rest = m.cast.length - named.length
  const cast = named.length === 0 ? 'the town' : named.join(', ') + (rest > 0 ? ` +${rest}` : '')
  return { day: m.day, cast, location: m.location }
}

// ------------------------------------------------------------------ location motifs

export type Motif = { name: string; pixels: readonly (readonly [number, number, string])[] }

export const MOTIFS: readonly Motif[] = [
  {
    name: 'stone',
    // the ink joints are set into the paving, so they come second
    pixels: [
      ...art('........', '........', '.ssssss.', '.ssssss.', '.aaaaaa.'),
      ...art('........', '........', '...i....', '........', '..i..i..'),
    ],
  },
  {
    name: 'water',
    pixels: art('........', '........', 'w.w.w.w.', '.w.w.w.w', '.w.w.w.w', 'w.w.w.w.'),
  },
  {
    name: 'field',
    pixels: art('........', '.g.g.g..', '.g.g.g..', '.h.h.h..', '........', 'aaaaaaaa'),
  },
  {
    name: 'hearth',
    // the honey heart sits on the embers, so it comes second
    pixels: [
      ...art('........', '........', '........', '.i.ee.i.', '.ieeeei.', '.iiiiii.'),
      ...art('........', '........', '........', '........', '...h....'),
    ],
  },
  {
    name: 'tree',
    pixels: art('...gg...', '..gggg..', '.gggggg.', '..gggg..', '...ii...', '...ii...'),
  },
]

const MOTIF_BY_NAME = new Map(MOTIFS.map((m) => [m.name, m]))

// Authored, not guessed: a small keyword table over the narrator's own location words.
const MOTIF_WORDS: readonly (readonly [RegExp, string])[] = [
  [/plaza|square|road|street|stone|wall/, 'stone'],
  [/river|water|bank|well|lake|shore/, 'water'],
  [/field|farm|crop|meadow|garden/, 'field'],
  [/house|home|hearth|storehouse|shed|inside/, 'hearth'],
  [/forest|tree|wood|grove/, 'tree'],
]

export function thumbMotif(m: Moment): Motif {
  const where = (m.location ?? '').toLowerCase()
  for (const [re, name] of MOTIF_WORDS) if (re.test(where)) return MOTIF_BY_NAME.get(name)!
  // Nothing matched: pick one by a stable hash of the place, or of the day when there is
  // no place at all, so the same postcard always wears the same motif.
  const seed = where === '' ? String(m.day) : where
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return MOTIFS[h % MOTIFS.length]!
}

// ------------------------------------------------------------------ the day's own shelf

/** One day of the town's record: the scene with most at stake leads, and the rest of that day
 *  wait behind it. Thirty cards a day is a filmstrip nobody reads to the end of. */
export type MomentDay = { day: number; lead: Moment; rest: Moment[] }

export function momentDays(moments: readonly Moment[]): MomentDay[] {
  const byDay = new Map<number, Moment[]>()
  for (const m of moments) {
    const seen = byDay.get(m.day)
    if (seen === undefined) byDay.set(m.day, [m])
    else seen.push(m)
  }
  return [...byDay]
    .sort((a, b) => b[0] - a[0])
    .map(([day, list]) => {
      const sorted = [...list].sort((a, b) => b.stakes - a.stakes || a.startTick - b.startTick)
      return { day, lead: sorted[0]!, rest: sorted.slice(1) }
    })
}

/** How many others that day holds, said as words. Not a score and not a total: the town has no
 *  denominator, and this only says how much more there is to look at. */
export function moreFromDay(rest: readonly Moment[]): string {
  return rest.length === 1 ? 'One more from this day' : `${rest.length} more from this day`
}
