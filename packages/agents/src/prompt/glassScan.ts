// One-way glass, mechanically. The ops plane names what it sees — construct types, milestone
// kinds, tier labels — and not one of those words may ever reach a mind. Labelling never
// causes behaviour, and this file is why that is a fact rather than a promise.

// Every word the ops plane uses for a THING IT NAMES. A word for a thing in the world (a fire
// pit, a hide, a bridge) is not on this list and never will be: only the taxonomy is banned.
// Deliberately NOT here: `joke`, `lie`, `metaphor` — the semantic-first catalog keys that are
// also ordinary English. A mind may lie and may say so; the label for that is the tier row,
// which this list does catch.
//
// ★ THE LIST IS BANNED ON AUTHORED SURFACES. ONLY PART OF IT IS REFUSED MID-RUN — see
// `MID_RUN_ENFORCED`, and read that before adding a word here.

// The concepts the experiment exists to watch a town reach on its own. No authored surface may
// hand one over — that is the whole of one-way glass. Every one of them is also an ordinary
// English noun for a real thing (a market district, a council of neighbours, keeping faith, the
// custom of the place, a festival somebody proposes), so a mind may hear one from another mouth.
const CONSTRUCT_TYPE_WORDS: readonly string[] = ['festival', 'faith', 'council', 'market', 'custom']

// Our jargon for the machinery, not concepts a town invents. Also ordinary English: a milestone
// is a stone by a road, a tier is a shelf, to construct is to build. A mind describing an
// ordinary day reaches for all three.
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

// ★ WHAT ASSEMBLY REFUSES MID-RUN, AND WHY IT IS A SHAPE AND NOT A ROSTER.
//
// Crashing a live town over a word one of its people said is the label harming the world,
// precisely backwards. This file said that already and kept a hand-written roster of four
// exceptions — and then G9b lost a mind ten consecutive turns to `milestone`, which the
// compaction summariser wrote into that mind's own append-only day log. `assemblePrompt` scans
// the day log, the scene and the moment: text nobody authored, some of it a mind's own words
// coming back. A hand-maintained exception list cannot keep up with ordinary English.
//
// So the rule is the shape: a term is refused mid-run only if no person could write it — an
// underscored ops key, or a two-word ops phrase. Every single ordinary word stays in the scan
// the G11a gate runs over AUTHORED surfaces, where we own the text and a red is a real bug.
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

// ★ THE THIRD ONE-WAY GLASS: AN ARBITER RULING IS NOT A PERSON SPEAKING.
//
// `MID_RUN_ENFORCED` above spares `market`, `council`, `festival`, `faith` and `custom`
// deliberately, because a live town must not die over a word one of its PEOPLE said. A ruling
// is the other thing entirely: it is our machinery, in the voice of something that knows the
// rules, and `refusalMemoryText` writes an `impossible.reason` verbatim into a mind's memory
// for the next prompt to read back. There is no person to protect here, so the full roster
// applies — a refusal that reaches for our word for the thing the town is being watched to
// invent is a hint, and it invalidates the measurement it contaminates.
//
// The second half is the directive. A refusal answers what was asked; one that also says what
// to do NEXT has handed over a path the mind did not reach on its own. `CRAFT_HINT` is the one
// sanctioned door, and it is authored, rendered at prose time, and never stored in a ruling.
//
// ★ DELIBERATELY NOT BANNED: `build`, `enter`, `craft` and the rest of `CAPABILITIES`. Block 1
// teaches every one of them to every mind BY NAME, so a refusal using one reveals nothing —
// and banning them would leave the arbiter no vocabulary to refuse in. The leak is the
// directive around the verb, never the verb.
const RULING_DIRECTIVE =
  /\byou (should|must|ought to|need to|could try|may want|will need)\b|\bgo (inside|and)\b|\binstead,? (you|try)\b/i

// ★ THE FOURTH SHAPE — NAMING THE MISSING THING, added by the intents lane with the wider
// refusal text it had to write.
//
// A directive says what to do next. This says the same thing one step back, and the old scan
// waved it through: *"you cannot smoke fish without a rack"* contains no ops word, no `you
// should`, and hands over the entire answer. So does *"you have no rack"*. The blocker named is
// the solution stated as an absence, and a mind reads it as a shopping list.
//
// ★ THE LINE IS THE CONDITIONAL, NOT THE NOUN — and this took a red test to find.
//
// The first draft of this pattern also caught `you have no` and immediately reddened a shipped
// arbiter fixture: *"You have no reeds here."* on an `insufficient_materials` verdict. Reading
// it settled the rule, so it is written down rather than re-derived:
//
//   "You have no reeds here."               a fact about the world. The mind's own perception
//                                           block already lists what it carries, verbatim. It
//                                           connects that fact to no method, so it is not a
//                                           recipe and it is ALLOWED.
//   "you cannot smoke fish without a rack"  a CONDITIONAL — smoking requires a rack. That is a
//                                           recipe fragment in a refusal, and it is the leak.
//
// So the shapes banned here all encode "X requires Y": `without a`, `unless you have`, `until
// you have`, `for lack of`. A bare statement of absence is not one of them.
//
// ★ WHAT THIS STILL CANNOT DO, and it is the honest limit of a static scan: it cannot tell a
// material the town already has a word for from an object the refusal has just invented. That
// distinction needs `deps.vocabulary`, which lives in the arbiter and not in this package.
// Pricing it: pass the vocabulary into a second scanner at the `reasonTainted` call site and
// let a conditional naming a KNOWN material through, ~1h. Until then the conditional itself is
// refused whatever it names, which errs toward the canned line and loses only words.
//
// A hit SWAPS the reason for `CLEAN_IMPOSSIBLE_REASON` rather than retrying, which is what
// makes that error bearable: the verdict survives, only the words are lost.
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

// Thrown, not logged: a word that exists only on the ops plane can only have got into a
// prompt through a bug, and the prompt must not be sent. Production keeps running — a live
// town is not the place to discover a false positive.
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
