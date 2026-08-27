import { tickToMoment, type AssetRecord, type BondsResponse, type SimEvent } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import { moodOf, portraitUrl, type Expression, type MoodView } from '../../render/mood.js'
import { substanceOf } from '../becoming.js'
import { bondLevel, bondWarmth, LEVEL_RANK, type BondLevel } from '../bondModel2.js'
import { placeOf, type Place } from '../place.js'
import { bustStyle, type BustStyle } from '../bustStyle.js'
import { STATE_WORD, conditionsOf, stateWord, type Condition } from '../status.js'

// P22 shapes every field: on sim-day 0 a row is name + age band + status + place + a neutral mood —
// complete, and visibly a person who has not lived yet. Nothing is authored, nothing is a placeholder.

/** Three honest fallbacks: the painted face, the sprite bust cut from the atlas, the initial. */
type RosterPortrait = { url: string } | { bust: BustStyle } | { token: string }

export type RosterRow2 = {
  id: string
  name: string
  /** a band, never a number (P3) */
  ageWords: 'young' | 'grown' | 'elder'
  portrait: RosterPortrait
  /** v1 task 2's `moodOf` — the ONE face table, reused, never a second one */
  mood: Expression
  /** Exactly one word. */
  state: string
  /** A vocabulary disjoint from `state`. */
  conditions: Condition[]
  place: Place
  /** names of people within earshot — run-produced company */
  with: string[]
  /** 0 on day 0, rising with what they have done. NEVER printed. */
  substance: number
}

const BUST_PX = 48

/** The FALLBACK earshot, for the frames before the snapshot's config has arrived: a transcribed copy
 *  that is also the authority goes stale in silence. `configCopies.test.ts` holds it to
 *  `DEFAULT_CONFIG.movement.earshotRadius`. */
export const EARSHOT_TILES = 8

/** A bond this warm or warmer is a relationship the run actually made. */
const SUBSTANCE_BOND_LEVEL: BondLevel = 'acquaintances'

const ageWordsOf = (ageDays: number): RosterRow2['ageWords'] => {
  const years = Math.floor(ageDays / 364)
  return years < 18 ? 'young' : years < 60 ? 'grown' : 'elder'
}

/**
 * What the run has made of this person, from what the roster can actually see. `personalityVersions`
 * and `changeDays` are zero here and non-zero in the expansion, which fetches them, so a row's
 * substance is a LOWER BOUND on the panel's rather than a different number.
 */
function substanceFor(
  state: WorldState,
  agentId: string,
  bonds: BondsResponse | null,
  nowTick: number,
): number {
  const a = state.agents[agentId]
  if (a === undefined) return 0
  const mine = (bonds?.bonds ?? []).filter((b) => b.aId === agentId || b.bId === agentId)
  const skillXp = Object.values(a.skills).reduce((s, xp) => s + xp, 0)
  return substanceOf({
    actsDone: skillXp + mine.reduce((n, b) => n + b.strength, 0),
    daysLived: tickToMoment(nowTick).day,
    bondsAtOrAbove: mine.filter(
      (b) =>
        LEVEL_RANK.indexOf(bondLevel(bondWarmth(b, nowTick))) >=
        LEVEL_RANK.indexOf(SUBSTANCE_BOND_LEVEL),
    ).length,
    skillBands: Object.keys(a.skills).length,
    personalityVersions: 0,
    changeDays: 0,
  })
}

/** Who is close enough to hear. A person indoors keeps company only with the people in the
 *  room with them — a wall is not earshot. */
function companyOf(state: WorldState, agentId: string, earshot: number | undefined): string[] {
  const radius = earshot !== undefined && earshot > 0 ? earshot : EARSHOT_TILES
  const a = state.agents[agentId]
  if (a === undefined) return []
  const out: string[] = []
  for (const other of Object.values(state.agents)) {
    if (other.id === agentId || !other.alive) continue
    if (a.insideId !== undefined || other.insideId !== undefined) {
      if (a.insideId !== other.insideId) continue
    } else if (Math.hypot(other.x - a.x, other.y - a.y) > radius) continue
    out.push(other.name)
  }
  return out.sort()
}

export function rosterRows2(
  state: WorldState | null,
  records: AssetRecord[],
  bonds: BondsResponse | null,
  nowTick: number,
  recent: readonly SimEvent[] = [],
  /** The world's own `movement.earshotRadius`, off the snapshot. Absent falls back. */
  earshot?: number,
): RosterRow2[] {
  if (state === null) return []
  const rows: RosterRow2[] = []
  for (const a of Object.values(state.agents)) {
    if (!a.alive) continue
    const view: MoodView = {
      id: a.id,
      alive: a.alive,
      asleep: a.asleep,
      ill: a.ill,
      injuries: a.injuries,
      needs: a.needs,
      collapsedSinceTick: a.collapsedSinceTick,
    }
    const mood = moodOf(view, recent, nowTick)
    const url = portraitUrl(records, a.id, mood)
    const bust = url === null ? bustStyle(records, a.id, BUST_PX) : null
    rows.push({
      id: a.id,
      name: a.name,
      ageWords: ageWordsOf(a.ageDays),
      portrait: url !== null ? { url } : bust !== null ? { bust } : { token: a.name.slice(0, 1) },
      mood,
      state: stateWord(a, nowTick),
      conditions: conditionsOf(a),
      place: placeOf(state, a.id),
      with: companyOf(state, a.id, earshot),
      substance: substanceFor(state, a.id, bonds, nowTick),
    })
  }
  return sortRoster(rows, 'name')
}

/** Sorting is a viewer PREFERENCE, never a ranking (P3): by name, by where they are, or by who
 *  is doing something right now. No "best", no order badge, no number on a card. */
export const ROSTER_SORTS = ['name', 'place', 'active'] as const
export type RosterSort = (typeof ROSTER_SORTS)[number]

/** Short enough that three of them sit on one line above the roster — browser-caught: the
 *  longer phrasings wrapped every chip onto two lines and the header ate the first row. */
export const ROSTER_SORT_WORD: Readonly<Record<RosterSort, string>> = {
  name: 'By name',
  place: 'By place',
  active: 'By who is busy',
}

const byName = (x: RosterRow2, y: RosterRow2): number =>
  x.name < y.name ? -1 : x.name > y.name ? 1 : x.id < y.id ? -1 : 1

/** Stable and total: every sort falls back to the name, so two reads can never disagree. */
export function sortRoster(rows: readonly RosterRow2[], by: RosterSort): RosterRow2[] {
  const out = [...rows]
  if (by === 'place') {
    out.sort((x, y) =>
      x.place.words < y.place.words ? -1 : x.place.words > y.place.words ? 1 : byName(x, y),
    )
  } else if (by === 'active') {
    const idle = (r: RosterRow2): number =>
      r.state === STATE_WORD.idle || r.state === STATE_WORD.asleep ? 1 : 0
    out.sort((x, y) => idle(x) - idle(y) || byName(x, y))
  } else {
    out.sort(byName)
  }
  return out
}

// ── the mood icon: drawn, never an emoji (the landed law) ─────────────────────────────────

export const MOOD_GLYPH_PX = 16

const INK = '#43394A',
  HONEY = '#F2C879',
  SAGE = '#93B573',
  WATER = '#7FB0C9'
const ROSE = '#C47876',
  EMBER = '#E8785A',
  STONE = '#ABA198'

/** Every fill a mood glyph may use — all MASTER_PALETTE members, asserted as a set. */
export const MOOD_GLYPH_PALETTE: readonly string[] = [INK, HONEY, SAGE, WATER, ROSE, EMBER, STONE]

const KEY: Readonly<Record<string, string>> = {
  i: INK,
  h: HONEY,
  g: SAGE,
  w: WATER,
  r: ROSE,
  e: EMBER,
  s: STONE,
}

export type MoodPixel = readonly [number, number, string]

/** Sixteen rows of sixteen characters: `.` is empty, every other letter is a palette key.
 *  Written as pictures, because a table of coordinates is a picture nobody can read. */
function art(...rows: string[]): MoodPixel[] {
  const out: MoodPixel[] = []
  rows.forEach((row, y) => {
    // by code unit, not code point: x is the column in a fixed-width ASCII grid
    for (let x = 0; x < row.length; x++) {
      const fill = KEY[row.charAt(x)]
      if (fill !== undefined) out.push([x, y, fill] as const)
    }
  })
  return out
}

/** A ring, so every face reads as a face at 16 px; the brow and the mouth carry the feeling.
 *  Seven faces that look alike would be the same defect as one face, so no two are identical. */
export const MOOD_GLYPH: Readonly<Record<Expression, MoodPixel[]>> = {
  neutral: art(
    '.....iiiiii.....',
    '...ii......ii...',
    '..i..........i..',
    '.i............i.',
    '.i............i.',
    'i..............i',
    'i...ii....ii...i',
    'i...ii....ii...i',
    'i..............i',
    'i..............i',
    '.i....iiii....i.',
    '.i............i.',
    '..i..........i..',
    '...ii......ii...',
    '.....iiiiii.....',
    '................',
  ),
  happy: art(
    '.....hhhhhh.....',
    '...hh......hh...',
    '..h..........h..',
    '.h............h.',
    '.h............h.',
    'h..............h',
    'h...ii....ii...h',
    'h..ii......ii..h',
    'h..............h',
    'h..i........i..h',
    '.h..ii....ii..h.',
    '.h....iiii....h.',
    '..h..........h..',
    '...hh......hh...',
    '.....hhhhhh.....',
    '................',
  ),
  sad: art(
    '.....wwwwww.....',
    '...ww......ww...',
    '..w..........w..',
    '.w............w.',
    '.w............w.',
    'w..............w',
    'w...ii....ii...w',
    'w...ii....ii...w',
    'w...w..........w',
    'w...w..........w',
    '.w....iiii....w.',
    '.w...i....i...w.',
    '..w..........w..',
    '...ww......ww...',
    '.....wwwwww.....',
    '................',
  ),
  angry: art(
    '.....eeeeee.....',
    '...ee......ee...',
    '..e..........e..',
    '.e...i......i.e.',
    '.e....i....i..e.',
    'e..............e',
    'e...ii....ii...e',
    'e...ii....ii...e',
    'e..............e',
    'e..............e',
    '.e...iiiiii...e.',
    '.e..i......i..e.',
    '..e..........e..',
    '...ee......ee...',
    '.....eeeeee.....',
    '................',
  ),
  surprised: art(
    '.....hhhhhh.....',
    '...hh......hh...',
    '..h..........h..',
    '.h...ii..ii...h.',
    '.h............h.',
    'h...iiii..iiii.h',
    'h..i....ii....ih',
    'h..i..ii..i..i.h',
    'h...iiii..iiii.h',
    'h......ii......h',
    '.h....i..i....h.',
    '.h....i..i....h.',
    '..h....ii....h..',
    '...hh......hh...',
    '.....hhhhhh.....',
    '................',
  ),
  weary: art(
    '.....ssssss.....',
    '...ss......ss...',
    '..s..........s..',
    '.s............s.',
    '.s...ii....ii.s.',
    's..............s',
    's..iiii..iiii..s',
    's..............s',
    's...s......s...s',
    's...s......s...s',
    '.s...iiiiii...s.',
    '.s............s.',
    '..s..........s..',
    '...ss......ss...',
    '.....ssssss.....',
    '................',
  ),
  asleep: art(
    '.....gggggg.....',
    '...gg......gg...',
    '..g..........g..',
    '.g............g.',
    '.g............g.',
    'g..............g',
    'g..iiii..iiii..g',
    'g..............g',
    'g..............g',
    'g......ii......g',
    '.g....iiii....g.',
    '.g.....ii.....g.',
    '..g..........g..',
    '...gg......gg...',
    '.....gggggg.....',
    '.......rrr......',
  ),
}

export function moodGlyph(e: Expression): MoodPixel[] {
  return MOOD_GLYPH[e]
}

/** What the icon is called out loud, describing the drawn FACE. None of these may be a synonym of a
 *  state word: `asleep: 'sleeping'` would put two words for one fact back in the row. */
export const MOOD_WORD: Readonly<Record<Expression, string>> = {
  neutral: 'settled',
  happy: 'in good spirits',
  sad: 'low',
  angry: 'angry',
  surprised: 'startled',
  weary: 'worn down',
  asleep: 'eyes closed',
}
