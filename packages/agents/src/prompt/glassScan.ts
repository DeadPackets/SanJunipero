// One-way glass, mechanically: the ops plane's own words for what it names — construct types,
// milestone kinds, tier labels — may never reach a mind.

// Every word the ops plane uses for a THING IT NAMES; only the taxonomy is banned, never a word
// for a thing in the world. Authored surfaces get the whole list; mid-run only `MID_RUN_ENFORCED`.

// The concepts the experiment watches a town reach on its own. Each is also an ordinary English
// noun, so a mind may hear one from another mouth — but no authored surface may hand one over.
const CONSTRUCT_TYPE_WORDS: readonly string[] = ['festival', 'faith', 'council', 'market', 'custom']

// Our jargon for the machinery, not concepts a town invents; all three are ordinary English too.
const OPS_JARGON_WORDS: readonly string[] = [
  'construct',
  'constructs',
  'milestone',
  'milestones',
  'tier',
  'tiers',
]

// Ops keys, spelled the way only a schema spells them. No person writes these by accident.
const OPS_KEYS: readonly string[] = [
  'god_afterlife',
  'fear_of_death',
  'love_expression',
  'justice_claim',
  'multi_day_plan',
  'past_reference',
  'semantic first',
  'semantic firsts',
]

export const CONSTRUCT_VOCABULARY: readonly string[] = [
  ...CONSTRUCT_TYPE_WORDS,
  ...OPS_JARGON_WORDS,
  ...OPS_KEYS,
]

// The words this project uses for the grammar that decides where a building may stand — as much
// a taxonomy as `milestone`. A mind may know the town keeps ground for a roof, and where; no more.
export const TOWN_LAYOUT_VOCABULARY: readonly string[] = [
  'plot',
  'plots',
  'block',
  'blocks',
  'ring',
  'rings',
  'lattice',
  'plat',
  'platted',
  'frontage',
]

// Refused mid-run only if no person could write it — an underscored ops key or a two-word ops
// phrase. A roster of exceptions cannot keep up with ordinary English a mind writes about itself.
const opsKeyShape = (term: string): boolean => /[_ ]/.test(term)

// Milestone kinds are all `first_<something>`, so the shape is banned rather than the roster:
// a kind invented next year is caught the day it is written.
const MILESTONE_KIND = /\bfirst_\w+/giu

// Cyrillic and Greek letters that render as their Latin twin. Only the ones that can spell a
// roster word; a longer table would be a Unicode confusables copy nobody maintains.
const CONFUSABLE_TO_LATIN: Readonly<Record<string, string>> = {
  а: 'a',
  с: 'c',
  е: 'e',
  һ: 'h',
  і: 'i',
  ј: 'j',
  ӏ: 'l',
  м: 'm',
  о: 'o',
  р: 'p',
  ԛ: 'q',
  г: 'r',
  ѕ: 's',
  т: 't',
  ѵ: 'v',
  ԝ: 'w',
  х: 'x',
  у: 'y',
  α: 'a',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  ν: 'v',
  χ: 'x',
  ı: 'i',
  ɑ: 'a',
  ɡ: 'g',
}
const CONFUSABLE = new RegExp(`[${Object.keys(CONFUSABLE_TO_LATIN).join('')}]`, 'gu')

// What the scan reads. A payload that breaks `festival` with a zero-width space or spells it
// with a Cyrillic е reaches a mind as the word; nothing but the scan sees this folded copy.
function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\p{Mn}\p{Cf}]/gu, '')
    .toLowerCase()
    .replace(CONFUSABLE, (c) => CONFUSABLE_TO_LATIN[c] ?? c)
}

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
  return scan(fold(prompt), ALL_PATTERNS)
}

// A ruling is our machinery speaking, not a person: no one to protect, so the full roster applies.
// The leak is the directive around a verb, never the verb — block 1 teaches every verb by name.
const RULING_DIRECTIVE =
  /\byou (should|must|ought to|need to|could try|may want|will need)\b|\bgo (inside|and)\b|\binstead,? (you|try)\b/i

// The banned shapes all encode "X requires Y" — `without a`, `unless you have`, `until you have`,
// `for lack of`, `requires a`, `once she has`. A bare absence ("You have no reeds here.") is a
// world fact and stays allowed: it connects the absence to no method.
const RULING_NAMES_THE_MISSING_THING =
  /\b(without (a|an|any|the|one)\b|unless you (have|hold|find)\b|until you (have|hold|find)\b|for lack of\b|requires? (a|an|any|the|one)\b|once (you|he|she|they) (have|has|hold|holds|find|finds)\b|there is no \w+ to \w+ (it|this|them) with\b)/i

/** What the town has a word for. A conditional that names one of these hands over nothing the
 *  mind's own perception block does not already list. */
export type RulingVocabulary = {
  itemKinds: readonly string[]
  structureKinds: readonly string[]
}

// How far past the conditional the named thing may sit: `without a length of cord` is four.
const NAMED_THING_WORDS = 6

const vocabularyTokens = (v: RulingVocabulary): ReadonlySet<string> => {
  const out = new Set<string>()
  for (const kind of [...v.itemKinds, ...v.structureKinds]) {
    for (const word of fold(kind).split(/[^a-z0-9]+/u)) if (word.length > 0) out.add(word)
  }
  return out
}

const namesAKnownThing = (rest: string, vocabulary: RulingVocabulary | undefined): boolean => {
  if (vocabulary === undefined) return false
  const known = vocabularyTokens(vocabulary)
  const words = rest
    .split(/[^a-z0-9]+/u)
    .filter((w) => w.length > 0)
    .slice(0, NAMED_THING_WORDS)
  return words.some((w) => known.has(w) || (w.endsWith('s') && known.has(w.slice(0, -1))))
}

/** Every ops word, directive and named-absence in text a mind will be handed. Empty is the only
 *  acceptable answer. Told the town's vocabulary, a conditional naming a thing the town already
 *  has a word for is a fact rather than a recipe, and passes. */
export function scanRulingForGlassLeak(text: string, vocabulary?: RulingVocabulary): string[] {
  const folded = fold(text)
  const out = scan(folded, ALL_PATTERNS)
  const directive = RULING_DIRECTIVE.exec(folded)
  if (directive !== null) out.push(directive[0].trim())
  const missing = RULING_NAMES_THE_MISSING_THING.exec(folded)
  if (
    missing !== null &&
    !namesAKnownThing(folded.slice(missing.index + missing[0].length), vocabulary)
  ) {
    out.push(missing[0].trim())
  }
  return out
}

const LAYOUT_PATTERNS = patternsFor(TOWN_LAYOUT_VOCABULARY)

/** Every layout word an authored agent-visible surface uses. Empty is the only answer. */
export function scanForLayoutLeak(text: string): string[] {
  const folded = fold(text)
  return LAYOUT_PATTERNS.filter(({ re }) => re.test(folded)).map(({ term }) => term)
}

// Thrown, not logged: an ops-plane word can only reach a prompt through a bug. Production keeps
// running — a live town is not the place to discover a false positive.
export function assertNoGlassLeak(text: string, where: string): void {
  if (process.env.NODE_ENV === 'production') return
  const leaks = scan(fold(text), OPS_ONLY_PATTERNS)
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
