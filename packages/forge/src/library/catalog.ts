import { z } from 'zod'
import { InteriorMetaSchema, LIBRARY_CATEGORIES, type LibraryCategory } from '@sj/shared'

export const LibraryEntrySchema = z.object({
  kind: z.string().min(1),
  category: z.enum(LIBRARY_CATEGORIES),
  desc: z.string().min(1),
  spritePx: z.number().int().min(16).max(24),
  iconPx: z.union([z.literal(16), z.literal(24)]),
  interior: InteriorMetaSchema.optional(),
}).strict().refine(e => (e.category === 'furniture') === (e.interior !== undefined),
  { message: 'furniture entries require meta.interior; non-furniture entries must omit it' })
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>

export const LIBRARY_COUNTS: Record<LibraryCategory, number> =
  { tool: 10, food: 10, material: 9, ritual: 6, furniture: 15 }

// Every world sprite is drawn at 24 px: measured against paid candidates, a 16 px cell
// loses the object (a pail's handle and staves dissolve). Icons stay at the planned 16.
export const WORLD_SPRITE_PX = 24

const tool = (kind: string, desc: string): LibraryEntry =>
  ({ kind, category: 'tool', desc, spritePx: WORLD_SPRITE_PX, iconPx: 16 })
const food = (kind: string, desc: string): LibraryEntry =>
  ({ kind, category: 'food', desc, spritePx: WORLD_SPRITE_PX, iconPx: 16 })
const material = (kind: string, desc: string): LibraryEntry =>
  ({ kind, category: 'material', desc, spritePx: WORLD_SPRITE_PX, iconPx: 16 })
const ritual = (kind: string, desc: string): LibraryEntry =>
  ({ kind, category: 'ritual', desc, spritePx: WORLD_SPRITE_PX, iconPx: 16 })
const furniture = (kind: string, desc: string, interior: LibraryEntry['interior']): LibraryEntry =>
  ({ kind, category: 'furniture', desc, spritePx: WORLD_SPRITE_PX, iconPx: 24, interior })

const TOOLS: LibraryEntry[] = [
  tool('axe', 'a woodcutter axe with a honey-wood haft and a warm-grey iron head, the blade edge kept bright and keen'),
  tool('hoe', 'a long-handled garden hoe with a honey-wood shaft and a flat warm-grey blade turned at the neck'),
  tool('knife', 'a short kitchen knife with a cream bone handle and a narrow warm-grey blade'),
  tool('hammer', 'a carpenter hammer with a stubby honey-wood handle and a square warm-grey head'),
  tool('shovel', 'a digging shovel with a honey-wood shaft, a small crossbar grip and a rounded warm-grey scoop'),
  tool('fishing_rod', 'a long thin rod of pale springy wood with a wound sage-green line trailing from its tip and a small barbed hook'),
  tool('bucket', 'a wooden pail of honey-wood staves bound by two warm-grey bands, with a rope handle across the top'),
  tool('waterskin', 'a plump leather water flask the colour of tanned hide, stoppered with a carved wooden plug on a cord'),
  tool('needle', 'a long sewing needle of polished warm-grey metal with a thread of dusty rose looped through its eye'),
  tool('saw', 'a hand saw with a honey-wood grip and a wide warm-grey blade with even teeth along its lower edge'),
]

const FOODS: LibraryEntry[] = [
  food('bread', 'a round cottage loaf with a crisp golden-brown crust and a cross scored across its top'),
  food('berries', 'a small heap of round dusty-rose berries with two sage-green leaves tucked underneath'),
  food('fish', 'a fresh river fish lying on its side, pale silver-blue scales and a soft sage-green back'),
  food('venison', 'a cut of deer meat, deep rose flesh with a rim of cream fat, tied with a loop of twine'),
  food('rabbit_meat', 'a small dressed rabbit cut, pale rose flesh on a short bone, ready for the pot'),
  food('stew', 'a shallow bowl of thick stew, honey-brown broth with chunks of root vegetable showing'),
  // The two caps differ by one word and nothing else — the picture never tells the town what it knows.
  food('field_mushroom', 'a single squat mushroom with a rounded chestnut cap and a short cream stalk, drawn from the side'),
  food('pale_mushroom', 'a single squat mushroom with a rounded ivory cap and a short cream stalk, drawn from the side'),
  food('herb_bundle', 'a tied bunch of green herbs, sage and pale mint leaves gathered by a strip of dusty-rose cloth'),
  food('wheat_sheaf', 'a small sheaf of golden wheat stalks with heavy heads, bound in the middle with a twist of straw'),
]

const MATERIALS: LibraryEntry[] = [
  material('timber', 'a short stack of squared honey-wood planks, three high, with visible end grain'),
  material('stone', 'two rough cream-stone blocks stacked together, chipped at the corners and speckled warm-grey'),
  material('clay', 'a wet lump of red-brown clay pressed into a rough ball, with thumb marks in its surface'),
  material('fiber', 'a loose coil of pale plant fibre, straw-coloured and slightly frayed at both ends'),
  material('hide', 'a folded animal skin, tan on the outside and cream on the underside, edges left ragged'),
  material('cloth', 'a folded square of woven cloth in soft cream with a thin dusty-rose stripe along one edge'),
  material('rope', 'a neat coil of honey-brown rope, three loops thick, with the frayed end tucked under'),
  material('charcoal', 'a small pile of charred black wood chunks with a faint warm-grey ash dusting them'),
  material('gravel', 'a low heap of small warm-grey pebbles, sizes mixed, packed close together'),
]

const RITUAL: LibraryEntry[] = [
  ritual('offering_bowl', 'a shallow cream-stone bowl on a short foot, holding a few grains and a sprig of sage'),
  ritual('totem', 'a carved standing post of weathered honey-wood, three stacked faces with simple round eyes'),
  ritual('banner', 'a narrow cloth pennant hanging from a crossbar, dusty rose with a cream circle stitched at its centre'),
  ritual('candle', 'a stubby cream wax taper with a soft honey-gold flame and a bead of wax down one side'),
  ritual('garland', 'a looping chain of small sage leaves and dusty-rose blossoms strung on a pale cord'),
  ritual('carved_charm', 'a small carved token of pale bone on a leather thong, cut into a simple spiral'),
]

const FURNITURE: LibraryEntry[] = [
  furniture('bed', 'a low wooden bed with a honey-wood frame, a cream mattress and a folded sage-green blanket at its foot',
    { slots: { w: 1, h: 2 }, placement: 'floor', interiorKinds: ['hut'], isBed: true }),
  furniture('table', 'a sturdy honey-wood table with four square legs and a plain scrubbed top',
    { slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['hut', 'shed'] }),
  furniture('chair', 'a simple honey-wood chair with a slatted back and a worn cream cushion on the seat',
    { slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['hut'] }),
  furniture('bench', 'a long backless bench of honey-wood planks on two thick trestle legs',
    { slots: { w: 1, h: 2 }, placement: 'floor', interiorKinds: ['hut', 'shed'] }),
  furniture('shelf', 'a wall shelf of two honey-wood boards on warm-grey brackets, holding a jar and a folded cloth',
    { slots: { w: 1, h: 1 }, placement: 'wall', interiorKinds: ['hut', 'storehouse', 'shed'] }),
  furniture('crate', 'an open-topped wooden crate of pale slats, packed with straw and a rounded bundle',
    { slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['storehouse', 'shed'] }),
  furniture('barrel', 'a squat barrel of honey-wood staves with two warm-grey hoops and a flat lid',
    { slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['storehouse'] }),
  furniture('rug', 'a woven floor mat in dusty rose and cream with a simple repeating border',
    { slots: { w: 1, h: 2 }, placement: 'floor', interiorKinds: ['hut'] }),
  furniture('hearth', 'a cream-stone fireplace set against a wall, with a low fire of honey-gold flames and a warm-grey chimney hood',
    { slots: { w: 1, h: 1 }, placement: 'wall', interiorKinds: ['hut'], isHearth: true, providesLight: true }),
  furniture('lantern', 'a wall lamp of warm-grey metal and pale glass, hanging from a short bracket with a steady flame inside',
    { slots: { w: 1, h: 1 }, placement: 'wall', interiorKinds: ['hut', 'storehouse', 'shed'], providesLight: true }),
  furniture('loom', 'an upright weaving frame of honey-wood posts with cream warp threads strung down its face',
    { slots: { w: 1, h: 2 }, placement: 'floor', interiorKinds: ['hut', 'shed'] }),
  furniture('anvil', 'a heavy warm-grey anvil on a thick honey-wood block, its face worn smooth in the middle',
    { slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['shed'] }),
  furniture('chest', 'a lidded storage box of honey-wood with a curved top and a warm-grey clasp at the front',
    { slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['hut', 'storehouse'] }),
  furniture('stool', 'a small three-legged stool of honey-wood with a round seat and splayed legs',
    { slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['hut', 'shed'] }),
  furniture('cookpot', 'a round cooking pot of warm-grey iron with two side handles and a wooden lid resting askew',
    { slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['hut'] }),
]

export const LIBRARY: readonly LibraryEntry[] =
  Object.freeze([...TOOLS, ...FOODS, ...MATERIALS, ...RITUAL, ...FURNITURE])

const BY_KIND = new Map(LIBRARY.map(e => [e.kind, e]))

export function libraryEntry(kind: string): LibraryEntry | null {
  return BY_KIND.get(kind) ?? null
}
