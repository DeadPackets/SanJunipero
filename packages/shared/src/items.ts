// One name per substance, held here because the engine's eat check and the forge's art catalogue
// both key on it: world one shipped `herb_bundle` art against an engine that only knew `herb`.
export const FOOD_KINDS: ReadonlySet<string> = new Set([
  'berries',
  'bread',
  'fish',
  'herb',
  'mushroom',
  'pale_mushroom',
  'rabbit_meat',
  'stew',
  'venison',
  'wheat',
])

// A recipe that wants "any meat" names the sentinel and the craft resolves it against what the
// hands are holding. Canon ids, never world text: CLASS_PROSE is what a refusal may say.

export const ITEM_CLASSES: Readonly<Record<string, readonly string[]>> = {
  any_meat: ['fish', 'rabbit_meat', 'venison'],
  any_vegetable: ['berries', 'mushroom', 'wheat'],
}

export const CLASS_PROSE: Readonly<Record<string, string>> = {
  any_meat: 'meat',
  any_vegetable: 'vegetables',
}

// The members of a class, or undefined when the name is a plain item kind.
export function classMembers(kind: string): readonly string[] | undefined {
  return ITEM_CLASSES[kind]
}

// What a refusal calls an input, class or kind alike.
export function inputName(kind: string): string {
  return CLASS_PROSE[kind] ?? kind
}

/** A kind list with every class sentinel replaced by the kinds it stands for, sorted and deduped.
 *  The art gates count kinds, and `any_meat` is not a thing anybody can hold. */
export function expandItemKinds(kinds: Iterable<string>): string[] {
  const out = new Set<string>()
  for (const k of kinds) {
    const members = classMembers(k)
    if (members === undefined) out.add(k)
    else for (const m of members) out.add(m)
  }
  return [...out].sort()
}
