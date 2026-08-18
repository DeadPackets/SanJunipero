// Authored initial conditions, not outcomes: where the first berries and mushrooms stand on
// day zero. Task 21 owns the node system and emits from this table; nothing reads it yet.
// Coordinates are absolute on the 128x128 genesis map (C11 section 9).

export const FORAGEABLE_KINDS = [
  'berry_bush', 'mushroom_patch', 'pale_mushroom_patch', 'herb_patch', 'clay_deposit', 'stone_outcrop',
  'reed_bed',
] as const
export type ForageableKind = (typeof FORAGEABLE_KINDS)[number]

export type ForageableScatter = { kind: ForageableKind; x: number; y: number; stock: number }

// Which mushroom kills is knowledge the town earns: the pale patches stand among the others.
export const GENESIS_FORAGEABLES: readonly ForageableScatter[] = [
  { kind: 'berry_bush', x: 62, y: 44, stock: 6 },
  { kind: 'berry_bush', x: 68, y: 47, stock: 6 },
  { kind: 'berry_bush', x: 59, y: 92, stock: 6 },
  { kind: 'berry_bush', x: 71, y: 96, stock: 6 },
  { kind: 'mushroom_patch', x: 93, y: 38, stock: 4 },
  { kind: 'mushroom_patch', x: 94, y: 72, stock: 4 },
  { kind: 'mushroom_patch', x: 91, y: 108, stock: 4 },
  { kind: 'pale_mushroom_patch', x: 95, y: 55, stock: 3 },
  { kind: 'pale_mushroom_patch', x: 92, y: 95, stock: 3 },
  { kind: 'herb_patch', x: 46, y: 33, stock: 4 },
  { kind: 'herb_patch', x: 46, y: 66, stock: 4 },
  { kind: 'herb_patch', x: 52, y: 100, stock: 4 },
  { kind: 'clay_deposit', x: 47, y: 48, stock: 8 },
  { kind: 'clay_deposit', x: 51, y: 112, stock: 8 },
  { kind: 'stone_outcrop', x: 22, y: 100, stock: 10 },
  { kind: 'stone_outcrop', x: 26, y: 107, stock: 10 },
  { kind: 'stone_outcrop', x: 18, y: 108, stock: 10 },
  // Reeds stand where the bank is wet: two beds on the town's side of the water and one on
  // the far bank, which is a bridge away like everything else over there.
  { kind: 'reed_bed', x: 51, y: 52, stock: 6 },
  { kind: 'reed_bed', x: 51, y: 84, stock: 6 },
  { kind: 'reed_bed', x: 47, y: 70, stock: 6 },
  // The town's own meadow (C11 R14). Everything above stands beyond the founders' horizon on
  // the first morning — the nearest bush is seventeen steps and sight reaches twelve — so no
  // mind could ever name a patch, and the town gathered ONCE in five live runs. These three
  // are inside every founder's sight from their own doorway, on the town's side of the water:
  // the far bank stays a bridge away, as it always was. The herbs are the healer's, and there
  // was not one reachable herb patch in the world before this row.
  { kind: 'berry_bush', x: 66, y: 55, stock: 6 },
  { kind: 'berry_bush', x: 70, y: 67, stock: 6 },
  { kind: 'herb_patch', x: 73, y: 58, stock: 4 },
]

// How a node reads from across the clearing. Never a count — a picker sees abundance or
// bareness, and the difference between the two mushrooms is not one of them (G10).
export const FORAGEABLE_PROSE: Readonly<Record<ForageableKind, { standing: string; bare: string }>> = {
  berry_bush: { standing: 'berry bushes heavy with fruit', bare: 'the berry bushes are picked bare' },
  mushroom_patch: { standing: 'mushrooms pushing up through the leaf litter', bare: 'the mushroom ground is turned over and empty' },
  pale_mushroom_patch: { standing: 'pale mushrooms standing in the shade', bare: 'the pale ground is turned over and empty' },
  herb_patch: { standing: 'a spread of low green herbs', bare: 'the herbs have been cut back to the root' },
  clay_deposit: { standing: 'grey clay showing where the bank has slumped', bare: 'the clay is dug out to the gravel' },
  stone_outcrop: { standing: 'loose stone lying at the foot of the rock', bare: 'the loose stone has all been carried off' },
  reed_bed: { standing: 'tall reeds standing thick in the shallows', bare: 'the reeds are cut down to the waterline' },
}

// What a node yields when it is worked.
export const FORAGEABLE_YIELD: Readonly<Record<ForageableKind, string>> = {
  berry_bush: 'berries',
  mushroom_patch: 'mushroom',
  pale_mushroom_patch: 'pale_mushroom',
  herb_patch: 'herb',
  clay_deposit: 'clay',
  stone_outcrop: 'stone',
  reed_bed: 'fiber',
}
