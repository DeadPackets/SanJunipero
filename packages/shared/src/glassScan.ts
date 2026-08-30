import { CONSTRUCT_TYPES } from './constructSchema.js'

// One-way glass, mechanically: the ops plane's own words for what it names — construct types,
// milestone kinds, tier labels — may never reach a mind.

// Every word the ops plane uses for a THING IT NAMES; only the taxonomy is banned, never a word
// for a thing in the world. Authored surfaces get the whole list; mid-run only `MID_RUN_ENFORCED`.

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

// The construct types are concepts the experiment watches a town reach on its own. Each is also
// an ordinary English noun, so a mind may hear one from another mouth — but no authored surface
// may hand one over.
export const CONSTRUCT_VOCABULARY: readonly string[] = [
  ...CONSTRUCT_TYPES,
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

const foldChar = (ch: string): string =>
  ch
    .normalize('NFKD')
    .replace(/[\p{Mn}\p{Cf}]/gu, '')
    .toLowerCase()
    .replace(CONFUSABLE, (c) => CONFUSABLE_TO_LATIN[c] ?? c)

// What the scan reads, and for each of its characters the offset in the original it came from,
// so a span the scan finds can be cut out of text a mind was about to read.
function foldWithSource(text: string): { folded: string; source: number[] } {
  let folded = ''
  const source: number[] = []
  let at = 0
  for (const ch of text) {
    for (const out of foldChar(ch)) {
      folded += out
      source.push(at)
    }
    at += ch.length
  }
  source.push(at)
  return { folded, source }
}

// A payload that breaks `festival` with a zero-width space or spells it with a Cyrillic е
// reaches a mind as the word; nothing but the scan sees this folded copy.
function fold(text: string): string {
  return foldWithSource(text).folded
}

type Pattern = { term: string; re: RegExp; all: RegExp }

const patternsFor = (terms: readonly string[]): readonly Pattern[] =>
  terms.map((term) => {
    const pattern = `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`
    return { term, re: new RegExp(pattern, 'iu'), all: new RegExp(pattern, 'giu') }
  })

export const MID_RUN_ENFORCED: readonly string[] = CONSTRUCT_VOCABULARY.filter(opsKeyShape)

const ALL_PATTERNS = patternsFor(CONSTRUCT_VOCABULARY)
const OPS_ONLY_PATTERNS = patternsFor(MID_RUN_ENFORCED)

function scan(prompt: string, patterns: readonly Pattern[]): string[] {
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

// The counsel every perception sentence must be free of, and the part of RULING_DIRECTIVE that
// holds for a mind-facing line too: it hands over a remedy rather than a fact about now.
const PERCEPTION_DIRECTIVE = /\byou (should|must)\b|\bgo (inside|and)\b/gi

/** Every remedy the sentence hands a mind. Empty is the only acceptable answer. */
export function scanForDirective(text: string): string[] {
  return [...text.matchAll(PERCEPTION_DIRECTIVE)].map((m) => m[0].toLowerCase())
}

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

type Span = { term: string; start: number; end: number }

// Where every offending term sits in the folded copy, earliest first and widest first, so the
// spans can be cut out of the original in one pass.
function scanSpans(folded: string, patterns: readonly Pattern[]): Span[] {
  const out: Span[] = []
  const add = (term: string, at: number, match: string): void => {
    out.push({ term, start: at, end: at + match.length })
  }
  for (const { term, all } of patterns) {
    for (const m of folded.matchAll(all)) add(term, m.index, m[0])
  }
  for (const m of folded.matchAll(MILESTONE_KIND)) add(m[0].toLowerCase(), m.index, m[0])
  return out.sort((a, b) => a.start - b.start || b.end - a.end)
}

const REDACTED = '[redacted]'

// A span found in the fold, cut out of the text it was folded from. An overlapping second
// match is already gone with the first.
function cutSpans(text: string, spans: readonly Span[], source: readonly number[]): string {
  let out = ''
  let cut = 0
  for (const span of spans) {
    const start = source[span.start] ?? text.length
    if (start < cut) continue
    out += text.slice(cut, start) + REDACTED
    cut = source[span.end] ?? text.length
  }
  return out + text.slice(cut)
}

/** Told what leaked and where, so a run can be read back off the ops plane. */
export type GlassLeakSink = (leaks: readonly string[], where: string) => void

// Redacted and reported, never thrown and never skipped: an ops-plane word can only reach a
// prompt through a bug, and a live town is not the place to discover a false positive.
export function assertNoGlassLeak(text: string, where: string, onLeak?: GlassLeakSink): string {
  const { folded, source } = foldWithSource(text)
  const spans = scanSpans(folded, OPS_ONLY_PATTERNS)
  if (spans.length === 0) return text
  onLeak?.([...new Set(spans.map((s) => s.term))], where)
  return cutSpans(text, spans, source)
}
