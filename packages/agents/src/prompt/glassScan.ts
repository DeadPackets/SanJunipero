// One-way glass, mechanically. The ops plane names what it sees — construct types, milestone
// kinds, tier labels — and not one of those words may ever reach a mind. Labelling never
// causes behaviour, and this file is why that is a fact rather than a promise.

// Every word the ops plane uses for a THING IT NAMES. A word for a thing in the world (a fire
// pit, a hide, a bridge) is not on this list and never will be: only the taxonomy is banned.
// Deliberately NOT here: `joke`, `lie`, `metaphor` — the semantic-first catalog keys that are
// also ordinary English. A mind may lie and may say so; the label for that is the tier row,
// which this list does catch.
export const CONSTRUCT_VOCABULARY: readonly string[] = [
  'festival', 'faith', 'council', 'market', 'custom',
  'construct', 'constructs', 'milestone', 'milestones', 'tier', 'tiers',
  'god_afterlife', 'fear_of_death', 'love_expression', 'justice_claim', 'multi_day_plan', 'past_reference',
  'semantic first', 'semantic firsts',
]

// ★ THE SECOND ONE-WAY GLASS: HOW THE TOWN IS LAID OUT.
//
// `plot`, `block`, `ring`, `lattice`, `plat` and `frontage` are the words THIS PROJECT uses
// for the grammar that decides where a building can stand. They are exactly as much a
// taxonomy as `milestone` is: a mind that could reason about the lattice would be reasoning
// about how the world is assembled instead of living in it, and it would start optimising
// against a rule rather than wanting a roof.
//
// So the ruling is: A MIND MAY KNOW THAT THE TOWN KEEPS GROUND FOR A NEW ROOF, AND WHERE THAT
// GROUND IS. Nothing else. A place is a world fact and eyes report places; the rule that
// chose the place is ours. That is why `build` names a coordinate to walk to and never says
// why it is that one, and why block 1 says "the town keeps ground for such things" rather
// than anything a mind could reason forward from.
//
// Every one of these is ordinary English as well — a plot of land, a block of wood, a ring of
// stones — so they are scanned on the AUTHORED surfaces this gate reads, exactly like the
// four ambiguous construct words below, and never enforced mid-run against something a person
// in the town happened to say.
export const TOWN_LAYOUT_VOCABULARY: readonly string[] = [
  'plot', 'plots', 'block', 'blocks', 'ring', 'rings', 'lattice', 'plat', 'platted', 'frontage',
]

// Four of those five words are also ordinary nouns for real things — the genesis map has a
// market district, a town holds councils, a body keeps faith, a place has customs — so a mind
// may hear them from another mouth. They stay in the scan the G11a gate runs over authored
// prompt surfaces; they are NOT what assembly refuses mid-run, because crashing a live town
// over a word one of its people said is the label harming the world, precisely backwards.
const WORLD_AMBIGUOUS: ReadonlySet<string> = new Set(['faith', 'council', 'market', 'custom'])

// Milestone kinds are all `first_<something>`, so the shape is banned rather than the roster:
// a kind invented next year is caught the day it is written.
const MILESTONE_KIND = /\bfirst_\w+/giu

const patternsFor = (terms: readonly string[]): ReadonlyArray<{ term: string; re: RegExp }> =>
  terms.map((term) => ({
    term,
    re: new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'iu'),
  }))

const ALL_PATTERNS = patternsFor(CONSTRUCT_VOCABULARY)
const OPS_ONLY_PATTERNS = patternsFor(CONSTRUCT_VOCABULARY.filter((t) => !WORLD_AMBIGUOUS.has(t)))

function scan(prompt: string, patterns: ReadonlyArray<{ term: string; re: RegExp }>): string[] {
  const out = patterns.filter(({ re }) => re.test(prompt)).map(({ term }) => term)
  for (const m of prompt.matchAll(MILESTONE_KIND)) {
    const kind = m[0].toLowerCase()
    if (!out.includes(kind)) out.push(kind)
  }
  return out
}

// Every offending term, in the order the list names them, each one once. An empty array is
// the only acceptable answer for anything an agent will read.
export function scanPromptForGlassLeak(prompt: string): string[] {
  return scan(prompt, ALL_PATTERNS)
}

const LAYOUT_PATTERNS = patternsFor(TOWN_LAYOUT_VOCABULARY)

/** Every layout word an authored agent-visible surface uses. Empty is the only answer. */
export function scanForLayoutLeak(text: string): string[] {
  return LAYOUT_PATTERNS.filter(({ re }) => re.test(text)).map(({ term }) => term)
}

// Thrown, not logged: a word that exists only on the ops plane can only have got into a
// prompt through a bug, and the prompt must not be sent. Production keeps running — a live
// town is not the place to discover a false positive.
export function assertNoGlassLeak(text: string, where: string): void {
  if (process.env.NODE_ENV === 'production') return
  const leaks = scan(text, OPS_ONLY_PATTERNS)
  if (leaks.length > 0) throw new Error(`one-way glass leak in ${where}: ${leaks.join(', ')}`)
}

// What the viewer reads where a name would go. Not a label — it says plainly that the town
// has not named the thing yet, which is the truth (G9).
export const UNNAMED_CONSTRUCT_COPY = 'a gathering not yet named'

export type NameSource = {
  sourceKind: 'speech' | 'inscription'
  text: string
  eventSeq: number
  byId: string
}
export type QuotedName = {
  name: string
  sourceKind: NameSource['sourceKind']
  eventSeq: number
  quote: string
  byId: string
}

// The naming law: a name is a thing somebody said or carved, kept verbatim with the words it
// came out of. No match, no name — the row keeps `null` and the viewer is told so.
export function assertQuotedName(name: string, sources: readonly NameSource[]): QuotedName | null {
  for (const s of sources) {
    if (!s.text.includes(name)) continue
    return { name, sourceKind: s.sourceKind, eventSeq: s.eventSeq, quote: s.text, byId: s.byId }
  }
  return null
}
