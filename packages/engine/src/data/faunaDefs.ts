// Authored initial conditions: the herd, the warren and the schools that are already here on
// day zero. Coordinates are absolute on the 128x128 genesis map.

export const FAUNA_KINDS = ['deer', 'rabbit', 'fish'] as const
export type FaunaKind = (typeof FAUNA_KINDS)[number]

export type FaunaScatter = { kind: FaunaKind; x: number; y: number; stock?: number }

// What a body leaves behind. A hide is a material, not a meal, so it carries no spoilage row.
export const FAUNA_YIELD: Readonly<Record<FaunaKind, ReadonlyArray<{ kind: string; qty: number }>>> = {
  deer: [{ kind: 'venison', qty: 2 }, { kind: 'hide', qty: 1 }],
  rabbit: [{ kind: 'rabbit_meat', qty: 1 }],
  fish: [{ kind: 'fish', qty: 1 }],
}

export const GENESIS_FAUNA: readonly FaunaScatter[] = [
  // the herd, at the forest edge east of town
  { kind: 'deer', x: 90, y: 40 },
  { kind: 'deer', x: 93, y: 45 },
  { kind: 'deer', x: 89, y: 62 },
  { kind: 'deer', x: 94, y: 88 },
  { kind: 'deer', x: 88, y: 104 },
  // rabbits, in the open meadow
  { kind: 'rabbit', x: 60, y: 30 },
  { kind: 'rabbit', x: 66, y: 34 },
  { kind: 'rabbit', x: 34, y: 52 },
  { kind: 'rabbit', x: 30, y: 70 },
  { kind: 'rabbit', x: 70, y: 100 },
  { kind: 'rabbit', x: 64, y: 112 },
  // schools: two in the river, one in the lake
  { kind: 'fish', x: 49, y: 62, stock: 5 },
  { kind: 'fish', x: 49, y: 96, stock: 5 },
  { kind: 'fish', x: 86, y: 20, stock: 5 },
]
