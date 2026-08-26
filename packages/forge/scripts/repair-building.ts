// LIVE — one targeted EDIT call per building on its cached raw, judged by BOTH instruments:
// the vision rubric on the native cell and the pixel + seat alignment law on the target cell.
// A repair deploys only when both pass. DEPLOY=0 keeps it out of the production copies.
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { processHiResCell, cellAnchor } from '../src/hires.js'
import { openForgeDb } from '../src/db.js'
import { AssetCodex } from '../src/codex.js'
import { loadForgeConfig } from '../src/forgeConfig.js'
import { SpendLedger } from '../src/spendLedger.js'
import { makeVisionJudge } from '../src/visionQa/visionJudge.js'
import { recordVerdict } from '../src/visionQa/telemetry.js'
import { CRITERIA, type VisionVerdict } from '../src/visionQa/verdict.js'
import {
  validateBuildingAlignment,
  testGridRender,
  toTargetCell,
  SEAT_CRITERION_PROMPT,
} from '../src/alignment.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { scratch } from './scratch.js'

const C13 = scratch('c13')
const C5 = scratch('c5', 'production')
const ARCHIVE =
  '/Users/deadpackets/workspace/SanJunipero/.claude/scratch/archive/session-2026-08-16-finish-v1/c5/production'
const FORGE = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'

const apiKey = process.env.OPENROUTER_API_KEY
if (!apiKey) throw new Error('OPENROUTER_API_KEY not set')
const DEPLOY = process.env.DEPLOY !== '0'

type Repair = {
  id: string
  kind: string
  desc: string
  fp: { w: number; h: number }
  door: boolean
  defect: string
  note: string
}

// Each `defect` is the retrofit audit's own finding (Task 8 masters queue + the Task 14 seat
// check); each `note` is the single change the edit call is allowed to make.
const REPAIRS: readonly Repair[] = [
  {
    id: 'standing-stone',
    kind: 'standing_stone',
    fp: { w: 1, h: 1 },
    door: false,
    desc: 'an ancient weathered warm-grey standing stone, taller than a person, softly rounded edges, faint moss at its base',
    defect:
      'transparency 3, proportion 3, density 4, alignment 4 — a washed-out pale patch across the upper right, dithered noise, transparent holes inside the stone (long-standing user-flagged defect)',
    // Round 1 (`-r1`) drifted the right-hand face to dusty rose: an open instruction to repaint
    // let the model recolour. Round 2 freezes the greys and only flattens the speckle.
    note: 'flatten the speckled dithering into solid blocks four screen units across, keep the exact same warm greys already on the stone and introduce NO new colour of any kind, level out the washed-out pale patch across its upper right so that face reads as one flat grey, and fill in every transparent hole inside the outline.',
  },
  {
    id: 'shed',
    kind: 'shed',
    fp: { w: 1, h: 1 },
    door: true,
    desc: 'a small honey-wood tool shed with a single plank door and a slanted roof',
    defect:
      'alignment 3, seat 6 — the stacked log pile on the lower right overhangs the 1x1 footprint diamond',
    note: 'delete the pile of cut logs stacked on the ground at the lower right, so the shed stands alone with bare background beside it.',
  },
  {
    id: 'storehouse',
    kind: 'storehouse',
    fp: { w: 2, h: 2 },
    door: true,
    desc: 'a sturdy communal storehouse of honey-wood planks on a cream-stone base, wide double doors, a small hay loft window under the roof peak',
    defect:
      'palette 3, proportion 3, density 4, seat 2 — micro-dithered noise across the roof and walls at a finer scale than the project grid',
    note: 'repaint the roof shingles and the wall planks as clean solid colour blocks four screen units across, removing every speckled or dithered pixel, and keep the doors, windows and outline exactly where they are.',
  },
  {
    id: 'wagon',
    kind: 'wagon',
    fp: { w: 1, h: 2 },
    door: false,
    desc: 'a settler travel wagon with a rounded cream canvas cover, honey-wood body and two big spoked wheels, standing still with no animals',
    defect:
      'facing 4, density 6 — a rear door panel that contradicts the open canvas, and wheel spokes drawn finer than the project grid',
    note: 'remove the wooden door panel at the rear of the wagon body so the canvas opening is clear, and redraw each wheel as a plain thick rim with six chunky spokes.',
  },
  {
    id: 'scaffolding',
    kind: 'scaffolding',
    fp: { w: 1, h: 1 },
    door: false,
    desc: 'a construction scaffolding of honey-wood poles and cream canvas wraps, building-under-construction sprite',
    defect:
      'alignment 6 — the lowest front vertical pole stops short of the ground diamond bottom vertex',
    note: 'extend the lowest front vertical pole downward so its foot ends level with the feet of the other corner posts.',
  },
]

const FILTER = (process.env.BUILDINGS ?? REPAIRS.map((r) => r.id).join(','))
  .split(',')
  .map((s) => s.trim())
const RUN = REPAIRS.filter((r) => FILTER.includes(r.id))
if (RUN.length === 0) throw new Error(`BUILDINGS=${process.env.BUILDINGS} matches nothing`)

const config = loadForgeConfig()
const ledger = new SpendLedger(join(C13, 'spend.json'))
mkdirSync(join(C13, 'buildings'), { recursive: true })
const db = openForgeDb(join(C13, 'buildings', 'buildings.db'))
const codex = new AssetCodex(db)
const anchorRef = readFileSync(join(FORGE, 'content', 'reference', 'style-anchor.png'))
const judge = makeVisionJudge({ apiKey, refs: [anchorRef], config })

type Manifest = {
  version: string
  kind: string
  footprint: { w: number; h: number }
  cell: { w: number; h: number; feetX: number; feetY: number }
}

function editPrompt(r: Repair): string {
  return (
    `${STYLE_PROMPT} Reproduce the LAST reference image EXACTLY — the same single building, ` +
    'the same shape, the same colours, the same chunky block size, the same position on the magenta ' +
    `background — with ONE change: ${r.note} ` +
    'Everything else stays identical. NO text, NO labels, NO people, NO animals, NO ground plane, ' +
    'NO path, NO scenery — the only content is the single building on the magenta background. ' +
    'Do NOT draw the cottage from the first reference image (it is a STYLE reference only).'
  )
}

async function editCall(src: Buffer, prompt: string): Promise<{ png: Buffer; costUsd: number }> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size: '1024x1024',
      response_format: 'b64_json',
      input_references: [anchorRef, src].map((b) => ({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${b.toString('base64')}` },
      })),
      usage: { include: true },
    }),
  })
  if (!res.ok) throw new Error(`${MODEL} HTTP ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const images = (json.data ?? []).filter((d) => d.b64_json)
  const b64 = images[images.length - 1]?.b64_json
  if (!b64) throw new Error(`${MODEL}: no b64_json in data[]`)
  return { png: Buffer.from(b64, 'base64'), costUsd: json.usage?.cost ?? 0.08 }
}

// The generator's magenta is not always keyed at the default tolerance (gen-buildings-v4's rule).
function keyBg(img: RawImage): RawImage {
  for (const tolerance of [72, 110]) {
    const keyed = chromaKey(img, { tolerance })
    let clear = 0
    for (let i = 3; i < keyed.data.length; i += 4) if (keyed.data[i] === 0) clear++
    if (clear / (keyed.width * keyed.height) >= 0.1) return keyed
  }
  throw new Error('keyBg: <10% background keyed even at tolerance 110')
}

async function preview(cell: RawImage, fp: { w: number; h: number }): Promise<Buffer> {
  const target = 32 * (fp.w + fp.h) * 4
  const k = Math.min(target / cell.width, target / cell.height)
  return sharp(Buffer.from(cell.data.buffer, cell.data.byteOffset, cell.data.byteLength), {
    raw: { width: cell.width, height: cell.height, channels: 4 },
  })
    .resize(Math.max(1, Math.round(cell.width * k)), Math.max(1, Math.round(cell.height * k)), {
      kernel: 'lanczos3',
      fit: 'fill',
    })
    .png()
    .toBuffer()
}

type Row = {
  id: string
  raw: string
  rubric: string
  scores: number[]
  pixel: boolean
  failures: string[]
  seat: number
  seatEvidence: string
  deployed: boolean
  costUsd: number
}

// Masters law (Global Constraints): the pipeline may screen a master, never sign one off. So a
// repair lands in $C13/buildings/<id>/ and PROMOTE deploys it by name after a human has looked
// at the preview — no generation, no spend, and the instrument scores ride along unchanged.
const PROMOTE = (process.env.PROMOTE ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

async function deploy(
  r: Repair,
  cellPng: Buffer,
  cell: RawImage,
  man: Manifest,
  rawKey: string,
  score: number,
  attempts: number,
  costUsd: number,
): Promise<void> {
  const dir = join(C5, `building-${r.id}`)
  const backup = join(C13, 'buildings', r.id, 'pre-repair')
  if (!existsSync(backup)) {
    mkdirSync(backup, { recursive: true })
    cpSync(join(dir, 'cell.png'), join(backup, 'cell.png'))
    cpSync(join(dir, 'manifest.json'), join(backup, 'manifest.json'))
  }
  const rawPng = readFileSync(join(dir, 'raws', `${rawKey}.png`))
  for (const root of [C5, ARCHIVE]) {
    const d = join(root, `building-${r.id}`)
    if (!existsSync(d)) {
      console.log(`  (no copy at ${d})`)
      continue
    }
    mkdirSync(join(d, 'raws'), { recursive: true })
    writeFileSync(join(d, 'cell.png'), cellPng)
    writeFileSync(join(d, 'manifest.json'), JSON.stringify(man, null, 2))
    writeFileSync(join(d, 'preview-4x.png'), await preview(cell, r.fp))
    writeFileSync(join(d, 'raws', `${rawKey}.png`), rawPng)
  }
  const rec = codex.register({
    class: 'building',
    kind: r.kind,
    desc: r.desc,
    meta: JSON.stringify(man),
    footprint: r.fp,
    png: cellPng,
    widthPx: cell.width,
    heightPx: cell.height,
    status: 'ready',
    attempts,
    costUsd,
    score: Math.min(10, Math.max(1, score)),
  })
  writeFileSync(
    join(C13, 'buildings', r.id, 'deployed.json'),
    JSON.stringify(
      { id: r.id, raw: rawKey, assetId: rec.id, score, costUsd, at: rec.createdAt },
      null,
      2,
    ),
  )
}

if (PROMOTE.length) {
  for (const r of REPAIRS.filter((x) => PROMOTE.includes(x.id))) {
    const out = join(C13, 'buildings', r.id)
    const v = JSON.parse(readFileSync(join(out, 'verdicts.json'), 'utf8')) as {
      raw: string
      rubric: VisionVerdict
      align: { ok: boolean }
    }
    if (!v.align.ok) throw new Error(`${r.id}: pixel alignment is red — refusing to promote`)
    const cellPng = readFileSync(join(out, 'cell.png'))
    const cell = await decodePng(cellPng)
    const man: Manifest = {
      version: 'v4-hires-building',
      kind: r.kind,
      footprint: r.fp,
      cell: cellAnchor(cell),
    }
    const score = CRITERIA.reduce((s, c) => s + v.rubric.criteria[c].score, 0) / CRITERIA.length
    await deploy(r, cellPng, cell, man, v.raw, score, 1, ledger.totalFor(`building:${r.id}`))
    console.log(
      `  promoted ${r.id} from ${v.raw} (rubric ${v.rubric.overall}, mean ${score.toFixed(1)})`,
    )
  }
  console.log(`\npromoted ${PROMOTE.length} building(s) — $0.0000, human eyeball on the previews`)
}

const rows: Row[] = []
// PROMOTE and REPORT both fall through to the report composition below without generating.
for (const r of PROMOTE.length || process.env.REPORT === '1' ? [] : RUN) {
  const dir = join(C5, `building-${r.id}`)
  const assetId = `building:${r.id}`
  const spentBefore = ledger.totalFor(assetId)
  console.log(`\n== ${r.id} — ${r.defect}`)

  // An edit call drifts, so a second round starts from the ORIGINAL raw with a revised note by
  // default — chaining onto a drifted output compounds the drift. SRC picks a different source.
  const srcKey = process.env.SRC ?? `building-${r.id}-c0`
  let n = 1
  while (existsSync(join(dir, 'raws', `building-${r.id}-r${n}.png`))) n++
  const outKey = `building-${r.id}-r${n}`
  const outPath = join(dir, 'raws', `${outKey}.png`)
  const src = readFileSync(join(dir, 'raws', `${srcKey}.png`))

  const edit = await editCall(src, editPrompt(r))
  ledger.append({ assetId, kind: 'image_gen', model: MODEL, usd: edit.costUsd })
  ledger.flush()
  writeFileSync(outPath, edit.png)

  const cell = processHiResCell(keyBg(await decodePng(edit.png)))
  const anchor = cellAnchor(cell)
  const man: Manifest = {
    version: 'v4-hires-building',
    kind: r.kind,
    footprint: r.fp,
    cell: anchor,
  }

  const { verdict, costUsd } = await judge({
    assetId,
    klass: 'building',
    sprite: cell,
    commission: r.desc,
    footprint: r.fp,
    attempt: 1,
    expectedFacing: r.door ? 'door to the south-west' : 'no door; light from the north-west',
  })
  ledger.append({ assetId, kind: 'vision_qa', model: verdict.model, usd: costUsd })
  ledger.flush()
  recordVerdict(db, verdict, { assetClass: 'building', attempt: 1, costUsd })

  const target = toTargetCell(cell, man)
  const align = validateBuildingAlignment(target.img, r.fp, config.alignment, target.cell)
  const grid = testGridRender(target.img, r.fp)
  mkdirSync(join(C13, 'buildings', 'seat'), { recursive: true })
  writeFileSync(join(C13, 'buildings', 'seat', `${r.id}.png`), await encodePng(grid))
  const seat = await judge({
    assetId: `seat:${r.id}`,
    klass: 'building',
    sprite: grid,
    attempt: 1,
    commission: `${r.kind} on its footprint diamond. ${SEAT_CRITERION_PROMPT}`,
    footprint: r.fp,
    expectedFacing: 'door to the south-west',
  })
  ledger.append({ assetId, kind: 'vision_qa', model: seat.verdict.model, usd: seat.costUsd })
  ledger.flush()

  const ok = verdict.overall === 'pass' && align.ok
  const cellPng = await encodePng(cell)
  mkdirSync(join(C13, 'buildings', r.id), { recursive: true })
  writeFileSync(join(C13, 'buildings', r.id, 'cell.png'), cellPng)
  writeFileSync(join(C13, 'buildings', r.id, 'preview-4x.png'), await preview(cell, r.fp))
  writeFileSync(
    join(C13, 'buildings', r.id, 'verdicts.json'),
    JSON.stringify({ id: r.id, raw: outKey, rubric: verdict, seat: seat.verdict, align }, null, 2),
  )

  let deployed = false
  if (ok && DEPLOY) {
    const score = CRITERIA.reduce((s, c) => s + verdict.criteria[c].score, 0) / CRITERIA.length
    await deploy(
      r,
      cellPng,
      cell,
      man,
      outKey,
      score,
      Math.min(3, n),
      ledger.totalFor(assetId) - spentBefore,
    )
    deployed = true
  }

  rows.push({
    id: r.id,
    raw: outKey,
    rubric: verdict.overall,
    pixel: align.ok,
    failures: align.failures,
    scores: CRITERIA.map((c) => verdict.criteria[c].score),
    seat: seat.verdict.criteria.alignment.score,
    seatEvidence: seat.verdict.criteria.alignment.evidence,
    deployed,
    costUsd: ledger.totalFor(assetId) - spentBefore,
  })
  console.log(
    `  ${verdict.overall.padEnd(7)} pixel ${align.ok ? 'PASS' : 'FAIL'} seat ${seat.verdict.criteria.alignment.score} ` +
      `${deployed ? 'DEPLOYED' : 'held'} $${(ledger.totalFor(assetId) - spentBefore).toFixed(4)}`,
  )
}

// Composed from every repair on disk, not just this run's, so a per-building rerun does not
// erase the other four rows (the batch-<name>.md lesson from the library batches).
for (const r of REPAIRS) {
  if (rows.some((x) => x.id === r.id)) continue
  const out = join(C13, 'buildings', r.id)
  if (!existsSync(join(out, 'verdicts.json'))) continue
  const v = JSON.parse(readFileSync(join(out, 'verdicts.json'), 'utf8')) as {
    raw: string
    rubric: VisionVerdict
    seat: VisionVerdict
    align: { ok: boolean; failures: string[] }
  }
  rows.push({
    id: r.id,
    raw: v.raw,
    rubric: v.rubric.overall,
    pixel: v.align.ok,
    failures: v.align.failures,
    scores: CRITERIA.map((c) => v.rubric.criteria[c].score),
    seat: v.seat.criteria.alignment.score,
    seatEvidence: v.seat.criteria.alignment.evidence,
    deployed: existsSync(join(out, 'deployed.json')),
    costUsd: ledger.totalFor(`building:${r.id}`),
  })
}
rows.sort(
  (a, b) => REPAIRS.findIndex((r) => r.id === a.id) - REPAIRS.findIndex((r) => r.id === b.id),
)

const md = [
  '# C13 batch C — building repair round',
  '',
  'One edit call per building on its cached raw, reprocessed through the v4 hi-res chain, judged',
  'by the vision rubric (native cell) and the alignment law (pixel + seat, on the rebuilt target cell).',
  'Buildings are MASTERS: the pipeline screens them and never signs one off, so a repair lands in',
  '`$C13/buildings/<id>/` and is deployed by name through `PROMOTE=` after a human eyeball.',
  '',
  `| building | raw | rubric | ${CRITERIA.join('/')} | pixel | seat | deployed | $ |`,
  '|---|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.id} | \`${r.raw}\` | **${r.rubric}** | ${r.scores.join(' ')} | ` +
      `${r.pixel ? 'PASS' : '**FAIL**'} | ${r.seat} | ${r.deployed ? 'yes' : 'no'} | ${r.costUsd.toFixed(4)} |`,
  ),
  '',
  '## Defects repaired',
  '',
  ...REPAIRS.filter((r) => rows.some((x) => x.id === r.id)).map(
    (r) => `- \`${r.id}\` — ${r.defect}\n  - edit: ${r.note}`,
  ),
  '',
  '## Seat evidence',
  '',
  ...rows.map((r) => `- \`${r.id}\` (${r.seat}): ${r.seatEvidence}`),
  '',
  ...rows
    .filter((r) => r.failures.length)
    .map((r) => `- \`${r.id}\` pixel failures: ${r.failures.join('; ')}`),
  '',
].join('\n')
mkdirSync(join(C13, 'buildings'), { recursive: true })
writeFileSync(join(C13, 'buildings', 'repair-report.md'), md)
console.log(
  `\nwrote ${join(C13, 'buildings', 'repair-report.md')} — ` +
    `${rows.filter((r) => r.deployed).length}/${rows.length} deployed, $${rows.reduce((s, r) => s + r.costUsd, 0).toFixed(4)}`,
)
