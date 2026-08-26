// LIVE — cap $0.30. Final polish on sheet v2: regenerate sw/walk-b (style outlier)
// with accepted-cell refs, defringe-rebuild all 12 cells from their saved winner raws
// (no other API spend), reassemble, print final matrices + findings.
import { writeFileSync, readFileSync } from 'node:fs'
import { BudgetGuard } from '../src/budget.js'
import { makeVlmJudge } from '../src/judge.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { encodePng, type RawImage } from '../src/post/raw.js'
import {
  FACINGS, POSES, FACING_CLAUSES, POSE_CLAUSES,
  assembleGrid, cellDistance, mirrorX, duplicateReport, postProcessCell, upscaleNearest,
  type Facing, type Pose,
} from '../src/sheet.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const budget = new BudgetGuard(0.3)
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'
const RESERVE = 0.046

const REF_CANDIDATES = '/Users/deadpackets/workspace/SanJunipero/.claude/scratch/c5/reference-candidates'
const ANCHOR = readFileSync('packages/forge/content/reference/identity-anchor-v2.png')
const judge = makeVlmJudge({
  apiKey: KEY,
  refSheets: [readFileSync(`${REF_CANDIDATES}/building-1.png`), readFileSync(`${REF_CANDIDATES}/item-1.png`), ANCHOR],
})

const OUT = 'packages/forge/out/character-sheet-v2'
const DURABLE = scratch('c5', 'character-sheet-v2')
const CANVAS = 96, FEET_Y = 88
const STRAIGHT_THR = 0.149, MIRROR_THR = 0.087
const label = (f: Facing, p: Pose) => `${f}/${p}`
const file = (f: Facing, p: Pose) => `${p}-${f}.png`


// Regenerate sw/walk-b with accepted-cell refs and a style-match clause.
const swIdleRaw = readFileSync(`${DURABLE}/raws/${file('sw', 'idle')}`)
const seWalkBRaw = readFileSync(`${DURABLE}/raws/${file('se', 'walk-b')}`)
const PROMPT = `${STYLE_PROMPT} A single character sprite, exactly one figure, whole body visible. ` +
  `The character is ${FACING_CLAUSES.sw}. The character is ${POSE_CLAUSES['walk-b']}. ` +
  'Subject: a friendly young villager in a sage-green cap and overalls. ' +
  'Render in the exact same soft warm style as the reference images. ' +
  'Rendered as chunky low-resolution pixel art: the entire figure is drawn from large visible square pixels ' +
  '(as if a 32x32 sprite enlarged), flat solid colors from a limited palette, absolutely no smooth shading, ' +
  'no painterly detail, no anti-aliasing, thick 1-pixel dark outline around the silhouette.'

let winner: { raw: Buffer; score: number; notes: string } | null = null
for (let i = 0; i < 2; i++) {
  budget.spend(RESERVE)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, prompt: PROMPT, size: '512x512', response_format: 'b64_json',
      input_references: [ANCHOR, swIdleRaw, seWalkBRaw].map(r =>
        ({ type: 'image_url', image_url: { url: `data:image/png;base64,${r.toString('base64')}` } })),
      usage: { include: true },
    }),
  })
  if (!res.ok) throw new Error(`${MODEL} HTTP ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const b64 = json.data?.[0]?.b64_json
  if (!b64) throw new Error(`${MODEL}: no data[0].b64_json`)
  const costUsd = json.usage?.cost ?? RESERVE
  if (costUsd > RESERVE) budget.spend(costUsd - RESERVE)
  const raw = Buffer.from(b64, 'base64')
  writeFileSync(`${DURABLE}/candidates/walk-b-sw-regen-c${i}.png`, raw)
  const v = await judge(raw)
  console.log(`sw/walk-b regen candidate ${i}: score=${v.score} $${costUsd.toFixed(4)} — ${v.notes}`)
  if (!winner || v.score > winner.score) winner = { raw, score: v.score, notes: v.notes }
}
writeFileSync(`${DURABLE}/raws/${file('sw', 'walk-b')}`, winner!.raw)
writeFileSync(`${OUT}/raws/${file('sw', 'walk-b')}`, winner!.raw)

// Rebuild all 12 cells from winner raws through the defringed chain.
const cells = new Map<string, RawImage>()
for (const p of POSES) for (const f of FACINGS) {
  const cell = await postProcessCell(readFileSync(`${DURABLE}/raws/${file(f, p)}`), CANVAS, FEET_Y)
  cells.set(label(f, p), cell)
  const png = await encodePng(cell)
  writeFileSync(`${DURABLE}/cells/${file(f, p)}`, png)
  writeFileSync(`${OUT}/cells/${file(f, p)}`, png)
}

const swWalkB = cells.get(label('sw', 'walk-b'))!
const dIdle = cellDistance(swWalkB, cells.get(label('sw', 'idle'))!)
const dWalkA = cellDistance(swWalkB, cells.get(label('sw', 'walk-a'))!)
console.log(`sw/walk-b verify: d(sw/idle)=${dIdle.toFixed(3)} d(sw/walk-a)=${dWalkA.toFixed(3)}` +
  (dIdle > STRAIGHT_THR && dWalkA > STRAIGHT_THR ? ' — both above threshold' : ' — BELOW THRESHOLD, flag'))

const sheet = assembleGrid(POSES.map(p => FACINGS.map(f => cells.get(label(f, p))!)), CANVAS, CANVAS)
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
  FACINGS.map(f => ({ label: label(f, p), img: cells.get(label(f, p))! })), STRAIGHT_THR, MIRROR_THR))
const cols = FACINGS.flatMap(f => duplicateReport(
  POSES.map(p => ({ label: label(f, p), img: cells.get(label(f, p))! })), STRAIGHT_THR, MIRROR_THR))
const report = [
  '== FINALIZE: defringe + sw/walk-b regen ==',
  `sw/walk-b regen winner: score=${winner!.score} — ${winner!.notes}`,
  `sw/walk-b verify: d(sw/idle)=${dIdle.toFixed(3)} d(sw/walk-a)=${dWalkA.toFixed(3)}`,
  '', '== straight distance matrix (12x12) ==', matrix(false),
  '', '== mirrored distance matrix (12x12, col cell mirrored) ==', matrix(true),
  '', `== dupe findings (thresholds straight<${STRAIGHT_THR} mirror<${MIRROR_THR}) ==`,
  ...(rows.length + cols.length === 0 ? ['none'] : [
    ...rows.map(f => `row  ${f.a} ~ ${f.b} d=${f.distance.toFixed(3)} mirrored=${f.mirrored}`),
    ...cols.map(f => `col  ${f.a} ~ ${f.b} d=${f.distance.toFixed(3)} mirrored=${f.mirrored}`),
  ]),
  '', `finalize spend: $${budget.total.toFixed(4)} of $0.30`,
].join('\n')
writeFileSync(`${DURABLE}/distance-matrix-final.txt`, report)
console.log(report)
