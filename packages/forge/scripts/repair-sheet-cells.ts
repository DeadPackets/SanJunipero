// LIVE — cap $0.40. Targeted repair of two gen-character-sheet cells.
// Mirroring a reference INPUT is legal — the model re-renders with correct NW lighting;
// output pixels are never mirrored.
import { writeFileSync, readFileSync } from 'node:fs'
import { makeImageClient } from '../src/imageClient.js'
import { makeVlmJudge } from '../src/judge.js'
import { BudgetGuard } from '../src/budget.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { decodePng, encodePng, downscaleNearest, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { quantize } from '../src/post/quantize.js'
import { outlinePass } from '../src/post/outline.js'
import {
  FACINGS, POSES, FACING_CLAUSES, POSE_CLAUSES, STRAIGHT_DUPE, MIRROR_DUPE,
  assembleGrid, cellDistance, mirrorX, duplicateReport, upscaleNearest, type Facing, type Pose,
} from '../src/sheet.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const budget = new BudgetGuard(0.4)
const client = makeImageClient({ apiKey: KEY, budget })

const REF_CANDIDATES = '/Users/deadpackets/workspace/SanJunipero/.claude/scratch/c5/reference-candidates'
const ANCHOR = readFileSync('packages/forge/content/reference/identity-anchor.png')
const judge = makeVlmJudge({
  apiKey: KEY,
  refSheets: [readFileSync(`${REF_CANDIDATES}/building-1.png`), readFileSync(`${REF_CANDIDATES}/item-1.png`), ANCHOR],
})

const OUT = 'packages/forge/out/character-sheet'
const DURABLE = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5/character-sheet'
const CELL = 32
const label = (f: Facing, p: Pose) => `${f}/${p}`
const file = (f: Facing, p: Pose) => `${p}-${f}.png`

async function postProcessCell(rawPng: Buffer): Promise<RawImage> {
  return outlinePass(quantize(downscaleNearest(chromaKey(await decodePng(rawPng)), CELL, CELL)))
}

const cells = new Map<string, RawImage>()
for (const p of POSES) for (const f of FACINGS)
  cells.set(label(f, p), await decodePng(readFileSync(`${OUT}/cells/${file(f, p)}`)))
const swIdleRaw = readFileSync(`${OUT}/raws/${file('sw', 'idle')}`)
const swIdleCell = cells.get(label('sw', 'idle'))!

async function saveCell(f: Facing, p: Pose, raw: Buffer, cell: RawImage) {
  cells.set(label(f, p), cell)
  const cellPng = await encodePng(cell)
  for (const dir of [OUT, DURABLE]) {
    writeFileSync(`${dir}/cells/${file(f, p)}`, cellPng)
    writeFileSync(`${dir}/raws/${file(f, p)}`, raw)
  }
}

// Step 1 — se/idle: mirrored sw/idle raw as FIRST reference, anchor second.
const seIdlePrompt = `${STYLE_PROMPT} A single character sprite, exactly one figure, whole body visible. ` +
  `The character is ${FACING_CLAUSES.se}; body and face turned toward the BOTTOM-RIGHT of the frame; ` +
  `this is the OPPOSITE turn from a front-left view. The character is ${POSE_CLAUSES.idle}. ` +
  'Subject: a friendly young villager in a sage-green cap and overalls.'
const mirroredSwRef = await encodePng(mirrorX(await decodePng(swIdleRaw)))
const seCands = await client.generateCandidates(seIdlePrompt, [mirroredSwRef, ANCHOR], 3)
let seWinner: { raw: Buffer; cell: RawImage; score: number; dist: number } | null = null
for (const [i, c] of seCands.entries()) {
  const v = await judge(c.png)
  const cell = await postProcessCell(c.png)
  const dist = cellDistance(cell, swIdleCell)
  console.log(`se/idle candidate ${i}: score=${v.score} d(sw/idle)=${dist.toFixed(3)} $${c.costUsd.toFixed(3)} — ${v.notes}`)
  // among judge-acceptable (>=7) candidates pick max distance from sw/idle; fall back to best score
  const cand = { raw: c.png, cell, score: v.score, dist }
  if (!seWinner) seWinner = cand
  else if (seWinner.score < 7) { if (v.score > seWinner.score) seWinner = cand }
  else if (v.score >= 7 && dist > seWinner.dist) seWinner = cand
}
console.log(`se/idle winner: score=${seWinner!.score} d(sw/idle)=${seWinner!.dist.toFixed(3)}`)
await saveCell('se', 'idle', seWinner!.raw, seWinner!.cell)

// Step 2 — se/walk-b: identity re-lock with anchor + both idle raws.
const walkPrompt = `${STYLE_PROMPT} A single character sprite, exactly one figure, whole body visible. ` +
  `The character is ${FACING_CLAUSES.se}. The character is ${POSE_CLAUSES['walk-b']}. ` +
  'The SAME character as the reference images: green cap, sage overalls, same face and hair. ' +
  'Subject: a friendly young villager in a sage-green cap and overalls.'
const wbCands = await client.generateCandidates(walkPrompt, [ANCHOR, swIdleRaw, seWinner!.raw], 2)
let wbWinner: { raw: Buffer; cell: RawImage; score: number } | null = null
for (const [i, c] of wbCands.entries()) {
  const v = await judge(c.png)
  console.log(`se/walk-b candidate ${i}: score=${v.score} $${c.costUsd.toFixed(3)} — ${v.notes}`)
  if (!wbWinner || v.score > wbWinner.score) wbWinner = { raw: c.png, cell: await postProcessCell(c.png), score: v.score }
}
const dIdle = cellDistance(wbWinner!.cell, cells.get(label('se', 'idle'))!)
const dWalkA = cellDistance(wbWinner!.cell, cells.get(label('se', 'walk-a'))!)
console.log(`se/walk-b winner: score=${wbWinner!.score} d(se/idle)=${dIdle.toFixed(3)} d(se/walk-a)=${dWalkA.toFixed(3)}` +
  (dIdle > STRAIGHT_DUPE && dWalkA > STRAIGHT_DUPE ? ' — both above threshold' : ' — BELOW THRESHOLD, flag'))
await saveCell('se', 'walk-b', wbWinner!.raw, wbWinner!.cell)

// Reassemble + recompute matrices and row/column findings.
const sheet = assembleGrid(POSES.map(p => FACINGS.map(f => cells.get(label(f, p))!)), CELL, CELL)
const sheetPng = await encodePng(sheet)
writeFileSync(`${OUT}/sheet.png`, sheetPng)
writeFileSync(`${DURABLE}/sheet.png`, sheetPng)
writeFileSync(`${DURABLE}/sheet-4x.png`, await encodePng(upscaleNearest(sheet, 4)))

const labels = POSES.flatMap(p => FACINGS.map(f => label(f, p)))
function matrix(mirror: boolean): string {
  const header = ['            ', ...labels.map(l => l.padStart(11))].join(' ')
  const lines = labels.map(la => [la.padEnd(12), ...labels.map(lb =>
    cellDistance(cells.get(la)!, mirror ? mirrorX(cells.get(lb)!) : cells.get(lb)!).toFixed(3).padStart(11))].join(' '))
  return [header, ...lines].join('\n')
}
const rows = POSES.flatMap(p => duplicateReport(
  FACINGS.map(f => ({ label: label(f, p), img: cells.get(label(f, p))! })), STRAIGHT_DUPE, MIRROR_DUPE))
const cols = FACINGS.flatMap(f => duplicateReport(
  POSES.map(p => ({ label: label(f, p), img: cells.get(label(f, p))! })), STRAIGHT_DUPE, MIRROR_DUPE))
const report = [
  '== REPAIR PASS: post-repair matrices (se/idle + se/walk-b regenerated) ==',
  '', '== straight distance matrix (12x12) ==', matrix(false),
  '', '== mirrored distance matrix (12x12, col cell mirrored) ==', matrix(true),
  '', `== dupe findings (thresholds straight<${STRAIGHT_DUPE} mirror<${MIRROR_DUPE}) ==`,
  ...(rows.length + cols.length === 0 ? ['none'] : [
    ...rows.map(f => `row  ${f.a} ~ ${f.b} d=${f.distance.toFixed(3)} mirrored=${f.mirrored}`),
    ...cols.map(f => `col  ${f.a} ~ ${f.b} d=${f.distance.toFixed(3)} mirrored=${f.mirrored}`),
  ]),
  '', `repair spend: $${budget.total.toFixed(3)} of $0.40`,
].join('\n')
writeFileSync(`${DURABLE}/distance-matrix-repair.txt`, report)
console.log(report)
