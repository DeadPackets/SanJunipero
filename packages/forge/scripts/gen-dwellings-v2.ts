// LIVE — the four dwellings and the storehouse, in BOTH facings the user chose. Cap $DWELL_CAP.
// Reference is a MASTER_PALETTE swatch, never a building — a building overrides the prompt (A/B, $0.2053).
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
import {
  BUILDINGS_CONTENT_DIR,
  STRUCTURE_FACINGS,
  facingKind,
  type StructureFacing,
} from '../src/buildingArt.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
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
const DRY = process.env.DWELL_DRY === '1'
/** Forces every subject onto one reference mode, for the A/B that decided the default. */
const REF_OVERRIDE = process.env.DWELL_REF_MODE as 'anchor' | 'swatch' | undefined

const S = scratch('r4')
const RAWS = `${S}/raws`
const budget = new BudgetGuard(CAP)
const ledger = new SpendLedger(`${S}/spend.json`)
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'
const GEN_PX = 2048

// ── the two references ──────────────────────────────────────────────────────────────────────

const STYLE_ANCHOR = readFileSync('packages/forge/content/reference/style-anchor.png')

/** A code-painted MASTER_PALETTE chart: 40 flat swatches, no subject, no architecture. Free,
 *  deterministic, and the only reference the farmhouse call is allowed to see. */
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

// The palette, in words, for the calls that carry no building reference.
const PALETTE_WORDS = [
  'Colour it from a warm cozy pastel palette ONLY: cream stone (#FFF6E9 #F6E8D5 #E8D5BC',
  '#D4BC9E #B89D7E), honey wood (#F2C879 #E0A95E #C68A48 #A66E38 #7E512B), sage green',
  '(#DCE8C8 #B9D19A #93B573 #6F9455 #4F7040), dusty rose (#F2C6C2 #E09E9B #C47876 #9E5A5C),',
  'warm grey (#E9E2DA #CFC6BC #ABA198 #857D75 #5D5751) and near-black ink (#43394A #322B38).',
  'Flat blocks of these colours with hard pixel edges, no gradients, no anti-aliasing.',
].join(' ')

// Kept as a warning: naming the outline and the flatness in words came back MUTED and lower-
// contrast. The craft comes from the post chain, not from asking for it.

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

type RefMode = 'anchor' | 'swatch'
type Subject = {
  id: string
  kind: string
  fp: { w: number; h: number }
  ref: RefMode
  desc: string
}

const SUBJECTS: readonly Subject[] = [
  {
    id: 'house',
    kind: 'house',
    fp: { w: 2, h: 2 },
    ref: 'swatch',
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
    ref: 'swatch',
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
    ref: 'swatch',
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
    // ★ NO BUILDING REFERENCE. See the header.
    id: 'farmhouse',
    kind: 'farmhouse',
    fp: { w: 4, h: 2 },
    ref: 'swatch',
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
    ref: 'swatch',
    desc:
      'a communal STOREHOUSE — a barn, not a home. Walls of dark-stained vertical timber boarding ' +
      'over a low warm-grey concrete plinth, with a pair of WIDE DOUBLE BARN DOORS in honey ' +
      'wood filling most of the front wall, held by a plain sliding track. Its roof is a ' +
      'SYMMETRICAL GABLE of warm-grey corrugated metal with a small ventilation cowl at the ' +
      'ridge. NO domestic windows at all: one small square hatch high in the gable and nothing ' +
      'else. A stack of sacks and one wooden crate stand against the wall beside the doors',
  },
]

function prompt(s: Subject, facing: StructureFacing, mode: RefMode): string {
  const refClause =
    mode === 'anchor'
      ? 'Do NOT copy the reference image building — it is a STYLE reference ONLY, for palette, ' +
        'pixel density and rendering craft. Its architecture is deliberately NOT wanted. ' +
        'Style: match the pixel density, palette warmth and cute rounded style of the reference ' +
        'image exactly. '
      : 'The reference image is a COLOUR CHART, not a building. It carries the palette and nothing ' +
        'else. There is NO building to copy anywhere in this request — invent the architecture ' +
        `from the description alone. ${PALETTE_WORDS} `
  return (
    `${STYLE_PROMPT} A single free-standing building sprite. ` +
    `Subject: ${s.desc}. ` +
    `World footprint: ${s.fp.w}x${s.fp.h} tiles on a 32x16 pixel tile grid. ` +
    `${FACING_CLAUSE[facing]} ` +
    `${PERIOD} ` +
    refClause +
    'NO text, NO words, NO labels. NO people, NO animals. NO ground plane beyond the building ' +
    'itself, NO path, NO fence, NO trees, NO scenery — the ONLY content is the single building ' +
    'on the magenta background. ' +
    'The building fills about two thirds of the frame and MUST NOT touch any edge — leave a ' +
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

mkdirSync(RAWS, { recursive: true })
const swatch = await paletteSwatch()
writeFileSync(`${S}/palette-swatch.png`, swatch)

const rows: string[] = []
const members: { name: string; density: number }[] = []
const lines: string[] = []
// Cells this run refused to ship. Collected, not thrown on the spot: the unit of work is ONE
// CELL, and the report of every attempt is worth more than an early exit.
const refusedCells: string[] = []

for (const s of SUBJECTS) {
  if (ONLY.length && !ONLY.includes(s.id)) continue
  const cellPx = buildingCellPx(s.fp)
  const refMode = REF_OVERRIDE ?? s.ref
  for (const facing of FACINGS_ARG) {
    const label = facingKind(s.id, facing).replace(':', '-')
    console.log(`\n== ${label} (${s.fp.w}x${s.fp.h} -> ${cellPx}px, ref=${refMode}) ==`)
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
        const r = await generate(
          prompt(s, facing, refMode),
          refMode === 'anchor' ? STYLE_ANCHOR : swatch,
          label,
        )
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

    const dir = `${BUILDINGS_CONTENT_DIR}/${label}`
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
      `| ${label} | ${s.fp.w}x${s.fp.h} | ${cellPx} | ${refMode} | ${GEN_PX}/${win.plan.factor} ` +
        `(window ${win.plan.window}${win.plan.sourceScale === 1 ? '' : `, source x${win.plan.sourceScale.toFixed(3)}`}) ` +
        `| ${density} | clean | ${win.key} |`,
    )
  }
}

const cls = classDensityGate(members)
const md = [
  '# round 4 — four dwellings and a storehouse, in two facings',
  '',
  '| cell | footprint | px | ref | integer path | density | pixel bar | chosen |',
  '|---|---|---|---|---|---|---|---|',
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
writeFileSync(`${S}/reports/dwellings-v2.md`, md)
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
    `${stopped.join('\n  ')}\n  Raise DWELL_ATTEMPTS to draw ` +
      `more, DWELL_REJECTED to refuse a candidate by eye, or change a threshold on purpose. ` +
      `Nothing was committed for a refused cell.`,
  )
