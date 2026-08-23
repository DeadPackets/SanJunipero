import type { Moment } from '@sj/shared'
import type { PeopleIndex } from './bondsModel.js'

export const THUMB_CAST_MAX = 2

export type ThumbLabel = { day: number; cast: string; location: string | null }

// A postcard, not a screenshot: who was there, where, and which day it was. A real capture of
// the scene would need a second headless renderer (deferred — plan's Open Question 1); the
// deep link and the playback are the substance, this is the affordance.
export function thumbLabel(m: Moment, people: PeopleIndex): ThumbLabel {
  const named = m.cast.slice(0, THUMB_CAST_MAX).map((id) => people[id]?.name ?? id)
  const rest = m.cast.length - named.length
  const cast = named.length === 0 ? 'the town' : named.join(', ') + (rest > 0 ? ` +${rest}` : '')
  return { day: m.day, cast, location: m.location }
}

export function thumbTitle(m: Moment): string {
  return m.title
}

// ------------------------------------------------------------------ location motifs

export type Motif = { name: string; pixels: ReadonlyArray<readonly [number, number, string]> }

const INK = '#43394A', EMBER = '#E8785A', HONEY = '#F2C879', SAGE = '#93B573'
const WATER = '#7FB0C9', STONE = '#ABA198', SAND = '#E8D5BC'

const px = (
  fill: string, ...cells: ReadonlyArray<readonly [number, number]>
): Array<readonly [number, number, string]> => cells.map(([x, y]) => [x, y, fill] as const)

export const MOTIFS: readonly Motif[] = [
  {
    name: 'stone',
    pixels: [
      ...px(STONE, [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2]),
      ...px(STONE, [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3]),
      ...px(SAND, [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4]),
      ...px(INK, [3, 2], [2, 4], [5, 4]),
    ],
  },
  {
    name: 'water',
    pixels: [
      ...px(WATER, [0, 2], [1, 3], [2, 2], [3, 3], [4, 2], [5, 3], [6, 2], [7, 3]),
      ...px(WATER, [0, 5], [1, 4], [2, 5], [3, 4], [4, 5], [5, 4], [6, 5], [7, 4]),
    ],
  },
  {
    name: 'field',
    pixels: [
      ...px(SAGE, [1, 1], [1, 2], [3, 1], [3, 2], [5, 1], [5, 2]),
      ...px(HONEY, [1, 3], [3, 3], [5, 3]),
      ...px(SAND, [0, 5], [1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5]),
    ],
  },
  {
    name: 'hearth',
    pixels: [
      ...px(INK, [1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5]),
      ...px(INK, [1, 3], [1, 4], [6, 3], [6, 4]),
      ...px(EMBER, [3, 3], [4, 3], [2, 4], [3, 4], [4, 4], [5, 4]),
      ...px(HONEY, [3, 4]),
    ],
  },
  {
    name: 'tree',
    pixels: [
      ...px(SAGE, [3, 0], [4, 0], [2, 1], [3, 1], [4, 1], [5, 1]),
      ...px(SAGE, [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [2, 3], [3, 3], [4, 3], [5, 3]),
      ...px(INK, [3, 4], [4, 4], [3, 5], [4, 5]),
    ],
  },
]

const MOTIF_BY_NAME = new Map(MOTIFS.map((m) => [m.name, m]))

// Authored, not guessed: a small keyword table over the narrator's own location words.
const MOTIF_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/plaza|square|road|street|stone|wall/, 'stone'],
  [/river|water|bank|well|lake|shore/, 'water'],
  [/field|farm|crop|meadow|garden/, 'field'],
  [/house|house|home|hearth|storehouse|shed|inside/, 'hearth'],
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
