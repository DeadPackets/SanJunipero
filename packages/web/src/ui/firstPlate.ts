import type { MilestoneRead } from '@sj/shared/narratorSchema'

// CEREMONY, NOT COMPETITION. Nobody in this town is competing, tier 2.5 is minted by the
// arbiter, and the catalogue has no denominator — so "23 of 61" would be a lie. What a plate
// carries is the feeling of an unlock without any of its arithmetic: no count, no bar, no
// streak, no points, no badge, no leaderboard, and no tier number anywhere on the page.

/** The material a tier is cut from. Rarity is carried by the ink, never by a number: gilded for
 *  what the town made itself, ember for what one mind worked out, sage for a pattern, sand for
 *  a thing that simply happened first. */
export type PlateMaterial = 'gilded' | 'ember' | 'sage' | 'sand'

const MATERIAL: Readonly<Record<string, PlateMaterial>> = {
  '3': 'gilded',
  '2.5': 'ember',
  '2': 'sage',
  '1': 'sand',
}

export function plateMaterial(tier: number): PlateMaterial {
  return MATERIAL[String(tier)] ?? 'sand'
}

/** What a first is ABOUT, in the glyph vocabulary the chronicle already draws. Keyed off the
 *  kind's own word rather than off the `domain` column, which reads `engine` for 33 of the 38
 *  firsts the catalogue ships and would put one shape on nearly all of them. Ordered: the first
 *  rule that matches wins, so `first_fire_out` is read before `first_fire`. */
const GLYPH_RULES: readonly (readonly [RegExp, string])[] = [
  [/death|grave|injur|slain|theft/, 'cross'],
  [/fire/, 'flame'],
  [/law|inscription|speech|expression/, 'quill'],
  [/house|structure|shelter|store/, 'house'],
  [/road|bridge|channel|path/, 'road'],
  [/invention|tool|craft|recipe/, 'key'],
  [/harvest|meal|fish|hunt|crop|forage|infection|recover|illness/, 'leaf'],
  [/birth|pregnan|marriage|partner|bond|kept|trade|gift/, 'heart'],
  [/world|winter|year|season|grown/, 'star'],
]

/** The shape every first used to share. Still the answer for one the rules do not know — a
 *  minted kind is a real first, and a plate with no glyph is worse than a general one. */
export const FIRST_GLYPH_FALLBACK = 'spark'

export function firstGlyph(kind: string): string {
  for (const [re, glyph] of GLYPH_RULES) if (re.test(kind)) return glyph
  return FIRST_GLYPH_FALLBACK
}

/** A dog-ear, not a toast: a first the town reached while nobody was watching is turned down at
 *  the corner, and turns back the moment this visit has caught up to it. */
export function isNew(first: { tick: number }, lastSeenTick: number | null): boolean {
  return lastSeenTick !== null && first.tick > lastSeenTick
}

/** What the plate prints, with nothing on it the town would not say. */
export type FirstPlate = {
  kind: string
  label: string
  glyph: string
  material: PlateMaterial
  tick: number
  cast: readonly string[]
  quote: string | null
  /** The day the line was said, where the narrator caught this first in somebody's speech. Null
   *  for a quote the town only named the thing out of, which carries no speaker either. */
  quoteDay: number | null
  fresh: boolean
}

export function firstPlate(first: MilestoneRead, lastSeenTick: number | null): FirstPlate {
  const caught = first.detected ?? null
  return {
    kind: first.kind,
    label: first.label,
    glyph: firstGlyph(first.kind),
    material: plateMaterial(first.tier),
    tick: first.tick,
    cast: first.agentIds,
    quote: caught?.quote ?? first.nameProvenance?.quote ?? null,
    quoteDay: caught === null ? null : caught.day,
    fresh: isNew(first, lastSeenTick),
  }
}
