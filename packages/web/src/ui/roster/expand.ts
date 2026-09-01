import { type BondsResponse, type SimEvent, personWords, tickToMoment } from '@sj/shared'
import type { ChangeEntry } from '../becoming.js'
import {
  BOND_LEVEL_WORD,
  LEVEL_RANK,
  bondArc,
  bondLevel,
  bondTypeOf,
  bondWarmth,
  partnerEvidence,
  relationLine,
  type BondLevel,
  type BondType,
  type LineageLike,
} from '../bondModel2.js'

// Expansion is a state of the LIST, not a route: the list never unmounts, so there is no "back"
// left to get wrong. Every section is RUN-PRODUCED and says so honestly when the run produced none.

export type ExpandState = { openId: string | null }
export type ExpandEv =
  | { kind: 'toggle'; id: string }
  | { kind: 'close' }
  | { kind: 'next' }
  | { kind: 'prev' }

export const CLOSED: ExpandState = { openId: null }

/** One row open at a time. An id the list does not hold is ignored, rather than opening a
 *  state shaped like nothing. */
export function expandReducer(
  prev: ExpandState,
  ev: ExpandEv,
  ids: readonly string[],
): ExpandState {
  switch (ev.kind) {
    case 'close':
      return prev.openId === null ? prev : CLOSED
    case 'toggle': {
      if (!ids.includes(ev.id)) return prev
      return prev.openId === ev.id ? CLOSED : { openId: ev.id }
    }
    case 'next':
    case 'prev': {
      if (ids.length === 0) return prev
      const step = ev.kind === 'next' ? 1 : -1
      const at = prev.openId === null ? -1 : ids.indexOf(prev.openId)
      if (at < 0) return { openId: (step === 1 ? ids[0] : ids[ids.length - 1])! }
      return { openId: ids[(at + step + ids.length) % ids.length]! }
    }
  }
}

// ── the becoming, as sections ──────────────────────────────────────────────────────────────

export type Becoming = {
  /** the one authored-SHAPED sentence, and it is arithmetic rather than a trait */
  lived: string
  /** what they have actually done, from the log, newest day first */
  done: { words: string; day: number }[]
  knows: { id: string; name: string; level: BondLevel; type: BondType; words: string }[]
  /** skill BANDS in words, never xp and never a level number */
  good: { words: string }[]
  /** drives — empty until the society lane emits them, and an empty section does not render */
  wants: { words: string }[]
  /** P22.5 — the days this person became different */
  changed: { day: number; words: string }[]
}

/** One line per section for a person the run has not yet made anything of. Each says THIS PERSON
 *  has not done it yet, never that the town has not started. */
export const SECTION_EMPTY: Readonly<Record<keyof Becoming, string>> = {
  lived: 'They arrived today.',
  done: 'They have not done anything the town wrote down yet.',
  knows: 'They have not met anyone yet.',
  good: 'They have not taken up a craft yet.',
  wants: 'What they want is not something the town can tell yet.',
  changed: 'Nothing about them has changed yet — they have only just arrived.',
}

export const SECTION_TITLE: Readonly<Record<keyof Becoming, string>> = {
  lived: 'So far',
  done: 'What they have done',
  knows: 'Who they know',
  good: 'What they are good at',
  wants: 'What they seem to want',
  changed: 'The days they became different',
}

const SMALL = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
] as const

const inWords = (n: number): string => SMALL[n] ?? String(n)

/** Five bands, no numbers — the same shape v1 task 22's `skillPhrase` lands with. */
export const SKILL_BANDS: readonly { at: number; words: string }[] = [
  { at: 4, words: 'has just started' },
  { at: 12, words: 'is getting the hang of' },
  { at: 30, words: 'has a practised hand at' },
  { at: 70, words: 'is relied on for' },
  { at: Infinity, words: 'is the one the town asks about' },
]

export function skillBand(xp: number): string {
  for (const b of SKILL_BANDS) if (xp <= b.at) return b.words
  return SKILL_BANDS[SKILL_BANDS.length - 1]!.words
}

/** One skill, said the way the deep-presentation addendum says it — never "fishing, level 2".
 *  The roster card and the inspector must not word the same person's fishing differently. */
export const skillPhrase = (track: string, xp: number): string =>
  `${skillBand(xp)} ${track.replace(/_/g, ' ')}`

/** The bond log and the live feed are both dated records of things that HAPPENED. Nothing here is
 *  inferred from who somebody is. */
const ACT_WORDS: Readonly<Record<string, string>> = {
  spoke: 'talked with someone',
  teach: 'taught someone something',
  give: 'gave something away',
  co_slept: 'shared a roof',
  attack: 'came to blows',
  born: 'became a parent',
}

const FEED_WORDS: Readonly<Record<string, string>> = {
  structure_completed: 'finished a building',
  crop_planted: 'put a crop in the ground',
  crop_harvested: 'brought a harvest in',
  item_crafted: 'made something',
  agent_spoke: 'spoke up',
}

export function actsOf(
  agentId: string,
  bonds: BondsResponse | null,
  events: readonly SimEvent[],
): { tick: number; words: string }[] {
  const out: { tick: number; words: string }[] = []
  for (const b of bonds?.bonds ?? []) {
    if (b.aId !== agentId && b.bId !== agentId) continue
    // The window says what has happened lately; the rollup's two stamps keep the day an act FIRST
    // happened. Both fold to one row per day per act, so nothing is duplicated.
    const ticks: { tick: number; kind: string }[] = [
      ...b.recent,
      ...b.acts.flatMap((a) => [
        { tick: a.firstTick, kind: a.kind },
        { tick: a.lastTick, kind: a.kind },
      ]),
    ]
    for (const h of ticks) {
      const words = ACT_WORDS[h.kind] ?? ACT_WORDS[BOND_ACT[h.kind] ?? ''] ?? null
      if (words === null) continue
      // the window and the two stamps overlap by construction; one act is one entry
      if (out.some((o) => o.tick === h.tick && o.words === words)) continue
      out.push({ tick: h.tick, words })
    }
  }
  for (const ev of events) {
    const words = FEED_WORDS[ev.type]
    if (words === undefined) continue
    const p = ev.payload as Record<string, unknown>
    if (p.agentId !== agentId && p.builderId !== agentId && p.id !== agentId) continue
    out.push({ tick: ev.tick, words })
  }
  return out
}

/** the endpoint records a BondKind; the acts above are named the way the plan names them */
const BOND_ACT: Readonly<Record<string, string>> = {
  friend: 'spoke',
  work: 'teach',
  owe: 'give',
  partner: 'co_slept',
  kin: 'born',
  rival: 'attack',
}

export type BecomingInput = {
  id: string
  name: string
  nowTick: number
  skills: Readonly<Record<string, number>>
  acts: readonly { tick: number; words: string }[]
  bonds: BondsResponse | null
  lineage: LineageLike
  /** id → name, from the world the viewer already holds */
  people: Readonly<Record<string, string>>
  changes: readonly ChangeEntry[]
}

/** The most recent day is the one that is true now, so `done` and `changed` lead with it. */
export function becomingOf(input: BecomingInput): Becoming {
  const days = tickToMoment(input.nowTick).day

  // one row per DAY per kind of act — a list of two hundred "talked with someone" is a log,
  // not a biography
  const byDayKind = new Map<string, { words: string; day: number }>()
  for (const a of input.acts) {
    const day = tickToMoment(a.tick).day
    byDayKind.set(`${day}\n${a.words}`, { words: a.words, day })
  }
  const done = [...byDayKind.values()].sort((x, y) => y.day - x.day || (x.words < y.words ? -1 : 1))

  const knows: Becoming['knows'] = []
  for (const b of input.bonds?.bonds ?? []) {
    if (b.aId !== input.id && b.bId !== input.id) continue
    const otherId = b.aId === input.id ? b.bId : b.aId
    const name = personWords(input.people[otherId])
    const level = bondLevel(bondWarmth(b, input.nowTick))
    const type = bondTypeOf(input.id, otherId, input.lineage, input.bonds!)
    const arc = bondArc(b, input.nowTick)
    const evidence = type === 'partner' ? partnerEvidence(b) : null
    const line = relationLine(type, level, arc, [input.name, name])
    knows.push({
      id: otherId,
      name,
      level,
      type,
      words: evidence === null ? line : `${line} ${evidence}`,
    })
  }
  // warmest first, then by name — a reading order, never a ranking
  knows.sort(
    (x, y) =>
      LEVEL_RANK.indexOf(y.level) - LEVEL_RANK.indexOf(x.level) || (x.name < y.name ? -1 : 1),
  )

  const good = Object.entries(input.skills)
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    .map(([track, xp]) => ({ words: skillPhrase(track, xp) }))

  const changed = input.changes
    .filter((c) => c.diff.length > 0)
    .map((c) => ({ day: c.day, words: c.edit }))

  return {
    // WHAT THE BROWSER CAUGHT: "One days in the town." — the one arithmetic sentence in the
    // whole panel, and it could not count to one.
    lived:
      days === 0
        ? SECTION_EMPTY.lived
        : `${inWords(days)} ${days === 1 ? 'day' : 'days'} in the town.`,
    done,
    knows,
    good,
    wants: [], // the society lane's, and an empty section renders nothing at all
    changed,
  }
}

/** Which sections have something to say. `wants` is never shown while it is empty (P22.2). */
export const ALWAYS_SHOWN: readonly (keyof Becoming)[] = [
  'lived',
  'done',
  'knows',
  'good',
  'changed',
]

export const BOND_LEVEL_LABEL = BOND_LEVEL_WORD
