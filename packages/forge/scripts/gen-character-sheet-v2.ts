// LIVE — cap $C5_V2_CAP (default $1.50). Character sheet v2 with the human-locked recipe:
// gemini only, big-pixel prompt, chromaKey -> snapToGrid -> anchorToCanvas(96,96,88)
// (native-resolution art: NO quantize, NO outline pass). Sheet 384x288.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { BudgetGuard, BudgetExceededError } from '../src/budget.js'
import { makeVlmJudge, type JudgeFn } from '../src/judge.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import {
  FACINGS,
  POSES,
  FACING_CLAUSES,
  POSE_CLAUSES,
  assembleGrid,
  mirrorX,
  duplicateReport,
  postProcessCell,
  upscaleNearest,
  distanceMatrix,
  pairwiseMedian,
  type Facing,
  type Pose,
} from '../src/sheet.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.C5_V2_CAP ?? '1.5')
const budget = new BudgetGuard(CAP)
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'
const RESERVE = 0.046

const REF_CANDIDATES =
  '/Users/deadpackets/workspace/SanJunipero/.claude/scratch/c5/reference-candidates'
// Canonical style anchor law: style-anchor.png is the FIRST input_reference and FIRST judge ref.
const STYLE_ANCHOR = readFileSync('packages/forge/content/reference/style-anchor.png')
const ANCHOR = readFileSync('packages/forge/content/reference/identity-anchor-v2.png')
const judge: JudgeFn = makeVlmJudge({
  apiKey: KEY,
  refSheets: [STYLE_ANCHOR, readFileSync(`${REF_CANDIDATES}/item-1.png`), ANCHOR],
})

const OUT = 'packages/forge/out/character-sheet-v2'
const DURABLE = scratch('c5', 'character-sheet-v2')
for (const d of [
  `${OUT}/cells`,
  `${OUT}/raws`,
  `${DURABLE}/cells`,
  `${DURABLE}/raws`,
  `${DURABLE}/candidates`,
])
  mkdirSync(d, { recursive: true })

// Crash-proof candidate cache: every generated raw + its judge verdict is persisted
// immediately, so a rerun after budget exhaustion or a crash pays $0 for work already done.
const CACHE = `${DURABLE}/candidates`
const SCORES_PATH = `${CACHE}/scores.json`
const scores: Record<string, { score: number; notes: string }> = (() => {
  try {
    return JSON.parse(readFileSync(SCORES_PATH, 'utf8')) as Record<
      string,
      { score: number; notes: string }
    >
  } catch {
    return {}
  }
})()

const CANVAS = 96,
  FEET_Y = 88
const CHAR_DESC = 'a friendly young villager in a sage-green cap and overalls'
const BIG_PIXEL =
  'Rendered as chunky low-resolution pixel art: the entire figure is drawn from large visible square pixels ' +
  '(as if a 32x32 sprite enlarged), flat solid colors from a limited palette, absolutely no smooth shading, ' +
  'no painterly detail, no anti-aliasing, thick 1-pixel dark outline around the silhouette.'

function cellPrompt(f: Facing, p: Pose, doubleFacing: boolean, doublePose: boolean): string {
  const facing = (doubleFacing ? 'IMPORTANT: ' : '') + FACING_CLAUSES[f]
  const pose = (doublePose ? 'IMPORTANT: ' : '') + POSE_CLAUSES[p]
  return (
    `${STYLE_PROMPT} A single character sprite, exactly one figure, whole body visible. ` +
    `The character is ${facing}. The character is ${pose}. Subject: ${CHAR_DESC}. ${BIG_PIXEL}`
  )
}

async function generate(prompt: string, refs: Buffer[]): Promise<{ png: Buffer; costUsd: number }> {
  budget.spend(RESERVE)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size: '512x512',
      response_format: 'b64_json',
      input_references: refs.map((r) => ({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${r.toString('base64')}` },
      })),
      usage: { include: true },
    }),
  })
  if (!res.ok) throw new Error(`${MODEL} HTTP ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const b64 = json.data?.[0]?.b64_json
  if (!b64) throw new Error(`${MODEL}: no data[0].b64_json`)
  const costUsd = json.usage?.cost ?? RESERVE
  if (costUsd > RESERVE) budget.spend(costUsd - RESERVE)
  return { png: Buffer.from(b64, 'base64'), costUsd }
}

type Attempt = { raw: Buffer; cell: RawImage; score: number; notes: string }
type CellState = { attempts: Attempt[]; current: Attempt; retries: number }
const label = (f: Facing, p: Pose) => `${f}/${p}`
const cells = new Map<string, CellState>()

class OutOfBudget extends Error {}

async function generateCell(
  f: Facing,
  p: Pose,
  attempt: number,
  refs: Buffer[],
  doubleFacing = false,
  doublePose = false,
): Promise<Attempt> {
  let best: Attempt | null = null
  for (let i = 0; i < 2; i++) {
    const key = `${p}-${f}-a${attempt}-c${i}`
    const rawPath = `${CACHE}/${key}.png`
    let png: Buffer
    if (existsSync(rawPath)) {
      png = readFileSync(rawPath)
      console.log(`  ${key}: reusing cached raw`)
    } else {
      let r: { png: Buffer; costUsd: number }
      try {
        r = await generate(cellPrompt(f, p, doubleFacing, doublePose), refs)
      } catch (e) {
        if (e instanceof BudgetExceededError) {
          if (best) return best
          throw new OutOfBudget(e.message)
        }
        throw e
      }
      png = r.png
      writeFileSync(rawPath, png)
      console.log(`  ${key}: generated $${r.costUsd.toFixed(3)}`)
    }
    let cell: RawImage
    try {
      cell = await postProcessCell(png, CANVAS, FEET_Y)
    } catch (e) {
      console.log(`  ${key}: post-process failed: ${String(e)}`)
      continue
    }
    let v = scores[key]
    if (!v) {
      v = await judge(png)
      scores[key] = v
      writeFileSync(SCORES_PATH, JSON.stringify(scores, null, 1))
    }
    console.log(`  ${key}: score=${v.score} native=${cell.width}x${cell.height} — ${v.notes}`)
    if (!best || v.score > best.score) best = { raw: png, cell, score: v.score, notes: v.notes }
  }
  if (!best) throw new Error(`${label(f, p)}: every candidate failed post-processing`)
  return best
}

console.log('cell sw/idle')
const first = await generateCell('sw', 'idle', 0, [STYLE_ANCHOR, ANCHOR])
cells.set(label('sw', 'idle'), { attempts: [first], current: first, retries: 0 })
const laterRefs = [STYLE_ANCHOR, ANCHOR, first.raw]
// se column proactively gets the mirrored sw/idle raw ahead of the identity refs (mirrored
// reference INPUT only — the model re-renders with correct NW light) to break the recurring
// sw/idle ~ se/idle near-dupe; output pixels are never mirrored.
const mirroredSw = await encodePng(mirrorX(await decodePng(first.raw)))
const refsFor = (f: Facing) => (f === 'se' ? [STYLE_ANCHOR, mirroredSw, ANCHOR] : laterRefs)

for (const p of POSES)
  for (const f of FACINGS) {
    if (f === 'sw' && p === 'idle') continue
    console.log(`cell ${label(f, p)}`)
    const a = await generateCell(f, p, 0, refsFor(f))
    cells.set(label(f, p), { attempts: [a], current: a, retries: 0 })
  }

// Recalibrate thresholds from this sheet's own distance distribution: the v1
// calibration put straight/mirror cutoffs at 0.36x / 0.21x the pairwise median.
const labels = POSES.flatMap((p) => FACINGS.map((f) => label(f, p)))
const median = pairwiseMedian(labels.map((l) => cells.get(l)!.current.cell))
// thresholds fixed by controller ruling (recalibrated from the previous run's median 0.414)
const straightThr = 0.149,
  mirrorThr = 0.087
console.log(
  `pairwise median=${median.toFixed(3)}; ruling thresholds straight<${straightThr} mirror<${mirrorThr}`,
)

type Flag = { label: string; doubleFacing: boolean; doublePose: boolean }
function collectFindings() {
  const rows = POSES.flatMap((p) =>
    duplicateReport(
      FACINGS.map((f) => ({ label: label(f, p), img: cells.get(label(f, p))!.current.cell })),
      straightThr,
      mirrorThr,
    ),
  )
  const cols = FACINGS.flatMap((f) =>
    duplicateReport(
      POSES.map((p) => ({ label: label(f, p), img: cells.get(label(f, p))!.current.cell })),
      straightThr,
      mirrorThr,
    ),
  )
  return { rows, cols }
}
function flaggedCells(): Flag[] {
  const { rows, cols } = collectFindings()
  const flags = new Map<string, Flag>()
  for (const fnd of rows) {
    const f = flags.get(fnd.b) ?? { label: fnd.b, doubleFacing: false, doublePose: false }
    f.doubleFacing = true
    flags.set(fnd.b, f)
  }
  for (const fnd of cols) {
    const f = flags.get(fnd.b) ?? { label: fnd.b, doubleFacing: false, doublePose: false }
    f.doublePose = true
    flags.set(fnd.b, f)
  }
  return [...flags.values()]
}

retryLoop: for (let round = 1; round <= 2; round++) {
  const flags = flaggedCells().filter((fl) => cells.get(fl.label)!.retries < 2)
  if (flags.length === 0) break
  console.log(`retry round ${round}: ${flags.map((f) => f.label).join(', ')}`)
  for (const fl of flags) {
    const [f, p] = fl.label.split('/') as [Facing, Pose]
    const state = cells.get(fl.label)!
    let a: Attempt
    try {
      a = await generateCell(f, p, state.retries + 1, laterRefs, fl.doubleFacing, fl.doublePose)
    } catch (e) {
      // budget exhausted mid-retry: keep what we have and proceed to assembly
      if (e instanceof OutOfBudget) {
        console.log(`budget exhausted during retries: ${e.message}`)
        break retryLoop
      }
      throw e
    }
    state.attempts.push(a)
    state.current = a
    state.retries++
  }
}

const final = collectFindings()
const stillFlagged = new Set([...final.rows, ...final.cols].flatMap((fnd) => [fnd.a, fnd.b]))
for (const lbl of stillFlagged) {
  const state = cells.get(lbl)!
  state.current = state.attempts.reduce((best, a) => (a.score > best.score ? a : best))
}

const grid = POSES.map((p) => FACINGS.map((f) => cells.get(label(f, p))!.current.cell))
const sheet = assembleGrid(grid, CANVAS, CANVAS)
const sheetPng = await encodePng(sheet)
writeFileSync(`${OUT}/sheet.png`, sheetPng)
writeFileSync(`${DURABLE}/sheet.png`, sheetPng)
writeFileSync(`${DURABLE}/sheet-4x.png`, await encodePng(upscaleNearest(sheet, 4)))
for (const p of POSES)
  for (const f of FACINGS) {
    const state = cells.get(label(f, p))!
    const name = `${p}-${f}.png`
    const cellPng = await encodePng(state.current.cell)
    for (const dir of [OUT, DURABLE]) {
      writeFileSync(`${dir}/cells/${name}`, cellPng)
      writeFileSync(`${dir}/raws/${name}`, state.current.raw)
    }
  }

const matrix = (mirror: boolean) =>
  distanceMatrix(
    labels.map((l) => ({ label: l, img: cells.get(l)!.current.cell })),
    mirror,
  )
const report = [
  '== v2 per-cell judge scores (winner) ==',
  ...labels.map((l) => {
    const s = cells.get(l)!
    return `${l.padEnd(12)} score=${s.current.score} retries=${s.retries} attempts=${s.attempts.length} — ${s.current.notes}`
  }),
  '',
  `pairwise median=${median.toFixed(3)}; recalibrated thresholds: straight<${straightThr.toFixed(3)} mirror<${mirrorThr.toFixed(3)}`,
  '',
  '== straight distance matrix (12x12) ==',
  matrix(false),
  '',
  '== mirrored distance matrix (12x12, col cell mirrored) ==',
  matrix(true),
  '',
  '== dupe findings after retries ==',
  ...(final.rows.length + final.cols.length === 0
    ? ['none']
    : [
        ...final.rows.map(
          (f) => `row  ${f.a} ~ ${f.b} d=${f.distance.toFixed(3)} mirrored=${f.mirrored}`,
        ),
        ...final.cols.map(
          (f) => `col  ${f.a} ~ ${f.b} d=${f.distance.toFixed(3)} mirrored=${f.mirrored}`,
        ),
      ]),
  '',
  `total spend: $${budget.total.toFixed(3)} of $${CAP.toFixed(2)}`,
].join('\n')
writeFileSync(`${DURABLE}/distance-matrix.txt`, report)
console.log(report)
