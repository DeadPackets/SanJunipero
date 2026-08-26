// One-way glass, mechanically: the ops plane's own words for what it names — construct types,
// milestone kinds, tier labels — may never reach a mind.

// Every word the ops plane uses for a THING IT NAMES; only the taxonomy is banned, never a word
// for a thing in the world. Authored surfaces get the whole list; mid-run only `MID_RUN_ENFORCED`.

// The concepts the experiment watches a town reach on its own. Each is also an ordinary English
// noun, so a mind may hear one from another mouth — but no authored surface may hand one over.
const CONSTRUCT_TYPE_WORDS: readonly string[] = ['festival', 'faith', 'council', 'market', 'custom']

// Our jargon for the machinery, not concepts a town invents; all three are ordinary English too.
const OPS_JARGON_WORDS: readonly string[] = [
  'construct', 'constructs', 'milestone', 'milestones', 'tier', 'tiers',
]

// Ops keys, spelled the way only a schema spells them. No person writes these by accident.
const OPS_KEYS: readonly string[] = [
  'god_afterlife', 'fear_of_death', 'love_expression', 'justice_claim', 'multi_day_plan', 'past_reference',
  'semantic first', 'semantic firsts',
]

export const CONSTRUCT_VOCABULARY: readonly string[] = [
  ...CONSTRUCT_TYPE_WORDS, ...OPS_JARGON_WORDS, ...OPS_KEYS,
]

// The words this project uses for the grammar that decides where a building may stand — as much
// a taxonomy as `milestone`. A mind may know the town keeps ground for a roof, and where; no more.
export const TOWN_LAYOUT_VOCABULARY: readonly string[] = [
  'plot', 'plots', 'block', 'blocks', 'ring', 'rings', 'lattice', 'plat', 'platted', 'frontage',
]

// Refused mid-run only if no person could write it — an underscored ops key or a two-word ops
// phrase. A roster of exceptions cannot keep up with ordinary English a mind writes about itself.
const opsKeyShape = (term: string): boolean => /[_ ]/.test(term)

// Milestone kinds are all `first_<something>`, so the shape is banned rather than the roster:
// a kind invented next year is caught the day it is written.
const MILESTONE_KIND = /\bfirst_\w+/giu

const patternsFor = (terms: readonly string[]): ReadonlyArray<{ term: string; re: RegExp }> =>
  terms.map((term) => ({
    term,
    re: new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'iu'),
  }))

export const MID_RUN_ENFORCED: readonly string[] = CONSTRUCT_VOCABULARY.filter(opsKeyShape)

const ALL_PATTERNS = patternsFor(CONSTRUCT_VOCABULARY)
const OPS_ONLY_PATTERNS = patternsFor(MID_RUN_ENFORCED)

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

// A ruling is our machinery speaking, not a person: no one to protect, so the full roster applies.
// The leak is the directive around a verb, never the verb — block 1 teaches every verb by name.
const RULING_DIRECTIVE =
  /\byou (should|must|ought to|need to|could try|may want|will need)\b|\bgo (inside|and)\b|\binstead,? (you|try)\b/i

// The banned shapes all encode "X requires Y" — `without a`, `unless you have`, `until you have`,
// `for lack of`. A bare absence ("You have no reeds here.") is a world fact and stays allowed.
const RULING_NAMES_THE_MISSING_THING =
  /\b(without (a|an|any|the|one)\b|unless you (have|hold|find)\b|until you (have|hold|find)\b|for lack of\b|there is no \w+ to \w+ (it|this|them) with\b)/i

/** Every ops word, directive and named-absence in text a mind will be handed. Empty is the only
 *  acceptable answer. */
export function scanRulingForGlassLeak(text: string): string[] {
  const out = scan(text, ALL_PATTERNS)
  for (const re of [RULING_DIRECTIVE, RULING_NAMES_THE_MISSING_THING]) {
    const hit = re.exec(text)
    if (hit !== null) out.push(hit[0].toLowerCase().trim())
  }
  return out
}

const LAYOUT_PATTERNS = patternsFor(TOWN_LAYOUT_VOCABULARY)

/** Every layout word an authored agent-visible surface uses. Empty is the only answer. */
export function scanForLayoutLeak(text: string): string[] {
  return LAYOUT_PATTERNS.filter(({ re }) => re.test(text)).map(({ term }) => term)
}

// Thrown, not logged: an ops-plane word can only reach a prompt through a bug. Production keeps
// running — a live town is not the place to discover a false positive.
export function assertNoGlassLeak(text: string, where: string): void {
  if (process.env.NODE_ENV === 'production') return
  const leaks = scan(text, OPS_ONLY_PATTERNS)
  if (leaks.length > 0) throw new Error(`one-way glass leak in ${where}: ${leaks.join(', ')}`)
}

// One declaration, in @sj/shared, so the viewer copy and the glass-side copy cannot drift.
export { UNNAMED_CONSTRUCT_COPY } from '@sj/shared'

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
