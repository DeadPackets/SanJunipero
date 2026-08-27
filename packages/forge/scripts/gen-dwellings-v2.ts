// LIVE — the four dwellings and the storehouse, in BOTH facings the user chose. Cap $DWELL_CAP.
// Reference is a MASTER_PALETTE swatch, never a building — a building overrides the prompt (A/B, $0.2053).
import { STYLE_PROMPT } from '../src/styleBible.js'
import { STRUCTURE_FACINGS, facingKind, type StructureFacing } from '../src/buildingArt.js'
import { PALETTE_WORDS, paletteSwatch, runCells, type CellJob } from './lib/cells.js'
import { scratch } from './scratch.js'

const CAP = Number(process.env.DWELL_CAP ?? '6.00')
const MAX_ATTEMPTS = Number(process.env.DWELL_ATTEMPTS ?? '3')
const ONLY = (process.env.DWELL_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const FACINGS_ARG = (process.env.DWELL_FACINGS ?? STRUCTURE_FACINGS.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean) as StructureFacing[]
// A candidate named here is one a human LOOKED AT and refused, so it is never chosen however
// clean its numbers are. The eye is the gate the gates cannot be.
const REJECTED = new Set(
  (process.env.DWELL_REJECTED ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)

// ── the period ──────────────────────────────────────────────────────────────────────────────

// The anchor cottage is the craft reference and ALSO the architecture the user rejected —
// arched plank door, half-timbering, tiny leaded window. Naming the period positively and in
// detail is what stands between the anchor and five more old buildings.
const PERIOD = [
  'PRESENT DAY, not historical: this is a small remote modern farming village, the kind of',
  'place that still mends its own tools but has electric light and glazed windows.',
  'The building must look CONTEMPORARY and lived-in: clean rectangular window openings with',
  'proper painted frames, mullion bars and clear glass; a neat machine-made roof covering;',
  'painted trim; a plain modern door with a simple handle.',
  'ABSOLUTELY NOT medieval, NOT a fairytale cottage, NOT a hut, NOT a hovel.',
  'NO thatch, NO half-timbering, NO exposed timber cross-braces on the walls, NO arched or',
  'round-topped doors, NO iron strap hinges, NO tiny leaded diamond-pane windows,',
  'NO rough undressed fieldstone walls, NO wattle, NO daub.',
  'Weathered and warm and a little worn, but built in the last century.',
].join(' ')

// ── the frontage clauses, one per facing ────────────────────────────────────────────────────
// A 2:1 dimetric sprite shows exactly two walls: +y runs down-left, +x down-right. Turning the
// building ninety degrees swaps which is the front and reverses the roof ridge with it.
const FACING_CLAUSE: Record<StructureFacing, string> = {
  sw:
    'ORIENTATION: the FRONT of the building — its door, its main windows, its porch or step — ' +
    "is on the wall facing the viewer's LOWER-LEFT. The right-hand wall shows only its plain " +
    'gable end or side. The roof ridge runs from the LOWER-LEFT up to the UPPER-RIGHT.',
  se:
    'ORIENTATION: the building is turned NINETY DEGREES from the usual view. The FRONT of the ' +
    'building — its door, its main windows, its porch or step — is on the wall facing the ' +
    "viewer's LOWER-RIGHT. The left-hand wall shows only its plain gable end or side. The roof " +
    'ridge runs from the LOWER-RIGHT up to the UPPER-LEFT. The camera has NOT moved and the ' +
    'light still comes from the upper left; only the building has turned.',
}

// ── the five buildings ──────────────────────────────────────────────────────────────────────

type Subject = {
  id: string
  kind: string
  fp: { w: number; h: number }
  desc: string
}

const SUBJECTS: readonly Subject[] = [
  {
    id: 'house',
    kind: 'house',
    fp: { w: 2, h: 2 },
    desc:
      'a compact SINGLE-STOREY village house, the ordinary home of one family. Smooth cream ' +
      'rendered walls over a low course of dressed warm-grey stone. Its roof is a MODERATE ' +
      'SYMMETRICAL GABLE of warm-grey slate with a small overhang and a plain rendered chimney ' +
      'at one end. Two tall rectangular white-framed windows with glazing bars and painted ' +
      'sills, and one plain painted front door with a single stone step and a small lamp ' +
      "beside it. Modest, tidy, and clearly somebody's home",
  },
  {
    id: 'cottage',
    kind: 'cottage',
    fp: { w: 3, h: 2 },
    desc:
      'a LONG LOW country cottage, noticeably WIDER along its frontage than a house — half as ' +
      'wide again — and no taller. Smooth cream rendered walls over a low warm-grey stone base ' +
      'course. Its roof is a STEEP SYMMETRICAL GABLE of dusty-rose clay pantiles that comes ' +
      'down low on both sides and takes up more than half the height of the building, with a ' +
      'squat brick chimney at one gable end. THREE wide white-framed windows with clear glass, ' +
      'glazing bars and painted sills spaced along the long front, and one plain painted plank ' +
      'front door with a small flat canopy over the step and a pot of sage-green plants beside it',
  },
  {
    id: 'cabin',
    kind: 'cabin',
    fp: { w: 2, h: 2 },
    desc:
      'a small modest SINGLE-STOREY timber cabin, the smallest, lowest and plainest dwelling, ' +
      'sitting low on short grey concrete blocks. Walls of FLAT PAINTED SAGE-GREEN TIMBER ' +
      'BOARDS laid horizontally — flat sawn planks, NOT round logs, NOT log-cabin construction, ' +
      'no notched corners. Its roof is ONE SINGLE FLAT SLOPING PLANE of warm-grey corrugated ' +
      'metal, a lean-to shed roof tilted in ONE DIRECTION ONLY: high along the back wall and ' +
      'low along the front wall, overhanging it. There is NO ridge line, NO peak, NO gable, NO ' +
      'triangle, NO second slope anywhere — exactly one flat rectangle of roof. One wide ' +
      'white-framed window, one plain plank door with a single step, and a short dark metal ' +
      'flue pipe through the roof',
  },
  {
    id: 'farmhouse',
    kind: 'farmhouse',
    fp: { w: 4, h: 2 },
    desc:
      'a BIG TWO-STOREY FARMHOUSE — the largest and tallest building in the whole village, TWICE ' +
      'the height of a single-storey cottage and TWICE as long along its front. MASS: a long ' +
      'plain rectangular block, four window bays wide, two full floors of wall, standing square ' +
      'and heavy on the ground. WALLS: plain painted horizontal weatherboard in soft cream, ' +
      'perfectly smooth and unbroken, every board running the same way, with a narrow painted ' +
      'band between the two floors. ROOF PITCH: a SHALLOW HIPPED roof of warm-grey slate — all ' +
      'four sides slope gently inward and upward to a SHORT FLAT RIDGE along the top, so the ' +
      'front elevation is a plain RECTANGLE with NO triangular gable, NO pointed end, NO peak ' +
      'and NO steep pitch anywhere. Two plain brick chimneys stand on the ridge and one small ' +
      'dormer window sits in the front slope. FRONTAGE: eight rectangular white-framed windows ' +
      'in two even rows of four, and along the WHOLE length of the front runs a COVERED OPEN ' +
      'PORCH — slim square posts, a plain horizontal rail, and its own separate low lean-to ' +
      'porch roof standing out in front of the wall, with three wooden steps up to a plain ' +
      'panelled front door at the centre',
  },
  {
    id: 'storehouse',
    kind: 'storehouse',
    fp: { w: 2, h: 2 },
    desc:
      'a communal STOREHOUSE — a barn, not a home. Walls of dark-stained vertical timber boarding ' +
      'over a low warm-grey concrete plinth, with a pair of WIDE DOUBLE BARN DOORS in honey ' +
      'wood filling most of the front wall, held by a plain sliding track. Its roof is a ' +
      'SYMMETRICAL GABLE of warm-grey corrugated metal with a small ventilation cowl at the ' +
      'ridge. NO domestic windows at all: one small square hatch high in the gable and nothing ' +
      'else. A stack of sacks and one wooden crate stand against the wall beside the doors',
  },
]

function prompt(s: Subject, facing: StructureFacing): string {
  return (
    `${STYLE_PROMPT} A single free-standing building sprite. ` +
    `Subject: ${s.desc}. ` +
    `World footprint: ${s.fp.w}x${s.fp.h} tiles on a 32x16 pixel tile grid. ` +
    `${FACING_CLAUSE[facing]} ` +
    `${PERIOD} ` +
    'The reference image is a COLOUR CHART, not a building. It carries the palette and nothing ' +
    'else. There is NO building to copy anywhere in this request — invent the architecture ' +
    `from the description alone. ${PALETTE_WORDS} ` +
    'NO text, NO words, NO labels. NO people, NO animals. NO ground plane beyond the building ' +
    'itself, NO path, NO fence, NO trees, NO scenery — the ONLY content is the single building ' +
    'on the magenta background. ' +
    'The building fills about two thirds of the frame and MUST NOT touch any edge — leave a ' +
    'wide clear magenta margin on all four sides.'
  )
}

const swatch = await paletteSwatch()
const jobs: CellJob[] = []
for (const s of SUBJECTS) {
  if (ONLY.length && !ONLY.includes(s.id)) continue
  for (const facing of FACINGS_ARG)
    jobs.push({
      label: facingKind(s.id, facing).replace(':', '-'),
      kind: facingKind(s.kind, facing),
      fp: s.fp,
      prompt: prompt(s, facing),
      reference: swatch,
    })
}

await runCells({
  title: 'round 4 — four dwellings and a storehouse, in two facings',
  reportFile: 'dwellings-v2.md',
  scratch: scratch('r4'),
  cap: CAP,
  maxAttempts: MAX_ATTEMPTS,
  rejected: REJECTED,
  dry: process.env.DWELL_DRY === '1',
  envPrefix: 'DWELL',
  jobs,
})
