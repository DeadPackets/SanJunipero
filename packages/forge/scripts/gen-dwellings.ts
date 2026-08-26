// LIVE — the three dwellings of a CONTEMPORARY rural San Junipero, cap $DWELL_CAP ($2.00).
// cottage: one storey, gable. farmhouse: two storeys, hipped + dormer. cabin: one storey, mono-pitch.
// Generated at 2048 so the 512 cell is a whole-number divide; a 1024 generation's ceiling
// factor is 2 and the building draws a tenth small.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { BudgetGuard } from '../src/budget.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { opaqueBbox } from '../src/sheet.js'
import { cellAnchor } from '../src/hires.js'
import { buildingCellPx, reCell } from '../src/reCell.js'
import {
  alphaBinaryGate, classDensityGate, integerScaleGate, nativeDensityGate, paletteGate,
  spriteDensity,
} from '../src/pixelGates.js'
import { TOWN_TILE } from '../src/assetResolution.js'
import { refusalMessage } from '../src/gate.js'
import { SJ_SCRATCH } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.DWELL_CAP ?? '2.00')
const MAX_ATTEMPTS = Number(process.env.DWELL_ATTEMPTS ?? '3')
// The eye is the gate the gates cannot be. A candidate named here is one a human looked at
// and refused, so it is never chosen however clean its numbers are.
const REJECTED = new Set((process.env.DWELL_REJECTED ?? '').split(',').map(s => s.trim()).filter(Boolean))
const ONLY = (process.env.DWELL_ONLY ?? '').split(',').map(s => s.trim()).filter(Boolean)
const budget = new BudgetGuard(CAP)
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'
const GEN_PX = 2048

const S = SJ_SCRATCH
const OUT = `${S}/r3/dwellings`
const ART = `${S}/fqc2/art-root/production`
// The anchor carries the palette AND the architecture the user rejected, and on `farmhouse` the
// architecture won against a prompt that banned it by name. DWELL_REF swaps in an approved
// building of this round instead.
const STYLE_ANCHOR = readFileSync(process.env.DWELL_REF ?? 'packages/forge/content/reference/style-anchor.png')

// The anchor cottage is the craft reference and ALSO the architecture the user rejected —
// arched plank door, half-timbering, tiny leaded window. Naming the period positively and in
// detail is the only thing standing between the anchor and three more old buildings.
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

type Dwelling = { id: string; kind: string; fp: { w: number; h: number }; desc: string }
const DWELLINGS: readonly Dwelling[] = [
  {
    id: 'cottage', kind: 'cottage', fp: { w: 2, h: 2 },
    desc:
      'a small SINGLE-STOREY country cottage, low and wide, with smooth cream rendered walls ' +
      'over a low warm-grey stone base course. Its roof is a STEEP SYMMETRICAL GABLE of ' +
      'dusty-rose clay pantiles that comes down low on both sides and takes up more than half ' +
      'the height of the building, with a squat brick chimney at one gable end. Two wide ' +
      'white-framed windows with clear glass, glazing bars and painted sills, and one plain ' +
      'painted plank front door with a small flat canopy over the step and a pot of sage-green ' +
      'plants beside it',
  },
  {
    id: 'farmhouse', kind: 'farmhouse', fp: { w: 2, h: 2 },
    desc:
      'a TWO-STOREY farmhouse, clearly the tallest building in the village, twice the height of ' +
      'a single-storey cottage. Walls of PLAIN PAINTED HORIZONTAL WEATHERBOARD in soft cream, ' +
      'perfectly smooth and unbroken, every board running the same way. Its roof is a SHALLOW ' +
      'HIPPED roof of warm-grey slate: all four sides slope inward and upward to a short flat ' +
      'ridge at the top, so the front of the house is a plain rectangle with NO triangular ' +
      'gable, NO pointed end, NO peak. ONE small dormer window sits in the front slope and one ' +
      'plain brick chimney at the ridge. Four rectangular white-framed windows in two rows. ' +
      'Along the whole front runs a COVERED OPEN PORCH with slim square posts, a plain rail and ' +
      'its own separate low lean-to porch roof standing out in front of the wall',
  },
  {
    id: 'cabin', kind: 'cabin', fp: { w: 2, h: 2 },
    desc:
      'a small modest SINGLE-STOREY timber cabin, the smallest, lowest and plainest dwelling, ' +
      'sitting low on short grey concrete blocks. Walls of FLAT PAINTED SAGE-GREEN TIMBER ' +
      'BOARDS laid horizontally — flat sawn planks, NOT round logs, NOT log-cabin construction, ' +
      'no notched corners. Its roof is ONE SINGLE FLAT SLOPING PLANE of sage-grey corrugated ' +
      'metal, a lean-to shed roof tilted in ONE DIRECTION ONLY: high along the back wall and ' +
      'low along the front wall, overhanging it. There is NO ridge line, NO peak, NO gable, NO ' +
      'triangle, NO second slope anywhere — exactly one flat rectangle of roof. One wide ' +
      'white-framed window, one plain plank door with a single step, and a short black metal ' +
      'flue pipe through the roof',
  },
]

function prompt(d: Dwelling): string {
  return `${STYLE_PROMPT} A single free-standing building sprite. ` +
    `Subject: ${d.desc}. ` +
    `World footprint: ${d.fp.w}x${d.fp.h} tiles on a 32x16 pixel tile grid. ` +
    'The door and entrance are on the lower-left (south-west) visible wall. ' +
    `${PERIOD} ` +
    'Do NOT copy the reference image building — it is a STYLE reference ONLY, for palette, ' +
    'pixel density and rendering craft. Its architecture is deliberately NOT wanted. ' +
    'NO text, NO words, NO labels. NO people, NO animals. NO ground plane beyond the building ' +
    'itself, NO path, NO fence, NO trees, NO scenery — the ONLY content is the single building ' +
    'on the magenta background. ' +
    'The building fills about two thirds of the frame and MUST NOT touch any edge — leave a ' +
    'wide clear magenta margin on all four sides. ' +
    'Style: match the pixel density, palette warmth and cute rounded style of the reference image exactly.'
}

function keyBg(img: RawImage): RawImage {
  for (const tolerance of [72, 110]) {
    const keyed = chromaKey(img, { tolerance })
    let clear = 0
    for (let i = 3; i < keyed.data.length; i += 4) if (keyed.data[i] === 0) clear++
    if (clear / (keyed.width * keyed.height) >= 0.10) return keyed
  }
  throw new Error('keyBg: <10% keyed even at tolerance 110')
}

async function generate(p: string, reserve: number) {
  if (budget.total + reserve > CAP) throw new Error(`reserve exceeds cap ($${budget.total.toFixed(3)} of $${CAP})`)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, prompt: p, size: `${GEN_PX}x${GEN_PX}`, response_format: 'b64_json',
      input_references: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${STYLE_ANCHOR.toString('base64')}` } }],
      usage: { include: true },
    }),
  })
  if (!res.ok) throw new Error(`${MODEL} HTTP ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const b64 = (json.data ?? []).filter(d => d.b64_json).at(-1)?.b64_json
  if (!b64) throw new Error(`${MODEL}: no b64_json`)
  return { raw: Buffer.from(b64, 'base64'), cost: json.usage?.cost ?? reserve }
}

const rows: string[] = []
const members: { name: string; density: number }[] = []
const lines: string[] = []
// ★ Dwellings this run refused to ship. Collected, not thrown on the spot: the unit of work is
// ONE CELL and the report of every attempt is worth more than an early exit.
const refusedCells: string[] = []
const spend: Record<string, number> = {}

for (const d of DWELLINGS) {
  if (ONLY.length && !ONLY.includes(d.id)) continue
  const DIR = `${OUT}/${d.id}`
  mkdirSync(`${DIR}/raws`, { recursive: true })
  console.log(`\n== ${d.id} (${d.fp.w}x${d.fp.h}) ==`)
  const cellPx = buildingCellPx(d.fp)
  type Cand = { key: string; cell: RawImage; plan: ReturnType<typeof reCell>['plan']; fails: string[]; subject: number }
  const cands: Cand[] = []

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const key = `${d.id}-c${i}`
    const path = `${DIR}/raws/${key}.png`
    let buf: Buffer
    if (existsSync(path)) { buf = readFileSync(path); console.log(`  ${key}: cached`) } else {
      const r = await generate(prompt(d), 0.15)
      writeFileSync(path, r.raw); budget.spend(r.cost); buf = r.raw
      spend[d.id] = (spend[d.id] ?? 0) + r.cost
      console.log(`  ${key}: generated $${r.cost.toFixed(4)} (total $${budget.total.toFixed(4)})`)
    }
    try {
      const keyed = keyBg(await decodePng(buf))
      const bb = opaqueBbox(keyed)!
      const subject = Math.max(bb.x1 - bb.x0 + 1, bb.y1 - bb.y0 + 1)
      const r = reCell(keyed, { cellPx, fill: true, anchor: 'feet' })
      const fails = [
        ...integerScaleGate({ w: r.plan.window, h: r.plan.window }, { w: cellPx, h: cellPx }).failures,
        ...alphaBinaryGate(r.cell).failures,
        ...paletteGate(r.cell).failures,
        ...nativeDensityGate({ name: d.id, canvas: { w: cellPx, h: cellPx }, footprint: d.fp, tile: TOWN_TILE }).failures,
      ]
      const refused = REJECTED.has(key)
      if (!refused) cands.push({ key, cell: r.cell, plan: r.plan, fails, subject })
      const msg = `${key}: subject ${subject}px, factor ${r.plan.factor}, window ${r.plan.window}, source x${r.plan.sourceScale.toFixed(3)}, ${fails.length === 0 ? 'gates clean' : fails.join('; ')}${refused ? ' — REFUSED BY EYE' : ''}`
      lines.push(msg); console.log(`  ${msg}`)
      if (fails.length === 0 && !refused) break
    } catch (e) {
      const msg = `${key}: process FAILED — ${String(e).slice(0, 180)}`
      lines.push(msg); console.log(`  ${msg}`)
    }
  }

  // ★ AMONG THE CLEAN ONES ONLY (user ruling; the shape and the reason are in src/gate.ts).
  // `(clean.length ? clean : cands)` fell back to the DIRTY set and shipped the least-corrected
  // failure. Choosing is not deciding.
  const clean = cands.filter(c => c.fails.length === 0)
  const win = clean
    .sort((a, b) => Math.abs(1 - b.plan.sourceScale) - Math.abs(1 - a.plan.sourceScale)).at(-1)
  if (!win) {
    const why = refusalMessage(d.id, cands.map(c => ({ key: c.key, failures: c.fails })))
      || `${d.id}: NO CANDIDATE — every attempt failed to process`
    lines.push(why); console.log(`  ${why}`); refusedCells.push(d.id); continue
  }

  const dest = `${ART}/building-${d.id}`
  mkdirSync(`${dest}/raws`, { recursive: true })
  writeFileSync(`${dest}/cell.png`, await encodePng(win.cell))
  writeFileSync(`${dest}/manifest.json`, JSON.stringify({
    version: 'v4-hires-building', kind: d.kind, footprint: d.fp, cell: cellAnchor(win.cell),
  }, null, 2))
  // KEEP THE RAWS beside the output
  for (const c of cands) {
    const src = `${DIR}/raws/${c.key}.png`
    if (existsSync(src)) writeFileSync(`${dest}/raws/${c.key}.png`, readFileSync(src))
  }
  writeFileSync(`${dest}/report.txt`, [...lines.filter(l => l.startsWith(d.id)), `chosen: ${win.key}`].join('\n'))
  writeFileSync(`${dest}/spend.json`, JSON.stringify({ asset: `building-${d.id}`, spendUsd: spend[d.id] ?? 0 }, null, 2))

  const density = spriteDensity({ canvas: { w: cellPx, h: cellPx }, footprint: d.fp, tile: TOWN_TILE })
  members.push({ name: d.id, density })
  rows.push(`| ${d.id} | ${d.fp.w}x${d.fp.h} | ${cellPx}x${cellPx} | ${GEN_PX}/${win.plan.factor} (window ${win.plan.window}`
    + `${win.plan.sourceScale === 1 ? '' : `, source x${win.plan.sourceScale.toFixed(3)}`}) | ${density} `
    + `| clean | ${win.key} |`)
}

const cls = classDensityGate(members)
const md = ['# the three dwellings of a contemporary San Junipero', '',
  '| dwelling | footprint | cell | integer path | density | pixel bar | chosen |',
  '|---|---|---|---|---|---|---|', ...rows, '',
  `class density: ${cls.densities.join(', ')} — ${cls.ok ? 'ONE density across the class' : cls.failures.join('; ')}`,
  '', `spend: ${Object.entries(spend).map(([k, v]) => `${k} $${v.toFixed(4)}`).join(', ')} — total $${budget.total.toFixed(4)} of $${CAP}`,
].join('\n')
mkdirSync(`${S}/r3/reports`, { recursive: true })
writeFileSync(`${S}/r3/reports/dwellings.md`, md)
console.log(`\n${md}`)

// ★ THE VERDICTS ARE BINDING, AFTER THE REPORT IS ON DISK. `classDensityGate` only ever went
// into that markdown.
const stopped = [
  ...(refusedCells.length === 0 ? [] : [`${refusedCells.length} dwelling(s) shipped nothing: ${refusedCells.join(', ')}`]),
  ...cls.failures,
]
if (stopped.length > 0) throw new Error(`${stopped.join('\n  ')}\n  Raise DWELL_ATTEMPTS to draw `
  + `more, DWELL_REJECTED to refuse a candidate by eye, or change a threshold on purpose. `
  + `Nothing was written for a refused dwelling.`)
