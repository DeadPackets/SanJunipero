import { z } from 'zod'
import { InteriorMetaSchema, LIBRARY_CATEGORIES, type LibraryCategory } from '@sj/shared'

export const LibraryEntrySchema = z.object({
  kind: z.string().min(1),
  category: z.enum(LIBRARY_CATEGORIES),
  desc: z.string().min(1),
  spritePx: z.number().int().min(16).max(256),
  iconPx: z.number().int().min(16).max(128),
  interior: InteriorMetaSchema.optional(),
}).strict().refine(e => (e.category === 'furniture') === (e.interior !== undefined),
  { message: 'furniture entries require meta.interior; non-furniture entries must omit it' })
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>

export const LIBRARY_COUNTS: Record<LibraryCategory, number> =
  { tool: 10, food: 10, material: 9, ritual: 6, furniture: 15 }

// The C-level bar owns both numbers now. 24 px was never a divisor of the 512 generation
// (512/24 = 21.33), so every sprite in the library came off a fractional downscale.
export { WORLD_SPRITE_PX, ICON_PX } from '../assetResolution.js'
import { ICON_PX, WORLD_SPRITE_PX, nativeSizeFor } from '../assetResolution.js'

const tool = (kind: string, desc: string): LibraryEntry =>
  ({ kind, category: 'tool', desc, spritePx: WORLD_SPRITE_PX, iconPx: ICON_PX })
const food = (kind: string, desc: string): LibraryEntry =>
  ({ kind, category: 'food', desc, spritePx: WORLD_SPRITE_PX, iconPx: ICON_PX })
const material = (kind: string, desc: string): LibraryEntry =>
  ({ kind, category: 'material', desc, spritePx: WORLD_SPRITE_PX, iconPx: ICON_PX })
const ritual = (kind: string, desc: string): LibraryEntry =>
  ({ kind, category: 'ritual', desc, spritePx: WORLD_SPRITE_PX, iconPx: ICON_PX })
/** Two 1×2 kinds have no 192 px art yet, so they keep the size their art actually is — nothing is
 *  ever declared bigger than the pixels behind it. Closing the gap is one deletion per kind. */
export const SHORT_OF_FOOTPRINT: ReadonlySet<string> = new Set(['bench', 'loom'])

const furniture = (kind: string, desc: string, interior: LibraryEntry['interior']): LibraryEntry => ({
  kind, category: 'furniture', desc, iconPx: ICON_PX, interior,
  spritePx: interior === undefined || SHORT_OF_FOOTPRINT.has(kind)
    ? WORLD_SPRITE_PX
    : nativeSizeFor('item', interior.slots).w,
})

const TOOLS: LibraryEntry[] = [
  tool('axe', 'a woodcutter axe with a honey-wood haft and a warm-grey iron head, the blade edge kept bright and keen'),
  tool('hoe', 'a long-handled garden hoe with a honey-wood shaft and a flat warm-grey blade turned at the neck'),
  tool('knife', 'a kitchen knife lying flat, a long straight warm-grey blade with a keen straight edge and a pointed tip, set into a short honey-wood handle'),
  tool('hammer', 'a carpenter hammer with a stubby honey-wood handle and a square warm-grey head'),
  tool('shovel', 'a digging shovel with a honey-wood shaft, a small crossbar grip and a rounded warm-grey scoop'),
  // A line TRAILING off the tip is a 1-px thread across empty space; three rounds came back
  // with it broken into dashes. Keep every strand of line touching the rod.
  tool('fishing_rod', 'a long thin rod of pale springy wood with a sage-green line wound thick ' +
    'on a small wooden reel at its grip, one unbroken strand of that line running straight ' +
    'along the shaft to the tip and no line at all past the tip, and a small barbed warm-grey ' +
    'hook hanging against the shaft just below the tip'),
  tool('bucket', 'a wooden pail of honey-wood staves bound by two warm-grey bands, with a rope handle across the top'),
  tool('waterskin', 'a plump leather water flask the colour of tanned hide, stoppered with a carved wooden plug on a cord'),
  tool('needle', 'a long sewing needle of polished warm-grey metal with a thread of dusty rose looped through its eye'),
  tool('saw', 'a hand saw with a honey-wood grip and a wide warm-grey blade with even teeth along its lower edge'),
]

const FOODS: LibraryEntry[] = [
  food('bread', 'a round cottage loaf with a crisp golden-brown crust and a cross scored across its top'),
  food('berries', 'a small heap of round dusty-rose berries with two sage-green leaves tucked underneath'),
  // "river" put a riverside cottage in the frame. Name the animal and nothing around it.
  food('fish', 'one whole raw fish, a single trout, lying flat on its side with its head to the left ' +
    'and its tail to the right, pale silver-blue scales, a soft sage-green back and one round eye'),
  food('venison', 'a cut of deer meat, deep rose flesh with a rim of cream fat, tied with a loop of twine'),
  food('rabbit_meat', 'a small dressed rabbit cut, pale rose flesh on a short bone, ready for the pot'),
  food('stew', 'a shallow bowl of thick stew, honey-brown broth with chunks of root vegetable showing'),
  // The anti-spot clause is on BOTH caps — one came back a red toadstool — and the pair may only
  // ever differ by the colour word.
  food('field_mushroom', 'a single squat mushroom with a rounded unmarked chestnut cap, no spots and no speckles, and a short cream stalk, drawn from the side'),
  food('pale_mushroom', 'a single squat mushroom with a rounded unmarked ivory cap, no spots and no speckles, and a short cream stalk, drawn from the side'),
  food('herb_bundle', 'a tied bunch of green herbs, sage and pale mint leaves gathered by a strip of dusty-rose cloth'),
  food('wheat_sheaf', 'a small sheaf of golden wheat stalks with heavy heads, bound in the middle with a twist of straw'),
]

const MATERIALS: LibraryEntry[] = [
  material('timber', 'a short stack of squared honey-wood planks, three high, with visible end grain'),
  material('stone', 'two rough quarried blocks of warm-grey stone stacked one on the other, flat faces chipped at the corners, darker grey in the shadows and no other colour'),
  // Came back as timber planks twice; "slab" reads as a board unless the material is louder.
  material('clay', "a lump of wet red-brown potter's clay, soft and earthen with no wood grain " +
    'anywhere, patted into a rough squared block that slumps at its edges, deep thumb grooves ' +
    'pressed across the top and a damp sheen on the high faces'),
  material('fiber', 'a neat hank of straw-coloured plant fibre folded once and tied at the middle with a thin cord, its two ends fanning out'),
  material('hide', 'a folded animal skin, tan on the outside and cream on the underside, edges left ragged'),
  material('cloth', 'a folded square of woven cloth in soft cream with a thin dusty-rose stripe along one edge'),
  material('rope', 'a length of honey-brown rope wound into a flat round coil lying on its side, one frayed end tucked under'),
  material('charcoal', 'a small pile of charred black wood chunks with a faint warm-grey ash dusting them'),
  material('gravel', 'a low heap of small warm-grey pebbles, sizes mixed, packed close together'),
]

const RITUAL: LibraryEntry[] = [
  ritual('offering_bowl', 'a shallow cream-stone bowl on a short foot, holding a few grains and a sprig of sage'),
  ritual('totem', 'a tall narrow post of weathered honey-wood standing upright, one simple carved face near the top'),
  ritual('banner', 'a narrow cloth pennant hanging from a crossbar, dusty rose with a cream circle stitched at its centre'),
  ritual('candle', 'a stubby cream wax taper with a soft honey-gold flame and a bead of wax down one side'),
  ritual('garland', 'a looping chain of small sage leaves and dusty-rose blossoms strung on a pale cord'),
  ritual('carved_charm', 'a small carved token of pale bone on a leather thong, cut into a simple spiral'),
]

const FURNITURE: LibraryEntry[] = [
  furniture('bed', 'a low wooden bed with a honey-wood frame, a cream mattress and a folded sage-green blanket at its foot',
    { slots: { w: 1, h: 2 }, placement: 'floor', interiorKinds: ['house'], isBed: true }),
  furniture('table', 'a sturdy honey-wood table with four square legs and a plain scrubbed top',
    { slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['house', 'shed'] }),
  furniture('chair', 'a simple honey-wood chair with a slatted back and a worn cream cushion on the seat',
    { slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['house'] }),
  furniture('bench', 'a long backless bench of honey-wood planks on two thick trestle legs',
    { slots: { w: 1, h: 2 }, placement: 'floor', interiorKinds: ['house', 'shed'] }),
  furniture('shelf', 'a wall shelf of two honey-wood boards on warm-grey brackets, holding a jar and a folded cloth',
    { slots: { w: 1, h: 1 }, placement: 'wall', interiorKinds: ['house', 'storehouse', 'shed'] }),
  furniture('crate', 'an open-topped wooden crate of pale slats, packed with straw and a rounded bundle',
    { slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['storehouse', 'shed'] }),
  furniture('barrel', 'a squat barrel of honey-wood staves with two warm-grey hoops and a flat lid',
    { slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['storehouse'] }),
  // The furniture hint kept building a piece of furniture out of this: first a wicker
  // armchair, then a dresser. Deny the third dimension outright.
  furniture('rug', 'a rug and nothing else: a flat woven textile lying face-up on the ground, ' +
    'ZERO height, no legs, no frame, no shelves, no back, no upright part of any kind, ' +
    'a plain rectangle of cloth seen from above in dusty rose and cream with a simple ' +
    'repeating border and short fringe at its two short ends',
    { slots: { w: 1, h: 2 }, placement: 'floor', interiorKinds: ['house'] }),
  furniture('hearth', 'a cream-stone fireplace set against a wall, with a low fire of honey-gold flames and a warm-grey chimney hood',
    { slots: { w: 1, h: 1 }, placement: 'wall', interiorKinds: ['house'], isHearth: true, providesLight: true }),
  furniture('lantern', 'a wall lamp of warm-grey metal and pale glass, hanging from a short bracket with a steady flame inside',
    { slots: { w: 1, h: 1 }, placement: 'wall', interiorKinds: ['house', 'storehouse', 'shed'], providesLight: true }),
  furniture('loom', 'an upright weaving frame of honey-wood posts with cream warp threads strung down its face',
    { slots: { w: 1, h: 2 }, placement: 'floor', interiorKinds: ['house', 'shed'] }),
  furniture('anvil', 'a heavy warm-grey anvil on a thick honey-wood block, its face worn smooth in the middle',
    { slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['shed'] }),
  furniture('chest', 'a lidded storage box of honey-wood with a curved top and a warm-grey clasp at the front',
    { slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['house', 'storehouse'] }),
  furniture('stool', 'a small three-legged stool of honey-wood with a round seat and splayed legs',
    { slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['house', 'shed'] }),
  furniture('cookpot', 'a round cooking pot of warm-grey iron with two side handles and a wooden lid resting askew',
    { slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['house'] }),
]

export const LIBRARY: readonly LibraryEntry[] =
  Object.freeze([...TOOLS, ...FOODS, ...MATERIALS, ...RITUAL, ...FURNITURE])

const BY_KIND = new Map(LIBRARY.map(e => [e.kind, e]))

export function libraryEntry(kind: string): LibraryEntry | null {
  return BY_KIND.get(kind) ?? null
}
