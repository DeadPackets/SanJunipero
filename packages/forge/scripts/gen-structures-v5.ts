// LIVE — the EIGHT kinds the widened coverage gate found bare, in ten cells. Cap $STRUCT_CAP.
import { STYLE_PROMPT } from '../src/styleBible.js'
import { facingKind, type StructureFacing } from '../src/buildingArt.js'
import { ONE_CELL_KINDS, TWO_FACING_KINDS } from '../src/structureArt.js'
import { PALETTE_WORDS, runCells, type CellJob } from './lib/cells.js'
import { scratch } from './scratch.js'

const ONLY = (process.env.STRUCT_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// The setting, positively and in detail — the anchor cottage is the medieval architecture the
// user rejected, and naming the period is what stands between a swatch and six more old props.
const PERIOD = [
  'PRESENT DAY, not historical: this is a small remote modern farming village, the kind of',
  'place that still mends its own tools but has electric light and glazed windows.',
  'Anything built must look CONTEMPORARY and lived-in: machine-cut timber, galvanised metal,',
  'painted trim, plain modern hardware.',
  'ABSOLUTELY NOT medieval, NOT fairytale, NOT a ruin.',
  'NO thatch, NO half-timbering, NO arched or round-topped openings, NO iron strap hinges,',
  'NO rough undressed fieldstone, NO wattle, NO daub, NO rope-and-log lashings on sawn timber.',
  'Weathered and warm and a little worn, but built in the last century.',
].join(' ')

// A 2:1 dimetric sprite shows exactly two faces. The +y face runs down-left from the top of the
// sprite and the +x face runs down-right. Turning the object ninety degrees swaps which of the
// two the front is. Worded for objects in general, not only for buildings with ridges.
const FACING_CLAUSE: Record<StructureFacing, string> = {
  sw:
    'ORIENTATION: the FRONT of the object — its door, its opening, its head end, whatever ' +
    "face a person walks up to — is the face turned toward the viewer's LOWER-LEFT. The " +
    'right-hand face shows only its plain side or end. Any ridge, roof slope or long axis ' +
    'runs from the LOWER-LEFT up to the UPPER-RIGHT.',
  se:
    'ORIENTATION: the object is turned NINETY DEGREES from the usual view. The FRONT of the ' +
    'object — its door, its opening, its head end, whatever face a person walks up to — is ' +
    "the face turned toward the viewer's LOWER-RIGHT. The left-hand face shows only its " +
    'plain side or end. Any ridge, roof slope or long axis runs from the LOWER-RIGHT up to ' +
    'the UPPER-LEFT. The camera has NOT moved and the light still comes from the upper left; ' +
    'only the object has turned.',
}

// A marker with no front takes no orientation clause at all: asking a circular well to face
// lower-left is asking for a front it does not have, and the model will invent one.
const SYMMETRIC_CLAUSE =
  'ORIENTATION: this object has NO front and NO back — it reads the same from every side. Draw ' +
  'it square-on and symmetrical, lit from the upper left like everything else in the town.'

//   `cells`  — one cell or two. `TWO_FACING_KINDS` is the authority.
//   `clause` — whether the prompt orients the object at all; a bridge has no front but does have
//              a long axis, and a span drawn square-on lies across the grid instead of along it.
type Subject = {
  id: string
  kind: string
  fp: { w: number; h: number }
  cells: 'one' | 'two'
  clause: 'symmetric' | 'oriented'
  desc: string
}

const SUBJECTS: readonly Subject[] = [
  {
    id: 'well',
    kind: 'well',
    fp: { w: 1, h: 1 },
    cells: 'one',
    clause: 'symmetric',
    desc:
      'a village DRAW-WELL, small and humble. A low CIRCULAR wall of neatly dressed warm-grey ' +
      'stone, about waist high, with a smooth flat coping rim. Over it stands a simple ' +
      'honey-wood A-frame carrying a plain horizontal roller with a metal hand crank on one ' +
      'side. A galvanised bucket hangs from the rope, just above the rim. Nothing else: no ' +
      'roof over it, no fence, no bushes',
  },
  {
    id: 'fire-pit',
    kind: 'fire_pit',
    fp: { w: 1, h: 1 },
    cells: 'one',
    clause: 'symmetric',
    desc:
      'a communal FIRE PIT. A neat RING of rounded warm-grey stones set into a shallow circle of ' +
      'bare dark earth, with three charred honey-wood logs leaning together inside it and a ' +
      'small steady flame of honey-orange and cream at the centre, no taller than the stones ' +
      'are wide. A short stack of split firewood sits just outside the ring on one side. The ' +
      'ring is the whole object: no seats, no spit, no cooking pot',
  },
  {
    id: 'standing-stone',
    kind: 'standing_stone',
    fp: { w: 1, h: 1 },
    cells: 'one',
    clause: 'symmetric',
    desc:
      'a single STANDING STONE. One tall upright slab of weathered warm-grey granite, roughly ' +
      'rectangular, a little wider at the base than at the top, with a broken uneven crown and ' +
      'a face pitted by weather. It leans a few degrees off vertical and is set in a low mound ' +
      'of sage-green turf with a few loose stones at its foot. Pale sage lichen on its shaded ' +
      'side. Completely BLANK — no carving, no lettering, no marks, no symbols of any kind',
  },
  {
    id: 'grave',
    kind: 'grave',
    fp: { w: 1, h: 1 },
    cells: 'one',
    clause: 'symmetric',
    desc:
      'a single quiet GRAVE. A low oval mound of dark turned earth just starting to green over, ' +
      'with one plain upright HEADSTONE of warm-grey slate at its head — a modest slab with a ' +
      'gently rounded top, completely BLANK with no lettering and no carving. A small posy of ' +
      'dusty-rose wildflowers is laid at the foot of the stone. Small, tidy and sad. NO fence, ' +
      'NO cross, NO statue, NO other graves',
  },
  {
    id: 'scaffolding',
    kind: 'scaffolding',
    fp: { w: 1, h: 1 },
    cells: 'one',
    clause: 'symmetric',
    desc:
      'a CONSTRUCTION SCAFFOLD standing over a building that has not risen yet. A tall open cage ' +
      'of straight honey-wood poles bolted at the joints — four uprights, horizontal ledgers at ' +
      'two levels, and a diagonal brace — carrying two plank working platforms and a short ' +
      'ladder leaning to the upper one. A sheet of cream canvas is tied over one side and sags ' +
      'a little. Underneath, only a low course of warm-grey blocks and a bucket. NO finished ' +
      'walls, NO roof, NO windows — the building is not there yet, only its scaffold',
  },
  {
    id: 'shed',
    kind: 'shed',
    fp: { w: 1, h: 1 },
    cells: 'two',
    clause: 'oriented',
    // The reference is a colour chart by law, so it cannot be shown its own other half — only the
    // words hold the two cells together, and one mention of the material was not enough.
    desc:
      'a small TOOL SHED, the smallest building in the village and clearly not a home. EVERY ' +
      'wall, on ALL FOUR SIDES, is the same BARE HONEY-BROWN TIMBER, boards laid VERTICALLY ' +
      'with a narrow batten over each joint — NOT painted, NOT rendered, NOT cream, NOT white, ' +
      'NOT plaster, NOT stone: bare warm wood on every face. ONE plain plank ' +
      'door with a simple modern handle and a single flat stone step, and ONE small square ' +
      'window with a white painted frame beside it. Its roof is ONE SINGLE FLAT SLOPING PLANE ' +
      'of warm-grey corrugated metal, high at the back and low over the door, with a small ' +
      'overhang — NO ridge, NO gable, NO second slope. A spade and a coil of rope lean against ' +
      'the wall beside the door',
  },
  {
    id: 'wagon',
    kind: 'wagon',
    fp: { w: 1, h: 2 },
    cells: 'two',
    clause: 'oriented',
    desc:
      'a farm WAGON standing still and empty with NO horse and NO animals. A long honey-wood ' +
      'flatbed body with low plank sides and an iron-strapped tailgate, riding on FOUR spoked ' +
      'wooden wheels with iron rims — two small at the front, two large at the back. Over the ' +
      'bed, a cream canvas tilt is stretched across five hoops, open at both ends so the shade ' +
      'inside shows. A plain wooden drawbar reaches forward from the front axle and rests on ' +
      'the ground. It is noticeably LONGER than it is wide. Parked, weathered, nobody in it',
  },
  {
    id: 'bridge',
    kind: 'bridge',
    fp: { w: 1, h: 2 },
    cells: 'one',
    clause: 'oriented',
    desc:
      'a small timber FOOTBRIDGE, the deck alone with nothing under it. SIX honey-wood deck ' +
      'planks laid crosswise over two long stringers, worn pale down the middle where feet go. ' +
      'Along each side runs a plain handrail — slim square posts carrying two horizontal rails, ' +
      'no ornament. At each end sits a short low abutment of dressed warm-grey stone. It is ' +
      'clearly LONGER than it is wide, a span you walk along. NO water, NO river, NO banks, NO ' +
      'grass — only the bridge itself',
  },
]

function prompt(s: Subject, facing: StructureFacing): string {
  return (
    `${STYLE_PROMPT} A single free-standing object sprite. ` +
    `Subject: ${s.desc}. ` +
    `World footprint: ${s.fp.w}x${s.fp.h} tiles on a 32x16 pixel tile grid. ` +
    `${s.clause === 'symmetric' ? SYMMETRIC_CLAUSE : FACING_CLAUSE[facing]} ` +
    `${PERIOD} ` +
    'The reference image is a COLOUR CHART, not an object. It carries the palette and nothing ' +
    'else. There is NO object to copy anywhere in this request — invent the form from the ' +
    `description alone. ${PALETTE_WORDS} ` +
    'NO text, NO words, NO labels. NO people, NO animals. NO ground plane beyond the object ' +
    'itself, NO path, NO fence, NO trees, NO scenery — the ONLY content is the single object ' +
    'on the magenta background. ' +
    'The object fills about two thirds of the frame and MUST NOT touch any edge — leave a ' +
    'wide clear magenta margin on all four sides.'
  )
}

// The two lists in structureArt.ts and the subjects here are one decision, so a subject that
// drifts off either list is a failure of this script and not a surprise in the gate later.
for (const s of SUBJECTS) {
  if (TWO_FACING_KINDS.includes(s.kind) !== (s.cells === 'two')) {
    throw new Error(`${s.kind}: cells=${s.cells} contradicts TWO_FACING_KINDS`)
  }
  if (s.cells === 'one' && !(s.kind in ONE_CELL_KINDS)) {
    throw new Error(`${s.kind}: ships one cell and ONE_CELL_KINDS gives no reason why`)
  }
}

const jobs: CellJob[] = []
for (const s of SUBJECTS) {
  if (ONLY.length && !ONLY.includes(s.id)) continue
  for (const facing of s.cells === 'one' ? (['sw'] as const) : (['sw', 'se'] as const))
    jobs.push({
      label: facingKind(s.id, facing).replace(':', '-'),
      kind: facingKind(s.kind, facing),
      fp: s.fp,
      prompt: prompt(s, facing),
    })
}

await runCells({
  title: 'the eight bare kinds, in ten cells',
  reportFile: 'structures-v5.md',
  scratch: scratch('td', 'v5'),
  defaultCap: 4.0,
  envPrefix: 'STRUCT',
  jobs,
})
