// Canon ingredient classes. A recipe that wants "any meat" names the sentinel and the craft
// resolves it against what the hands are actually holding — which is how one stew recipe
// survives a town that hunts deer, snares rabbits or fishes, without three recipes for it.
// These are canon ids, never world text: `CLASS_PROSE` is what a refusal is allowed to say.

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
