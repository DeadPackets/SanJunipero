import { slugify } from './rulebook.js'
import type { Recipe } from './verdict.js'

// A codified verb is forever, so every fault refusable by arithmetic is refused here before
// the rulebook sees it.

// The words the arbiter answers WITH. None of them is the name of a craft, and one of them
// arriving as an id means the model wrote its verdict into the wrong field.
const VERDICT_WORDS: ReadonlySet<string> = new Set([
  'map',
  'attempt',
  'impossible',
  'verdict',
  'recipe',
  'none',
  'unknown',
  'null',
  'undefined',
])

// Ids the world mints as it runs. A recipe is a rule and outlives every one of them.
const ENTITY_ID = /\b(?:item|structure|agent|crop|fauna|forageable|grave)_\d+\b/

const tokens = (s: string): string[] =>
  slugify(s)
    .split('_')
    .filter((t) => t.length > 0)

// Levenshtein, capped at two — that is all the answer this needs.
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = row
  }
  return prev[b.length]!
}

// Two names for one thing: a letter apart, or one of them the other with its head or tail
// eaten. Long enough words only — `axe` and `awl` are two things.
export function nearDuplicate(a: string, b: string): boolean {
  if (a === b) return false
  if (a.length < 4 || b.length < 4) return false
  if (editDistance(a, b) <= 1) return true
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  return long.length - short.length <= 2 && (long.startsWith(short) || long.endsWith(short))
}

// One act named twice: every word of the shorter id is a word of the longer, and the shorter
// says more than one thing on its own.
export function sameActNamedTwice(a: string, b: string): boolean {
  if (a === b) return false
  const [x, y] = [tokens(a), tokens(b)]
  const [short, long] = x.length < y.length ? [x, y] : [y, x]
  if (short.length < 2 || short.length === long.length) return false
  return short.every((t) => long.includes(t))
}

// What the arbiter was shown, and therefore all it may answer with. Absent tables are not
// enforced: a check against a list nobody rendered would refuse the world for being wide.
export type RecipeVocabulary = {
  // Every material named in the prompt: the agent's own hands plus whatever table was shown.
  itemKinds?: ReadonlySet<string>
  structureKinds?: ReadonlySet<string>
  // The ground the asker can see, in the words a requirement may use.
  tileKinds?: ReadonlySet<string>
  // What the rulebook already makes, for telling a second waterskin from a first.
  knownProducts?: ReadonlySet<string>
  knownRecipeIds?: ReadonlySet<string>
  // The roofs the engine's own build verb raises.
  buildableKinds?: ReadonlySet<string>
}

// What a recipe unlocked, as item kinds. Sorted and deduped so the same recipe always yields
// the same array — the forge keys off it and a byte-unstable list would re-commission art.
export function productsOf(recipe: Recipe): string[] {
  const kinds = new Set<string>()
  for (const row of recipe.outcomeTable) {
    for (const e of row.effects) if (e.op === 'spawn_item') kinds.add(e.kind)
  }
  return [...kinds].sort()
}

/** The buildings a recipe teaches the town, with the shape each one stands in. A codified kind
 *  is a row in the world's own recipe table, so the forge has to hear about it the same way it
 *  hears about a new item, or the town raises a roof and the screen draws a coloured block. */
export function buildingsOf(recipe: Recipe): { kind: string; w: number; h: number }[] {
  const out = new Map<string, { kind: string; w: number; h: number }>()
  for (const row of recipe.outcomeTable)
    for (const e of row.effects)
      if (e.op === 'learn_building') out.set(e.kind, { kind: e.kind, w: e.w, h: e.h })
  return [...out.values()].sort((a, b) => a.kind.localeCompare(b.kind))
}

// The effects that leave the world different. `none` and `witness` do not, and a recipe made of
// nothing else is a look: r31 minted "inspect a building exterior" with no effects at all, minds
// ran it eight times a day, and the recognizer crowned it a custom.
// `gain_skill` is not here, and the omission is the point. r49's Salma invented hand-grinding
// wheat and the court granted her a craft that made no meal, took no grain and only made her
// better at grinding. It passed this gate, then squatted on the name: every later ask was
// refused as a second name for it, so the town could never learn to grind wheat again.
const CHANGES_WORLD = new Set([
  'spawn_item',
  'hp_delta',
  'mark',
  'name_place',
  'transfer',
  'need_delta',
])

// The engine's own build verb wearing a new name: r33 minted "build lamp post" and "start bridge
// span" as recipes whose whole yield was a mark and some skill, and the lens counted making while
// nothing stood.
const BUILD_STEMS = /\b(build|built|rais|erect|construct|start|put(ting)? up)/i

function shadowedRoof(recipe: Recipe, vocab: RecipeVocabulary): string | null {
  const slug = recipe.id.replace(/^recipe:/, '')
  if (!BUILD_STEMS.test(`${recipe.name} ${slug.replace(/_/g, ' ')}`)) return null
  const said = new Set([...tokens(recipe.name), ...tokens(slug)])
  for (const kind of vocab.buildableKinds ?? []) {
    const parts = tokens(kind)
    if (parts.length > 0 && parts.every((p) => said.has(p))) return kind
  }
  return null
}

// null when the recipe may be codified; otherwise the reason it may never be, in one line.
export function recipeSanityRefusal(recipe: Recipe, vocab: RecipeVocabulary = {}): string | null {
  const slug = recipe.id.replace(/^recipe:/, '')
  if (VERDICT_WORDS.has(slug)) return `${recipe.id} is a verdict word, not a craft`
  // Row by row, not recipe-wide: r49's grind-wheat said "The wheat is ground into usable meal."
  // on the row that succeeded and made none, and by day six the town was stacking fish behind a
  // flour it did not have. A row that works has to leave something behind.
  const wins = recipe.outcomeTable.filter((row) => row.success)
  const hollow = wins.find((row) => !row.effects.some((e) => CHANGES_WORLD.has(e.op)))
  if (wins.length === 0)
    return `${recipe.id} changes nothing in the world: every outcome is a failure`
  if (hollow !== undefined)
    return `${recipe.id} changes nothing in the world when it works ("${hollow.label}"): that is looking, not a craft`
  const roof = shadowedRoof(recipe, vocab)
  if (roof !== null)
    return `${recipe.id} is the town's own build verb wearing a new name: a ${roof.replace(/_/g, ' ')} is raised with build`

  // Every word of the id must be a word of the name, allowing a shortening or an ending. A word
  // with its HEAD eaten is a prefix of nothing, which is how a truncated id is caught.
  const nameTokens = tokens(recipe.name)
  const nameHas = (t: string): boolean =>
    nameTokens.some(
      (n) => n === t || (Math.min(n.length, t.length) >= 3 && (n.startsWith(t) || t.startsWith(n))),
    )
  const stray = tokens(slug).find((t) => !nameHas(t))
  if (stray !== undefined)
    return `${recipe.id} says "${stray}", which is nowhere in "${recipe.name}"`

  const serialized = JSON.stringify(recipe)
  const entity = ENTITY_ID.exec(serialized)
  if (entity !== null)
    return `${recipe.id} names ${entity[0]}, a thing the world minted, not a kind`

  if (vocab.itemKinds !== undefined) {
    for (const req of recipe.requires) {
      if (req.type !== 'held_item') continue
      if (!vocab.itemKinds.has(req.kind))
        return `${recipe.id} asks for ${req.kind}, which the town has no word for`
    }
    for (const cost of recipe.costs) {
      if (!vocab.itemKinds.has(cost.kind))
        return `${recipe.id} spends ${cost.kind}, which the town has no word for`
    }
  }
  if (vocab.structureKinds !== undefined) {
    for (const req of recipe.requires) {
      if (req.type !== 'adjacent_structure') continue
      if (!vocab.structureKinds.has(req.kind))
        return `${recipe.id} wants a ${req.kind}, which the town does not build`
    }
  }
  // A rule that asks for ground nobody in sight can point at: the live run required sand for
  // work against a wooden wall, in a town of grass and river.
  if (vocab.tileKinds !== undefined) {
    for (const req of recipe.requires) {
      if (req.type !== 'adjacent_tile') continue
      if (!vocab.tileKinds.has(req.tile))
        return `${recipe.id} wants ${req.tile} ground, and none lies within sight`
    }
  }

  for (const product of productsOf(recipe)) {
    // A building is raised, not made in the hand: the live run put a footbridge in a fist.
    if (vocab.structureKinds?.has(product) === true)
      return `${recipe.id} makes ${product}, which is raised, not carried`
    for (const known of vocab.knownProducts ?? []) {
      if (nearDuplicate(product, known))
        return `${recipe.id} makes ${product}, and the town already makes ${known}`
    }
  }
  for (const known of vocab.knownRecipeIds ?? []) {
    const other = known.replace(/^recipe:/, '')
    if (nearDuplicate(slug, other) || sameActNamedTwice(slug, other)) {
      return `${recipe.id} is a second name for ${known}`
    }
  }
  return null
}
