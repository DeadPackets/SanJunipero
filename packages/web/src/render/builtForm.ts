import { TILE_H, TILE_W } from './iso.js'

// A STRUCTURE WITH NO ART IS STILL A THING THAT WAS BUILT.
//
// C12a batch 1 instantiated the real eleven-building town, and two of those buildings — the
// well and the fire pit — have no art in any root. They rendered as the forge's transparent
// checkerboard placeholder in the dead centre of the plaza, at the exact focal point the town
// plan had just created. This module is the bridge to that art (v1 Task 17), not a
// replacement for it: any kind lacking a root draws a deliberate simple volume out of the
// master palette — a plinth, a low prism and one accent — so a viewer reads "a modest built
// thing whose portrait has not been painted", never "missing art".
//
// It is generic over kind on purpose. The hole recurs every time the world learns to raise
// something the art lane has not reached yet.

/** The footprint diamond in the sprite's LOCAL space — origin at the top vertex of the centre
 *  tile, exactly where a structure sprite is positioned. The one ground shape the hit area and
 *  the built form are both cut from, so they can never disagree about where a building stands. */
export function footprintDiamond(w: number, h: number): number[] {
  const corners: ReadonlyArray<readonly [number, number]> = [
    [0.5 - w / 2, 0.5 - h / 2],   // north
    [w / 2 + 0.5, 0.5 - h / 2],   // east
    [w / 2 + 0.5, h / 2 + 0.5],   // south
    [0.5 - w / 2, h / 2 + 0.5],   // west
  ]
  return corners.flatMap(([dx, dy]) => [(dx - dy) * (TILE_W / 2), (dx + dy) * (TILE_H / 2)])
}

/** Four warm-grey stones, five honey timbers, three clay tones — all MASTER_PALETTE members.
 *  One ramp per material, lit from above: the top face catches the light, the south-east face
 *  holds mid tone, the south-west face falls away, and the plinth is the ground contact. */
export const BUILT_FORM_RAMPS = {
  stone:  { top: 0xe9e2da, right: 0xaba198, left: 0x857d75, plinth: 0x5d5751 },
  timber: { top: 0xe0a95e, right: 0xa66e38, left: 0x7e512b, plinth: 0x5d5751 },
  clay:   { top: 0xf5d3b3, right: 0xd9a876, left: 0x9c6b47, plinth: 0x5d5751 },
} as const
export type RampName = keyof typeof BUILT_FORM_RAMPS
const RAMP_NAMES = Object.keys(BUILT_FORM_RAMPS) as RampName[]

/** What a kind is made of. Anything unnamed is hashed onto a ramp, so an unknown kind is
 *  still consistent with itself across frames and across sessions. */
export const BUILT_FORM_MATERIALS: Readonly<Record<string, RampName>> = {
  well: 'stone', fire_pit: 'stone', standing_stone: 'stone', grave: 'stone',
  wagon: 'timber', scaffolding: 'timber', bridge: 'timber', shed: 'timber',
  cabin: 'timber',
  hut: 'clay', cottage: 'clay', farmhouse: 'clay', storehouse: 'clay',
}

/** The one mark that says a person made this and meant it: water in the well's mouth, embers
 *  in the fire pit, a honey step on everything else. */
export const BUILT_FORM_ACCENTS: Readonly<Record<string, number>> = {
  well: 0x7fb0c9, fire_pit: 0xf7a66b, standing_stone: 0x8a6fa8, grave: 0x5d5751,
  default: 0xe0a95e,
}

/** --ink. The silhouette rim, so a form reads against grass and against paving alike. */
export const BUILT_FORM_INK = 0x43394a

/** One tile of HEIGHT in screen px. Buildings are drawn to a (w+h)·32 px square, so a tile of
 *  height is a tile of width — a form and the art it stands in for share one scale. */
export const BUILT_FORM_UNIT_PX = TILE_W

/** How tall each kind stands, in tiles. A well is waist-high and a fire pit is a ring of
 *  stones; nothing here may read as a house that happens to be grey. */
export const BUILT_FORM_HEIGHT_TILES: Readonly<Record<string, number>> = {
  fire_pit: 0.4, well: 0.6, grave: 0.45, wagon: 0.65,
  standing_stone: 1.1, scaffolding: 1.0, bridge: 0.35,
  // Three dwellings that differ in the two things a roofline can differ in. A cottage stands
  // taller than the cabin it is bigger than; a farmhouse is the widest roof and sits LOW, so
  // width alone tells it apart from a house that is merely nearer.
  cabin: 0.85, cottage: 1.05, farmhouse: 0.95,
}
export const BUILT_FORM_DEFAULT_HEIGHT_TILES = 0.9

/** The plinth shows as a rim of ground around the volume, which is what stops a form reading
 *  as a flat sticker lying on the grass. */
export const BUILT_FORM_INSET_TILES = 0.18
/** The accent is a small inset on the top face — a mouth, an ember bed, a step. */
export const BUILT_FORM_ACCENT_INSET_TILES = 0.34

export type BuiltFace = { poly: number[]; color: number }
export type BuiltForm = {
  kind: string
  heightPx: number
  /** the ground the volume stands on, drawn first */
  plinth: BuiltFace
  /** south-west face, south-east face, top — in paint order */
  faces: [BuiltFace, BuiltFace, BuiltFace]
  accent: BuiltFace
  /** the OUTER outline of the whole volume — six points, so the rim reads as a silhouette
   *  rather than as a wireframe box with every internal edge drawn */
  silhouette: number[]
  /** the one internal edge a solid has: the near vertical corner */
  nearEdge: [number, number, number, number]
  ink: number
}

// FNV-1a: a kind with no named material still gets the SAME material every time.
function hashKind(kind: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < kind.length; i++) {
    h ^= kind.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

function inset(w: number, h: number, by: number): number[] {
  return footprintDiamond(Math.max(w - by * 2, 0.1), Math.max(h - by * 2, 0.1))
}

function raise(poly: number[], dy: number): number[] {
  return poly.map((v, i) => (i % 2 === 1 ? v + dy : v))
}

const pt = (poly: number[], i: number): [number, number] => [poly[i * 2]!, poly[i * 2 + 1]!]

export function builtFormSpec(kind: string, w: number, h: number): BuiltForm {
  const ramp = BUILT_FORM_RAMPS[BUILT_FORM_MATERIALS[kind] ?? RAMP_NAMES[hashKind(kind) % RAMP_NAMES.length]!]
  const heightPx = (BUILT_FORM_HEIGHT_TILES[kind] ?? BUILT_FORM_DEFAULT_HEIGHT_TILES) * BUILT_FORM_UNIT_PX

  const ground = inset(w, h, BUILT_FORM_INSET_TILES)
  const top = raise(ground, -heightPx)
  const [, gE, gS, gW] = [pt(ground, 0), pt(ground, 1), pt(ground, 2), pt(ground, 3)]
  const [, tE, tS, tW] = [pt(top, 0), pt(top, 1), pt(top, 2), pt(top, 3)]

  const tN = pt(top, 0)
  return {
    kind,
    heightPx,
    plinth: { poly: footprintDiamond(w, h), color: ramp.plinth },
    faces: [
      { poly: [...gW!, ...gS!, ...tS!, ...tW!], color: ramp.left },
      { poly: [...gS!, ...gE!, ...tE!, ...tS!], color: ramp.right },
      { poly: top, color: ramp.top },
    ],
    silhouette: [...gW!, ...gS!, ...gE!, ...tE!, ...tN!, ...tW!],
    nearEdge: [gS![0], gS![1], tS![0], tS![1]],
    accent: {
      poly: raise(inset(w, h, BUILT_FORM_ACCENT_INSET_TILES), -heightPx),
      color: BUILT_FORM_ACCENTS[kind] ?? BUILT_FORM_ACCENTS.default!,
    },
    ink: BUILT_FORM_INK,
  }
}

/** Just enough of a Pixi `Graphics` to paint a form. Structural, so this module stays pure
 *  and its tests need no renderer. */
export type FormPainter = {
  clear: () => unknown
  poly: (points: number[]) => unknown
  fill: (style: number) => unknown
  stroke: (style: { width: number; color: number; alignment: number }) => unknown
}

export function drawBuiltForm(g: FormPainter, form: BuiltForm): void {
  g.clear()
  for (const face of [form.plinth, ...form.faces, form.accent]) {
    g.poly(face.poly)
    g.fill(face.color)
  }
  // The rim is the OUTER outline plus the one internal edge a solid actually has. Stroking
  // every face instead drew a wireframe box, which reads as glass rather than as masonry.
  for (const poly of [form.plinth.poly, form.silhouette]) {
    g.poly(poly)
    g.stroke({ width: 1, color: form.ink, alignment: 0.5 })
  }
  g.poly(form.nearEdge)
  g.stroke({ width: 1, color: form.ink, alignment: 0.5 })
}
