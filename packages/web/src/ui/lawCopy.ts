// The subpath, never the index: `@sj/engine` re-exports db.ts, which imports better-sqlite3
// at module scope and throws in a browser before React mounts. browserGraph.test.ts pins it.
import { TOGGLABLE_PATHS } from '@sj/engine/laws'

/**
 * U17 — THE TOWN'S RULES, SAID IN WORDS.
 *
 * The panel printed `Object.keys(TOGGLABLE_PATHS).sort()`, so a viewer read `spoilage.days`
 * and `movement.earshotRadius`, and `formatLawValue` fell through to `JSON.stringify` for
 * anything that was not a boolean or a number. That is also the mechanism of audit M2:
 * `spoilage.days` is an object, so its value rendered as one unwrappable blob.
 *
 * Every law says what it DOES TO PEOPLE. The machine path stays, small, underneath — the
 * operator needs it and the viewer does not have to read it first.
 */

export type LawRow = { label: string; value: string }

export type LawCopy = {
  title: string
  sentence: string
  unit: string | null
  /** A formatter that knows the law's own shape. This is what fixes M2: an object-valued law
   *  renders as its own small table, never as JSON. */
  render: (value: unknown) => LawRow[]
}

const UNKNOWN: LawRow[] = [{ label: 'In this town', value: 'not read yet' }]

const yesNo = (value: unknown): LawRow[] =>
  typeof value === 'boolean' ? [{ label: 'In this town', value: value ? 'yes' : 'no' }] : UNKNOWN

const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`

const count = (one: string) => (value: unknown): LawRow[] =>
  typeof value === 'number' ? [{ label: 'Set to', value: plural(value, one) }] : UNKNOWN

/** A bare 0.08 tells a viewer nothing. "eight days in a hundred" tells them how often. */
const chance = (per: string) => (value: unknown): LawRow[] =>
  typeof value === 'number'
    ? [{ label: 'About', value: `${Math.round(value * 100)} ${per} in a hundred` }]
    : UNKNOWN

/** Common ratios have words. Everything else falls back to the honest arithmetic. */
const SHARE_WORD: Readonly<Record<string, string>> = {
  '0.25': 'a quarter', '0.5': 'half', '0.75': 'three quarters', '1': 'the same',
  '1.25': 'a quarter more', '1.5': 'half again', '2': 'twice', '3': 'three times',
}
const share = (tail: string) => (value: unknown): LawRow[] => {
  if (typeof value !== 'number') return UNKNOWN
  const word = SHARE_WORD[String(value)] ?? `${value} times`
  return [{ label: 'Compared with usual', value: `${word} ${tail}` }]
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** AUDIT M2, CLOSED AT THE SOURCE. An object-valued law is a table of its own keys. */
const perFood = (value: unknown): LawRow[] => {
  if (typeof value !== 'object' || value === null) return UNKNOWN
  const rows = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => ({ label: capitalise(k.replace(/[_-]+/g, ' ')), value: plural(v as number, 'day') }))
  return rows.length === 0 ? UNKNOWN : rows
}

/** Total over `TOGGLABLE_PATHS` by construction: a law added to the engine with no copy is a
 *  compile error here, not a machine path leaking onto a screen. */
export const LAW_COPY: Readonly<Record<keyof typeof TOGGLABLE_PATHS, LawCopy>> = {
  'aging.deathOfOldAgeEnabled': {
    title: 'Dying of old age',
    sentence: 'Nobody here lasts forever. A body that has gone on long enough simply stops.',
    unit: null, render: yesNo,
  },
  'reproduction.enabled': {
    title: 'Whether children are born',
    sentence: 'Two people who share a roof through the nights may in time have a child.',
    unit: null, render: yesNo,
  },
  'reproduction.gestationDays': {
    title: 'How long a pregnancy lasts',
    sentence: 'The wait between a child being started and a child arriving in the town.',
    unit: 'days', render: count('day'),
  },
  'reproduction.conceptionChancePerNight': {
    title: 'How often a night makes a child',
    sentence: 'Sharing a bed does not always start a child. Most nights nothing comes of it.',
    unit: null, render: chance('nights'),
  },
  'reproduction.coSleepNightsToPartner': {
    title: 'When two people count as a pair',
    sentence: 'After enough nights under one roof, the town reads two people as together.',
    unit: 'nights', render: count('night'),
  },
  'reproduction.partnerWindowDays': {
    title: 'How long a pairing is remembered',
    sentence: 'Two people who stop sharing a roof drift apart again after a while.',
    unit: 'days', render: count('day'),
  },
  'spoilage.enabled': {
    title: 'Whether food goes bad',
    sentence: 'Food left too long stops being food. Nothing keeps forever out here.',
    unit: null, render: yesNo,
  },
  'spoilage.days': {
    title: 'How long food keeps',
    sentence: 'Fish turns first and bread lasts a while, but grain keeps far longer than either.',
    unit: 'days', render: perFood,
  },
  'spoilage.storehouseMultiplier': {
    title: 'What a storehouse is worth',
    sentence: 'Food kept under a proper roof lasts longer than food left lying in a hut.',
    unit: null, render: share('as long'),
  },
  'tools.wearEnabled': {
    title: 'Whether tools wear out',
    sentence: 'An axe used all season stops cutting like a new one, and one day it breaks.',
    unit: null, render: yesNo,
  },
  'occlusion.enabled': {
    title: 'Whether walls muffle a voice',
    sentence: 'Words spoken indoors stay indoors, unless somebody is standing in the doorway.',
    unit: null, render: yesNo,
  },
  'ownership.enabled': {
    title: 'Whether a thing can belong to someone',
    sentence: 'A hut, a bed and a tool can each have an owner, and the town remembers who.',
    unit: null, render: yesNo,
  },
  'inscription.enabled': {
    title: 'Whether people can carve words',
    sentence: 'Somebody may cut a line into a wall, and it stays there after they are gone.',
    unit: null, render: yesNo,
  },
  'mystery.enabled': {
    title: 'Whether strange things happen',
    sentence: 'Now and then something happens here that nobody in the town can account for.',
    unit: null, render: yesNo,
  },
  'mystery.chancePerDay': {
    title: 'How often a strange thing happens',
    sentence: 'Most days pass with nothing odd in them at all.',
    unit: null, render: chance('days'),
  },
  'seasons.winter.fishCatchMultiplier': {
    title: 'Fishing in winter',
    sentence: 'The river gives up less when it is cold, so a day on the bank feeds fewer people.',
    unit: null, render: share('a catch'),
  },
  'seasons.winter.hungerDecayMultiplier': {
    title: 'Hunger in winter',
    sentence: 'Cold empties a stomach faster, so the winter asks for more food than the summer.',
    unit: null, render: share('as fast'),
  },
}

export function lawCopyFor(path: string): LawCopy | null {
  return LAW_COPY[path] ?? null
}

/** WHAT THE BROWSER CAUGHT: sorted by path, "the body" read as dying of old age, then how
 *  often a night makes a child, then whether children are born at all. The table above is
 *  written in the order a person would ask the questions, so that order is the order. */
const READING_ORDER: readonly string[] = Object.keys(LAW_COPY)
export function lawReadingRank(path: string): number {
  const at = READING_ORDER.indexOf(path)
  return at === -1 ? READING_ORDER.length : at
}

/** Grouping, so seventeen rows read as four subjects rather than an alphabetical dump. */
export const LAW_GROUPS = ['the body', 'the land', 'the weather', 'living together'] as const
export type LawGroup = (typeof LAW_GROUPS)[number]

const GROUP_OF: Readonly<Record<string, LawGroup>> = {
  'aging.deathOfOldAgeEnabled': 'the body',
  'reproduction.enabled': 'the body',
  'reproduction.gestationDays': 'the body',
  'reproduction.conceptionChancePerNight': 'the body',
  'spoilage.enabled': 'the land',
  'spoilage.days': 'the land',
  'spoilage.storehouseMultiplier': 'the land',
  'tools.wearEnabled': 'the land',
  'seasons.winter.fishCatchMultiplier': 'the weather',
  'seasons.winter.hungerDecayMultiplier': 'the weather',
  'occlusion.enabled': 'living together',
  'ownership.enabled': 'living together',
  'inscription.enabled': 'living together',
  'mystery.enabled': 'living together',
  'mystery.chancePerDay': 'living together',
  'reproduction.coSleepNightsToPartner': 'living together',
  'reproduction.partnerWindowDays': 'living together',
}

/** A law nobody has grouped yet still has to land somewhere a viewer can find it. */
export function lawGroupOf(path: string): LawGroup {
  return GROUP_OF[path] ?? 'living together'
}
