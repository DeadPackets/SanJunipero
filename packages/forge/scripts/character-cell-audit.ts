// REPORT-ONLY, LIVE. The character audit at PER-CELL granularity — a whole 24-cell sheet fails
// `singleFigure` by construction. FOUNDERS= narrows the cast, CELLS= the poses; nothing is fixed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng } from '../src/post/raw.js'
import { openForgeDb } from '../src/db.js'
import { loadForgeConfig } from '../src/forgeConfig.js'
import { SpendLedger } from '../src/spendLedger.js'
import { makeVisionJudge, EST_COST_PER_VISION_CALL } from '../src/visionQa/visionJudge.js'
import { recordVerdict, passRates } from '../src/visionQa/telemetry.js'
import {
  CRITERIA,
  HARD_FAIL_CRITERIA,
  criterionOf,
  type Criterion,
  type VisionVerdict,
} from '../src/visionQa/verdict.js'
import { CELL_NAMES_V4 } from '../src/mirror.js'
import { FACINGS, POSES_V2 } from '../src/sheet.js'
import { paletteRgb } from '../src/palette.js'
import type { RawImage } from '../src/post/raw.js'
import { scratch } from './scratch.js'

const DRY = process.env.DRY === '1'
// REPORT=1 recomposes the tables from the verdicts already on disk: no key, no call, no spend.
const REPORT = process.env.REPORT === '1'
// A score in the 4-to-6.8 band is the instrument being stricter than the eye (batch-C
// concern 3, and 21 of the library's 100 density readings live there). A REAL defect is a
// hard fail or a criterion the judge scores at or under this.
const DEFECT_AT = 4
const C13 = scratch('c13')
const C5 = scratch('c5', 'production')
const FORGE = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(C13, 'audit')

const apiKey = process.env.OPENROUTER_API_KEY
if (!DRY && !REPORT && !apiKey) throw new Error('OPENROUTER_API_KEY not set')

// The same four the batch-A audit judged, so the rerun is comparable.
const FOUNDERS: readonly { id: string; desc: string }[] = [
  {
    id: 'amara',
    desc: 'a kind woman healer villager with grey-streaked hair under a soft water-blue headscarf, a cream apron dress with honey-gold trim, and a worn leather herb satchel strap',
  },
  {
    id: 'yusuf',
    desc: 'a sturdy older man villager with a short grey beard, a warm-grey flat cap and a honey-brown carpenter apron over a cream work shirt',
  },
  {
    id: 'nadia',
    desc: 'a young adult woman villager with a honey-brown braid, a straw sun hat with a brown band and a sage-green work dress',
  },
  {
    id: 'salma',
    desc: 'a stout middle-aged woman villager with dark hair in a round bun, a dusty-rose dress with pale sage trim and a white cooking apron',
  },
]

// Verbatim from the generator's own facing table (gen-cast-v4), mirrored for the two derived
// facings — the audit must ask for the facing the art was commissioned with, or it invents
// failures. `sleep` is lying down, so it is asked for the pose and not for a walk direction.
const FACING_OF: Record<string, string> = {
  se: 'front three-quarter view, facing bottom-right',
  sw: 'front three-quarter view, facing bottom-left',
  ne: 'back three-quarter view seen from behind, facing top-right, back of the head visible, NO face visible',
  nw: 'back three-quarter view seen from behind, facing top-left, back of the head visible, NO face visible',
}
const POSE_OF: Record<string, string> = {
  idle: 'standing still, both feet planted',
  'contact-a': 'mid-stride, the leading foot just planted',
  'contact-b': 'mid-stride, the other leading foot just planted',
  'passing-a': 'mid-stride, the legs passing each other under the body',
  'passing-b': 'mid-stride, the legs passing each other under the body',
  sleep: 'lying down on one side asleep, eyes closed',
}

type Unit = {
  id: string
  founder: string
  cell: string
  path: string
  commission: string
  expectedFacing: string
}
type Keyless = { offPalette: number; semiAlpha: number; opaque: number }

// `palette` and `transparency` do not need an eye: the master palette is a closed set and
// alpha is a number. Measuring them keylessly says which of the judge's readings are real.
const PALETTE_KEYS = new Set(paletteRgb().map(([r, g, b]) => (r << 16) | (g << 8) | b))
function keylessCheck(img: RawImage): Keyless {
  let offPalette = 0,
    semiAlpha = 0,
    opaque = 0
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3]!
    if (a === 0) continue
    opaque++
    if (a < 255) semiAlpha++
    if (!PALETTE_KEYS.has((img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!))
      offPalette++
  }
  return { offPalette, semiAlpha, opaque }
}

const ONLY_F = (process.env.FOUNDERS ?? FOUNDERS.map((f) => f.id).join(','))
  .split(',')
  .map((s) => s.trim())
const ONLY_C = (process.env.CELLS ?? CELL_NAMES_V4.join(',')).split(',').map((s) => s.trim())

function enumerate(): { units: Unit[]; missing: string[] } {
  const units: Unit[] = [],
    missing: string[] = []
  for (const f of FOUNDERS.filter((x) => ONLY_F.includes(x.id)))
    for (const cell of CELL_NAMES_V4.filter((c) => ONLY_C.includes(c))) {
      const path = join(C5, f.id, 'cells', `${cell}.png`)
      if (!existsSync(path)) {
        missing.push(`${f.id}/${cell}`)
        continue
      }
      const pose = POSES_V2.find((p) => cell.startsWith(`${p}-`))!
      const facing = FACINGS.find((x) => cell.endsWith(`-${x}`))!
      units.push({
        id: `cell:${f.id}:${cell}`,
        founder: f.id,
        cell,
        path,
        commission: `${f.desc} — one figure, ${POSE_OF[pose]}`,
        expectedFacing:
          pose === 'sleep'
            ? `lying down asleep with the head toward the ${facing === 'se' || facing === 'sw' ? 'camera side' : 'far side'}; a sleeping figure has no walk direction`
            : FACING_OF[facing]!,
      })
    }
  return { units, missing }
}

const { units, missing } = enumerate()
console.log(
  `character-cell-audit ${DRY ? 'DRY PLAN' : REPORT ? 'REPORT (offline)' : 'LIVE'} — ${units.length} cells, ` +
    `${units.length} calls, est $${(units.length * EST_COST_PER_VISION_CALL).toFixed(4)}`,
)
if (missing.length) {
  console.error(`missing cells: ${missing.join(', ')}`)
  process.exit(1)
}
if (DRY) {
  for (const u of units) console.log(`  ${u.id.padEnd(30)} ${u.expectedFacing.slice(0, 60)}`)
  console.log('DRY: no API calls made.')
  process.exit(0)
}

mkdirSync(join(OUT, 'cell-verdicts'), { recursive: true })
const config = loadForgeConfig()
const db = openForgeDb(join(OUT, 'character-cell-audit.db'))
const ledger = new SpendLedger(join(C13, 'spend.json'))
const verdictPath = (u: Unit): string =>
  join(OUT, 'cell-verdicts', `${u.id.replace(/:/g, '_')}.json`)

const results: { unit: Unit; verdict: VisionVerdict; costUsd: number; keyless: Keyless }[] = []
const keylessOf = new Map<string, Keyless>()
for (const u of units) keylessOf.set(u.id, keylessCheck(await decodePng(readFileSync(u.path))))
const kl = (u: Unit): Keyless => keylessOf.get(u.id)!

if (REPORT) {
  for (const u of units) {
    if (!existsSync(verdictPath(u))) {
      console.error(`no verdict on disk for ${u.id}`)
      process.exit(1)
    }
    results.push({
      unit: u,
      keyless: kl(u),
      costUsd: 0,
      verdict: JSON.parse(readFileSync(verdictPath(u), 'utf8')) as VisionVerdict,
    })
  }
  console.log(`REPORT: recomposed ${results.length} verdicts from disk, $0.0000`)
} else {
  const anchor = readFileSync(join(FORGE, 'content', 'reference', 'style-anchor.png'))
  const judge = makeVisionJudge({ apiKey: apiKey!, refs: [anchor], config })
  for (const u of units) {
    const sprite = await decodePng(readFileSync(u.path))
    const { verdict, costUsd } = await judge({
      assetId: u.id,
      klass: 'character',
      sprite,
      commission: u.commission,
      expectedFacing: u.expectedFacing,
      attempt: 1,
    })
    ledger.append({ assetId: u.id, kind: 'vision_qa', model: verdict.model, usd: costUsd })
    ledger.flush()
    recordVerdict(db, verdict, { assetClass: 'character-cell', attempt: 1, costUsd })
    writeFileSync(verdictPath(u), JSON.stringify(verdict, null, 2))
    results.push({ unit: u, verdict, costUsd, keyless: kl(u) })
    console.log(`  ${verdict.overall.padEnd(7)} ${u.id}`)
  }
}

// House law (batch-C ruling 3): a pass rate is read PER CRITERION over the population, never
// per item — the judge moves +-3 points on byte-identical images.
const asked = (v: VisionVerdict, c: Criterion): boolean => criterionOf(v, c) !== undefined
const holds = (v: VisionVerdict, c: Criterion): boolean => {
  const x = criterionOf(v, c)
  return (
    x !== undefined &&
    (x.evidence.startsWith('not applicable') || (x.pass && x.score >= config.visionQa.minScore))
  )
}
const verdicts = results.map((r) => r.verdict)
const perCriterion = CRITERIA.map((c) => {
  const vs = verdicts.filter(
    (v) => asked(v, c) && !criterionOf(v, c)!.evidence.startsWith('not applicable'),
  )
  return { c, n: vs.length, held: vs.filter((v) => holds(v, c)).length }
})
const held = verdicts.reduce((s, v) => s + CRITERIA.filter((c) => holds(v, c)).length, 0)
const total = verdicts.reduce((s, v) => s + CRITERIA.filter((c) => asked(v, c)).length, 0)

// `palette` and `transparency` are settled keylessly below, so a judge score on either is
// never what puts a cell in the queue — only the criteria an eye is actually the instrument for.
const EYE_ONLY: readonly Criterion[] = ['singleFigure', 'proportion', 'facing', 'alignment']
// The mirror standard builds all four sleep cells from ONE image and its horizontal flip, so
// there is no head direction to get wrong and the audit's facing ask was never answerable.
// Its `facing` readings on `sleep` are the instrument and are dropped from the queue.
const bad = (u: Unit, v: VisionVerdict): Criterion[] =>
  EYE_ONLY.filter((c) => {
    if (c === 'facing' && u.cell.startsWith('sleep-')) return false
    const x = criterionOf(v, c)
    return (
      x !== undefined &&
      !x.evidence.startsWith('not applicable') &&
      ((!x.pass && (HARD_FAIL_CRITERIA as readonly string[]).includes(c)) || x.score <= DEFECT_AT)
    )
  })
const keylessBad = (k: Keyless): boolean => k.offPalette > 0 || k.semiAlpha > 0
const defects = results.filter((r) => bad(r.unit, r.verdict).length > 0 || keylessBad(r.keyless))
const borderline = results.filter(
  (r) => !defects.includes(r) && CRITERIA.some((c) => asked(r.verdict, c) && !holds(r.verdict, c)),
)
const offPaletteCells = results.filter((r) => keylessBad(r.keyless))
const judgedPaletteBad = results.filter(
  (r) => (criterionOf(r.verdict, 'palette')?.score ?? 10) <= DEFECT_AT,
)
const judgedTranspBad = results.filter(
  (r) => (criterionOf(r.verdict, 'transparency')?.score ?? 10) <= DEFECT_AT,
)
const scores = (v: VisionVerdict): string =>
  CRITERIA.map((c) => criterionOf(v, c)?.score ?? '—').join(' ')

const md = [
  '# C13 — retrofit character audit, PER CELL',
  '',
  '**No asset was modified, regenerated or re-registered by this run.**',
  '',
  'The batch-A audit judged each founder as one whole 24-cell contact sheet, so `singleFigure`',
  'failed by construction and `character` scored 0.000 first-pass. That number measured the',
  'instrument, not the art. One cell is one figure; these are the same masters, asked properly.',
  '',
  `- Rubric v1, model \`${config.visionQa.model}\`, minScore ${config.visionQa.minScore}, attempt 1 only.`,
  `- Cells judged: ${results.length} (${ONLY_F.length} founders x ${CELL_NAMES_V4.length} cells).`,
  `- Audit spend, over every run of it: **$${units.reduce((s, u) => s + ledger.totalFor(u.id), 0).toFixed(4)}**.`,
  '',
  '## Per-criterion — the reading the house law is on',
  '',
  `Over ${verdicts.length} cell verdicts, **${held} of ${total} criteria hold ` +
    `(${total ? ((100 * held) / total).toFixed(1) : '—'}%)**. N/A criteria count as held.`,
  '',
  '| criterion | judged | holds | rate |',
  '|---|---|---|---|',
  ...perCriterion.map(
    (p) => `| ${p.c} | ${p.n} | ${p.held} | ${p.n ? ((100 * p.held) / p.n).toFixed(1) : '—'}% |`,
  ),
  '',
  '## Per-item pass rate, for comparison with the sheet-level number',
  '',
  '| scope | firstPass | withinRetries | blocked | n |',
  '|---|---|---|---|---|',
  (() => {
    const r = passRates(db, 'character-cell')
    return `| character-cell | ${r.firstPass.toFixed(3)} | ${r.withinRetries.toFixed(3)} | ${r.blocked.toFixed(3)} | ${r.n} |`
  })(),
  '',
  '## Per-founder',
  '',
  '| founder | cells | pass | criteria held |',
  '|---|---|---|---|',
  ...FOUNDERS.filter((f) => ONLY_F.includes(f.id)).map((f) => {
    const rs = results.filter((r) => r.unit.founder === f.id)
    const h = rs.reduce((s, r) => s + CRITERIA.filter((c) => holds(r.verdict, c)).length, 0)
    const t = rs.reduce((s, r) => s + CRITERIA.filter((c) => asked(r.verdict, c)).length, 0)
    return (
      `| ${f.id} | ${rs.length} | ${rs.filter((r) => r.verdict.overall === 'pass').length} | ` +
      `${h}/${t} (${t ? ((100 * h) / t).toFixed(1) : '—'}%) |`
    )
  }),
  '',
  '## The keyless half — palette and transparency need no eye',
  '',
  'The master palette is a closed set of 40 colours and alpha is a number, so both are counted',
  'rather than judged. Over every opaque pixel of all ' + results.length + ' cells:',
  '',
  `- **${offPaletteCells.length} of ${results.length} cells carry an off-palette or semi-opaque pixel.**`,
  `- Total off-palette pixels ${results.reduce((s, r) => s + r.keyless.offPalette, 0)}, ` +
    `semi-alpha ${results.reduce((s, r) => s + r.keyless.semiAlpha, 0)}, ` +
    `over ${results.reduce((s, r) => s + r.keyless.opaque, 0)} opaque pixels.`,
  `- The judge scored \`palette\` at or under ${DEFECT_AT} on **${judgedPaletteBad.length}** cells and ` +
    `\`transparency\` on **${judgedTranspBad.length}**. Where the count disagrees with the judge, the count wins.`,
  '',
  '## REAL defects — the C12 art-pool queue (not fixed here; characters are masters)',
  '',
  `A REAL defect is an off-palette or semi-opaque pixel (counted), or a hard fail or a score at ` +
    `or under ${DEFECT_AT} on a criterion an eye is the instrument for (${EYE_ONLY.join(', ')}). ` +
    `A score in the ${DEFECT_AT}-to-6.9 band is the instrument, not the art: **${borderline.length}** ` +
    'further cells sit only in that band and are NOT queued.',
  '',
  defects.length === 0
    ? '_empty_'
    : [
        `| cell | ${CRITERIA.join('/')} | off-palette / semi-alpha | failing | evidence |`,
        '|---|---|---|---|---|',
        ...defects.map((r) => {
          const bs = bad(r.unit, r.verdict)
          return (
            `| \`${r.unit.founder}/${r.unit.cell}\` | ${scores(r.verdict)} | ` +
            `${r.keyless.offPalette} / ${r.keyless.semiAlpha} | ${bs.join(', ') || '—'} | ` +
            `${
              bs
                .map((c) => criterionOf(r.verdict, c)!.evidence)
                .join(' ')
                .replace(/\|/g, '/')
                .slice(0, 220) || 'keyless count only'
            } |`
          )
        }),
      ].join('\n'),
  '',
  '## Every cell',
  '',
  `| cell | overall | ${CRITERIA.join('/')} |`,
  '|---|---|---|',
  ...results.map(
    (r) =>
      `| \`${r.unit.founder}/${r.unit.cell}\` | **${r.verdict.overall}** | ${scores(r.verdict)} |`,
  ),
  '',
].join('\n')

writeFileSync(join(OUT, 'character-cell-audit.md'), md)
console.log(
  `\nwrote ${join(OUT, 'character-cell-audit.md')} — ` +
    `criteria ${held}/${total}, ${defects.length} cell(s) with a real defect`,
)
