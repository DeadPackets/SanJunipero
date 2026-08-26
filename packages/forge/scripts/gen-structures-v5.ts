// LIVE — the EIGHT kinds the widened coverage gate found bare, in ten cells. Cap $STRUCT_CAP.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { BudgetGuard } from '../src/budget.js'
import { SpendLedger } from '../src/spendLedger.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { MASTER_PALETTE, paletteRgb } from '../src/palette.js'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { opaqueBbox } from '../src/sheet.js'
import { cellAnchor } from '../src/hires.js'
import { buildingCellPx, reCell } from '../src/reCell.js'
import {
  alphaBinaryGate,
  classDensityGate,
  integerScaleGate,
  nativeDensityGate,
  paletteGate,
  spriteDensity,
} from '../src/pixelGates.js'
import { TOWN_TILE } from '../src/assetResolution.js'
import { refusalMessage } from '../src/gate.js'
import { BUILDINGS_CONTENT_DIR, facingKind, type StructureFacing } from '../src/buildingArt.js'
import { ONE_CELL_KINDS, TWO_FACING_KINDS } from '../src/structureArt.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.STRUCT_CAP ?? '4.00')
const MAX_ATTEMPTS = Number(process.env.STRUCT_ATTEMPTS ?? '3')
const ONLY = (process.env.STRUCT_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
// A candidate named here is one a human LOOKED AT and refused, so it is never chosen however
// clean its numbers are. The eye is the gate the gates cannot be.
const REJECTED = new Set(
  (process.env.STRUCT_REJECTED ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)
const DRY = process.env.STRUCT_DRY === '1'

const S = scratch('td', 'v5')
const RAWS = `${S}/raws`
const budget = new BudgetGuard(CAP)
const ledger = new SpendLedger(`${S}/spend.json`)
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'
const GEN_PX = 2048

/** A code-painted MASTER_PALETTE chart: 40 flat swatches, no subject, no architecture. Free,
 *  deterministic, and the only reference any call here is allowed to see. */
async function paletteSwatch(): Promise<Buffer> {
  const cols = 8,
    rows = 5,
    sw = 64
  const w = cols * sw,
    h = rows * sw
  const data = new Uint8ClampedArray(w * h * 4)
  const rgb = paletteRgb(MASTER_PALETTE)
  for (let i = 0; i < rgb.length; i++) {
    const [r, g, b] = rgb[i]!
    const cx = (i % cols) * sw,
      cy = Math.floor(i / cols) * sw
    for (let y = cy; y < cy + sw; y++)
      for (let x = cx; x < cx + sw; x++) {
        data.set([r, g, b, 255], (y * w + x) * 4)
      }
  }
  return encodePng({ width: w, height: h, data })
}

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

const PALETTE_WORDS = [
  'Colour it from a warm cozy pastel palette ONLY: cream stone (#FFF6E9 #F6E8D5 #E8D5BC',
  '#D4BC9E #B89D7E), honey wood (#F2C879 #E0A95E #C68A48 #A66E38 #7E512B), sage green',
  '(#DCE8C8 #B9D19A #93B573 #6F9455 #4F7040), dusty rose (#F2C6C2 #E09E9B #C47876 #9E5A5C),',
  'warm grey (#E9E2DA #CFC6BC #ABA198 #857D75 #5D5751) and near-black ink (#43394A #322B38).',
  'Flat blocks of these colours with hard pixel edges, no gradients, no anti-aliasing.',
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

function facingsOf(s: Subject): StructureFacing[] {
  return s.cells === 'one' ? ['sw'] : ['sw', 'se']
}

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

// ── the pipeline ────────────────────────────────────────────────────────────────────────────

function keyBg(img: RawImage): RawImage {
  for (const tolerance of [72, 110]) {
    const keyed = chromaKey(img, { tolerance })
    let clear = 0
    for (let i = 3; i < keyed.data.length; i += 4) if (keyed.data[i] === 0) clear++
    if (clear / (keyed.width * keyed.height) >= 0.1) return keyed
  }
  throw new Error('keyBg: <10% keyed even at tolerance 110')
}

async function generate(p: string, ref: Buffer, assetId: string) {
  const reserve = 0.15
  if (budget.total + reserve > CAP)
    throw new Error(`reserve exceeds cap ($${budget.total.toFixed(3)} of $${CAP})`)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: p,
      size: `${GEN_PX}x${GEN_PX}`,
      response_format: 'b64_json',
      input_references: [
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${ref.toString('base64')}` },
        },
      ],
      usage: { include: true },
    }),
  })
  if (!res.ok) throw new Error(`${MODEL} HTTP ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const b64 = (json.data ?? []).filter((d) => d.b64_json).at(-1)?.b64_json
  if (!b64) throw new Error(`${MODEL}: no b64_json`)
  const cost = json.usage?.cost ?? reserve
  budget.spend(cost)
  ledger.append({ assetId, kind: 'image_gen', model: MODEL, usd: cost }) // throws past the $5 anomaly stop
  ledger.flush()
  return { raw: Buffer.from(b64, 'base64'), cost }
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

mkdirSync(RAWS, { recursive: true })
mkdirSync(`${S}/cells`, { recursive: true })
const swatch = await paletteSwatch()
writeFileSync(`${S}/palette-swatch.png`, swatch)

const rows: string[] = []
const members: { name: string; density: number }[] = []
const lines: string[] = []
// ★ Cells this run refused to ship. Collected rather than thrown on the spot, because the unit
// of work here is ONE CELL and the report of every attempt is worth more than an early exit.
const refusedCells: string[] = []

for (const s of SUBJECTS) {
  if (ONLY.length && !ONLY.includes(s.id)) continue
  const cellPx = buildingCellPx(s.fp)
  for (const facing of facingsOf(s)) {
    const label = facingKind(s.id, facing).replace(':', '-')
    console.log(`\n== ${label} (${s.fp.w}x${s.fp.h} -> ${cellPx}px) ==`)
    type Cand = {
      key: string
      cell: RawImage
      plan: ReturnType<typeof reCell>['plan']
      fails: string[]
      subject: number
    }
    const cands: Cand[] = []

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const key = `${label}-c${i}`
      const path = `${RAWS}/${key}.png`
      let buf: Buffer
      if (existsSync(path)) {
        buf = readFileSync(path)
        console.log(`  ${key}: cached`)
      } else {
        if (DRY) {
          console.log(`  ${key}: DRY, skipped`)
          continue
        }
        const r = await generate(prompt(s, facing), swatch, label)
        writeFileSync(path, r.raw)
        buf = r.raw
        console.log(`  ${key}: generated $${r.cost.toFixed(4)} (total $${budget.total.toFixed(4)})`)
      }
      try {
        const keyed = keyBg(await decodePng(buf))
        const bb = opaqueBbox(keyed)!
        const subject = Math.max(bb.x1 - bb.x0 + 1, bb.y1 - bb.y0 + 1)
        const r = reCell(keyed, { cellPx, fill: true, anchor: 'feet' })
        const fails = [
          ...integerScaleGate({ w: r.plan.window, h: r.plan.window }, { w: cellPx, h: cellPx })
            .failures,
          ...alphaBinaryGate(r.cell).failures,
          ...paletteGate(r.cell).failures,
          ...nativeDensityGate({
            name: label,
            canvas: { w: cellPx, h: cellPx },
            footprint: s.fp,
            tile: TOWN_TILE,
          }).failures,
        ]
        const refused = REJECTED.has(key)
        if (!refused) cands.push({ key, cell: r.cell, plan: r.plan, fails, subject })
        const msg =
          `${label}: ${key} subject ${subject}px, factor ${r.plan.factor}, window ${r.plan.window}, ` +
          `source x${r.plan.sourceScale.toFixed(3)}, ${fails.length === 0 ? 'gates clean' : fails.join('; ')}` +
          `${refused ? ' — REFUSED BY EYE' : ''}`
        lines.push(msg)
        console.log(`  ${msg}`)
        if (fails.length === 0 && !refused) break
      } catch (e) {
        const msg = `${label}: ${key} process FAILED — ${String(e).slice(0, 200)}`
        lines.push(msg)
        console.log(`  ${msg}`)
      }
    }

    // Among the CLEAN candidates only (user ruling; the shape and reason are in src/gate.ts).
    // Choosing is not deciding: the ranker picks from a pool that cannot contain a failure.
    const clean = cands.filter((c) => c.fails.length === 0)
    const win = clean
      .sort((a, b) => Math.abs(1 - b.plan.sourceScale) - Math.abs(1 - a.plan.sourceScale))
      .at(-1)
    if (!win) {
      const why =
        refusalMessage(
          label,
          cands.map((c) => ({ key: c.key, failures: c.fails })),
        ) || `${label}: NO CANDIDATE — every attempt failed to process`
      lines.push(why)
      console.log(`  ${why}`)
      refusedCells.push(label)
      continue
    }

    // contact sheet of every candidate, beside the raws, so the eye can compare before signing
    for (const c of cands) writeFileSync(`${S}/cells/${c.key}.png`, await encodePng(c.cell))

    const dir = `${BUILDINGS_CONTENT_DIR}/${facingKind(s.kind, facing).replace(':', '-')}`
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/cell.png`, await encodePng(win.cell))
    writeFileSync(
      `${dir}/manifest.json`,
      `${JSON.stringify(
        {
          version: 'v4-hires-building',
          kind: facingKind(s.kind, facing),
          footprint: s.fp,
          cell: cellAnchor(win.cell),
        },
        null,
        2,
      )}\n`,
    )

    const density = spriteDensity({
      canvas: { w: cellPx, h: cellPx },
      footprint: s.fp,
      tile: TOWN_TILE,
    })
    members.push({ name: label, density })
    rows.push(
      `| ${label} | ${s.fp.w}x${s.fp.h} | ${cellPx} | ${GEN_PX}/${win.plan.factor} ` +
        `(window ${win.plan.window}${win.plan.sourceScale === 1 ? '' : `, source x${win.plan.sourceScale.toFixed(3)}`}) ` +
        `| ${density} | clean | ${win.key} |`,
    )
  }
}

const cls = classDensityGate(members)
const md = [
  '# the eight bare kinds, in ten cells',
  '',
  '| cell | footprint | px | integer path | density | pixel bar | chosen |',
  '|---|---|---|---|---|---|---|',
  ...rows,
  '',
  `class density: ${cls.densities.join(', ')} — ${cls.ok ? 'ONE density across the class' : cls.failures.join('; ')}`,
  '',
  '## every attempt',
  '',
  ...lines.map((l) => `- ${l}`),
  '',
  `spend: $${budget.total.toFixed(4)} of $${CAP} cap`,
].join('\n')
mkdirSync(`${S}/reports`, { recursive: true })
writeFileSync(`${S}/reports/structures-v5.md`, md)
console.log(`\n${md}`)

// The report is written FIRST and then the run fails: it is what tells an operator whether the
// model or the threshold is wrong. `classDensityGate` is a class property, judged by artCoverage.
const stopped = [
  ...(refusedCells.length === 0
    ? []
    : [`${refusedCells.length} cell(s) shipped nothing: ${refusedCells.join(', ')}`]),
  ...cls.failures,
]
if (stopped.length > 0)
  throw new Error(
    `${stopped.join('\n  ')}\n  Raise STRUCT_ATTEMPTS to draw ` +
      `more, STRUCT_REJECTED to refuse a candidate by eye, or change a threshold on purpose. ` +
      `Nothing was committed for a refused cell.`,
  )
