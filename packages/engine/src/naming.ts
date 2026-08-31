// What counts as a name, and what a name is allowed to do. One leaf, because "a name" has to
// mean the same thing to the fold, to the air between two mouths, and to the map.

// Below this a carving is a mark, not a word: it stands on the wall and reads in a prompt, but
// nobody can pass it on, because half the town would think they had been told something.
const NAME_MIN_LETTERS = 4

// Words that name nothing on their own. Every one of them is a thing a carving might plausibly
// say, and not one of them tells a hearer where to go.
const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'had',
  'has',
  'have',
  'here',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'its',
  'my',
  'no',
  'not',
  'of',
  'on',
  'or',
  'out',
  'so',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'they',
  'this',
  'to',
  'up',
  'was',
  'we',
  'were',
  'what',
  'when',
  'who',
  'will',
  'with',
  'you',
  'your',
])

const LETTER = /\p{L}/gu
const NOT_LETTER = /[^\p{L}]+/u

/** Whether a name can travel from a mouth to an ear. One too short or too plain to be a name is
 *  still carved and still shown; it just cannot be passed to somebody who was never there. */
export function nameTravels(name: string): boolean {
  const said = name.trim().toLowerCase()
  if (STOPWORDS.has(said)) return false
  return (said.match(LETTER) ?? []).length >= NAME_MIN_LETTERS
}

// A name is short enough to say in one breath, and it names the thing rather than the one
// holding the chisel.
const NAME_MAX_WORDS = 5
const FIRST_PERSON: ReadonlySet<string> = new Set([
  'i',
  'me',
  'my',
  'mine',
  'we',
  'us',
  'our',
  'ours',
])

/** Whether a carving reads as the name of a building and not as something somebody felt. Split
 *  on every non-letter, so "I'm cold" is caught by the `i` the apostrophe would have hidden. */
export function nameShaped(text: string): boolean {
  const words = text
    .trim()
    .split(/\s+/u)
    .filter((w) => w.length > 0)
  if (words.length === 0 || words.length > NAME_MAX_WORDS) return false
  return !text
    .toLowerCase()
    .split(NOT_LETTER)
    .some((part) => FIRST_PERSON.has(part))
}

/** Whether this carving renames the thing it is cut into. Only the hand that raised a building
 *  may name it, which is also what keeps the founding names: no mind's id is the genesis
 *  builder's, so nothing a mind carves on the old farmhouse can stop it being the old farmhouse. */
export function renames(s: { builtBy: string | null }, text: string, agentId: string): boolean {
  return s.builtBy === agentId && nameShaped(text)
}
