// LIVE — cap $2.50. Per-view character sheet for the T6 reference character:
// 4 facings × 3 poses, one generation per cell, mechanical assembly + duplicate detection.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { makeImageClient } from '../src/imageClient.js'
import { makeVlmJudge, type JudgeFn } from '../src/judge.js'
import { BudgetGuard } from '../src/budget.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { decodePng, encodePng, downscaleNearest, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { quantize } from '../src/post/quantize.js'
import { outlinePass } from '../src/post/outline.js'
import {
  FACINGS,
  POSES,
  FACING_CLAUSES,
  POSE_CLAUSES,
  STRAIGHT_DUPE,
  MIRROR_DUPE,
  assembleGrid,
  cellDistance,
  mirrorX,
  duplicateReport,
  upscaleNearest,
  type Facing,
  type Pose,
} from '../src/sheet.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const budget = new BudgetGuard(2.5)
const client = makeImageClient({ apiKey: KEY, budget })

const REF_CANDIDATES =
  '/Users/deadpackets/workspace/SanJunipero/.claude/scratch/c5/reference-candidates'
const ANCHOR = readFileSync('packages/forge/content/reference/identity-anchor.png')
const judge: JudgeFn = makeVlmJudge({
  apiKey: KEY,
  refSheets: [
    readFileSync(`${REF_CANDIDATES}/building-1.png`),
    readFileSync(`${REF_CANDIDATES}/item-1.png`),
    ANCHOR,
  ],
})

const OUT = 'packages/forge/out/character-sheet'
const DURABLE = scratch('c5', 'character-sheet')
for (const d of [`${OUT}/cells`, `${OUT}/raws`, `${DURABLE}/cells`, `${DURABLE}/raws`])
  mkdirSync(d, { recursive: true })

const CHAR_DESC = 'a friendly young villager in a sage-green cap and overalls'
const CELL = 32

function cellPrompt(f: Facing, p: Pose, doubleFacing: boolean, doublePose: boolean): string {
  const facing = (doubleFacing ? 'IMPORTANT: ' : '') + FACING_CLAUSES[f]
  const pose = (doublePose ? 'IMPORTANT: ' : '') + POSE_CLAUSES[p]
  return (
    `${STYLE_PROMPT} A single character sprite, exactly one figure, whole body visible. ` +
    `The character is ${facing}. The character is ${pose}. Subject: ${CHAR_DESC}.`
  )
}

async function postProcessCell(rawPng: Buffer): Promise<RawImage> {
  return outlinePass(quantize(downscaleNearest(chromaKey(await decodePng(rawPng)), CELL, CELL)))
}

type Attempt = { raw: Buffer; cell: RawImage; score: number; notes: string }
type CellState = { attempts: Attempt[]; current: Attempt; retries: number }
const label = (f: Facing, p: Pose) => `${f}/${p}`
const cells = new Map<string, CellState>()

async function generateCell(
  f: Facing,
  p: Pose,
  n: number,
  refs: Buffer[],
  doubleFacing = false,
  doublePose = false,
): Promise<Attempt> {
  const cands = await client.generateCandidates(cellPrompt(f, p, doubleFacing, doublePose), refs, n)
  let best: Attempt | null = null
  for (const c of cands) {
    const v = await judge(c.png)
    console.log(
      `  ${label(f, p)} candidate (${c.model}): score=${v.score} $${c.costUsd.toFixed(3)} — ${v.notes}`,
    )
    if (!best || v.score > best.score)
      best = { raw: c.png, cell: await postProcessCell(c.png), score: v.score, notes: v.notes }
  }
  return best!
}

// sw/idle first: 3 candidates, anchor-only refs; its RAW winner anchors every later cell.
console.log('cell sw/idle (3 candidates)')
const first = await generateCell('sw', 'idle', 3, [ANCHOR])
cells.set(label('sw', 'idle'), { attempts: [first], current: first, retries: 0 })
const laterRefs = [ANCHOR, first.raw]

for (const p of POSES)
  for (const f of FACINGS) {
    if (f === 'sw' && p === 'idle') continue
    console.log(`cell ${label(f, p)} (2 candidates)`)
    const a = await generateCell(f, p, 2, laterRefs)
    cells.set(label(f, p), { attempts: [a], current: a, retries: 0 })
  }

type Flag = { label: string; doubleFacing: boolean; doublePose: boolean }
function collectFindings() {
  const rows = POSES.flatMap((p) =>
    duplicateReport(
      FACINGS.map((f) => ({ label: label(f, p), img: cells.get(label(f, p))!.current.cell })),
      STRAIGHT_DUPE,
      MIRROR_DUPE,
    ),
  )
  const cols = FACINGS.flatMap((f) =>
    duplicateReport(
      POSES.map((p) => ({ label: label(f, p), img: cells.get(label(f, p))!.current.cell })),
      STRAIGHT_DUPE,
      MIRROR_DUPE,
    ),
  )
  return { rows, cols }
}
function flaggedCells(): Flag[] {
  const { rows, cols } = collectFindings()
  const flags = new Map<string, Flag>()
  // regenerate the later cell of each dupe pair; row dupes implicate the facing clause, column dupes the pose clause
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

for (let round = 1; round <= 2; round++) {
  const flags = flaggedCells().filter((fl) => cells.get(fl.label)!.retries < 2)
  if (flags.length === 0) break
  console.log(`retry round ${round}: ${flags.map((f) => f.label).join(', ')}`)
  for (const fl of flags) {
    const [f, p] = fl.label.split('/') as [Facing, Pose]
    const state = cells.get(fl.label)!
    const a = await generateCell(f, p, 2, laterRefs, fl.doubleFacing, fl.doublePose)
    state.attempts.push(a)
    state.current = a
    state.retries++
  }
}

// Still-flagged cells: keep the judge-best attempt; findings are flags for the human, never failures.
const final = collectFindings()
const stillFlagged = new Set([...final.rows, ...final.cols].flatMap((fnd) => [fnd.a, fnd.b]))
for (const lbl of stillFlagged) {
  const state = cells.get(lbl)!
  state.current = state.attempts.reduce((best, a) => (a.score > best.score ? a : best))
}

const grid = POSES.map((p) => FACINGS.map((f) => cells.get(label(f, p))!.current.cell))
const sheet = assembleGrid(grid, CELL, CELL)
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

const labels = POSES.flatMap((p) => FACINGS.map((f) => label(f, p)))
function matrix(mirror: boolean): string {
  const header = ['            ', ...labels.map((l) => l.padStart(11))].join(' ')
  const lines = labels.map((la) =>
    [
      la.padEnd(12),
      ...labels.map((lb) => {
        const a = cells.get(la)!.current.cell,
          b = cells.get(lb)!.current.cell
        return cellDistance(a, mirror ? mirrorX(b) : b)
          .toFixed(3)
          .padStart(11)
      }),
    ].join(' '),
  )
  return [header, ...lines].join('\n')
}
const report = [
  '== per-cell judge scores (winner) ==',
  ...labels.map((l) => {
    const s = cells.get(l)!
    return `${l.padEnd(12)} score=${s.current.score} retries=${s.retries} attempts=${s.attempts.length} — ${s.current.notes}`
  }),
  '',
  '== straight distance matrix (12x12) ==',
  matrix(false),
  '',
  '== mirrored distance matrix (12x12, col cell mirrored) ==',
  matrix(true),
  '',
  `== dupe findings after retries (thresholds straight<${STRAIGHT_DUPE} mirror<${MIRROR_DUPE}) ==`,
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
  `total spend: $${budget.total.toFixed(3)} of $2.50`,
].join('\n')
writeFileSync(`${DURABLE}/distance-matrix.txt`, report)
console.log(report)
