// LIVE (Phase B) — cap $V3_CAP (default $4). Character standard v2 generation:
// one FACING per call as a 1×5 horizontal phase strip (idle + 4 walk phases), sleep
// as its own single-cell call per facing. Slice → per-frame v7 chain → register →
// HARD gates (fail → regen that strip, max 2 retries, then BLOCKED — never ship a
// flagged sheet). Flags: --guides (A/B: odd candidates get grid-guide refs),
// --concept <path> (concept image inserted right after the style anchor).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'
import { BudgetGuard, BudgetExceededError } from '../src/budget.js'
import { makeVlmJudge, type JudgeFn } from '../src/judge.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { renderCheckerGuide, renderStripFrameGuide } from '../src/guides.js'
import {
  FACINGS, FACING_CLAUSES, POSES_V2, STRIP_POSES_V2, WALK_POSES_V2, POSE_CLAUSES_V2,
  CELL_V2, FEET_Y_V2, type Facing, type PoseV2, type StripPoseV2, type WalkPoseV2,
  sliceStrip, estimatePitch, v7Chain, opaqueBbox, anchorToCanvas, registerToReference,
  assembleGrid, upscaleNearest, distanceMatrix, pairwiseMedian,
  crossFacingDupeGate, strideGate, frameCoherenceGate, sleepGate, type GateFailure,
} from '../src/sheet.js'
import { CHAR_DESC, ASYMMETRY_CLAUSE, BIG_PIXEL } from './character.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.V3_CAP ?? '4')
const budget = new BudgetGuard(CAP)
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'
const RESERVE = 0.046

const USE_GUIDES = process.argv.includes('--guides')
const conceptIdx = process.argv.indexOf('--concept')
const CONCEPT = conceptIdx >= 0 ? readFileSync(process.argv[conceptIdx + 1]!) : null

const SCRATCH = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5'
const DURABLE = `${SCRATCH}/character-v3`
const OUT = 'packages/forge/out/character-v3'
const CACHE = `${DURABLE}/candidates`
for (const d of [`${DURABLE}/cells`, `${DURABLE}/raws`, `${DURABLE}/gifs`, CACHE]) mkdirSync(d, { recursive: true })

const STYLE_ANCHOR = readFileSync('packages/forge/content/reference/style-anchor.png')
// Identity anchor: the approved v1 sw/idle RAW (identity root when no concept is given).
const IDENTITY = readFileSync(`${SCRATCH}/character-sheet-v2/raws/idle-sw.png`)
// Identity refs law: style anchor FIRST, concept (when given) right after, then identity anchor.
const REFS: Buffer[] = [STYLE_ANCHOR, ...(CONCEPT ? [CONCEPT] : []), IDENTITY]
const GUIDE_REFS: Buffer[] = [await encodePng(renderCheckerGuide()), await encodePng(renderStripFrameGuide())]

const judge: JudgeFn = makeVlmJudge({ apiKey: KEY, refSheets: REFS })

// Crash-proof candidate cache: raws + judge verdicts persist synchronously per candidate.
const SCORES_PATH = `${CACHE}/scores.json`
const scores: Record<string, { score: number; notes: string }> = (() => {
  try { return JSON.parse(readFileSync(SCORES_PATH, 'utf8')) } catch { return {} }
})()

class OutOfBudget extends Error {}

async function generate(prompt: string, refs: Buffer[], size: string): Promise<Buffer> {
  budget.spend(RESERVE)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, prompt, size, response_format: 'b64_json',
      input_references: refs.map(r => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${r.toString('base64')}` } })),
      usage: { include: true },
    }),
  })
  if (!res.ok) throw new Error(`${MODEL} HTTP ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const b64 = json.data?.[0]?.b64_json
  if (!b64) throw new Error(`${MODEL}: no data[0].b64_json`)
  const costUsd = json.usage?.cost ?? RESERVE
  if (costUsd > RESERVE) budget.spend(costUsd - RESERVE)
  return Buffer.from(b64, 'base64')
}

function stripPrompt(f: Facing): string {
  const phases = STRIP_POSES_V2.map((p, i) => `frame ${i + 1}: ${POSE_CLAUSES_V2[p]}`).join('; ')
  return `${STYLE_PROMPT} A horizontal sprite strip of exactly FIVE copies of the SAME character side by side, ` +
    `evenly spaced with clear magenta gaps between figures, whole body visible in each. Every figure is ` +
    `${FACING_CLAUSES[f]}. Left to right: ${phases}. The five figures are identical in costume, colors and ` +
    `proportions — only the pose changes. Subject: ${CHAR_DESC}. ${ASYMMETRY_CLAUSE} ${BIG_PIXEL}`
}
function sleepPrompt(f: Facing): string {
  return `${STYLE_PROMPT} A single character sprite, exactly one figure. The character is ${FACING_CLAUSES[f]}. ` +
    `The character is ${POSE_CLAUSES_V2['sleep']}. Subject: ${CHAR_DESC}. ${ASYMMETRY_CLAUSE} ${BIG_PIXEL}`
}

const label = (f: Facing, p: PoseV2) => `${f}/${p}`
const file = (f: Facing, p: PoseV2) => `${p}-${f}.png`

type Candidate = { key: string; raw: Buffer; score: number; notes: string; guided: boolean }

// One candidate: generate (or reuse cached raw), judge (cached), persist synchronously.
async function candidate(key: string, prompt: string, guided: boolean, size: string): Promise<Candidate> {
  const rawPath = `${CACHE}/${key}.png`
  let raw: Buffer
  if (existsSync(rawPath)) { raw = readFileSync(rawPath); console.log(`  ${key}: reusing cached raw`) }
  else {
    raw = await generate(prompt, guided ? [...REFS, ...GUIDE_REFS] : REFS, size)
    writeFileSync(rawPath, raw)
    console.log(`  ${key}: generated (${guided ? 'guided' : 'unguided'}), total spend $${budget.total.toFixed(3)}`)
  }
  let v = scores[key]
  if (!v) {
    v = await judge(raw)
    scores[key] = v
    writeFileSync(SCORES_PATH, JSON.stringify(scores, null, 1))
  }
  return { key, raw, score: v.score, notes: v.notes, guided }
}

// Place a v7 output on the 96×96 canvas, feet at y=88; art taller than 88 px fails the strip.
function place(img: RawImage): RawImage {
  return anchorToCanvas(img, CELL_V2, CELL_V2, FEET_Y_V2)
}

type ProcessedStrip = { cells: Record<StripPoseV2, RawImage>; pitch: number; pitchSpread: number }

function processStrip(keyedStrip: RawImage): ProcessedStrip {
  const segments = sliceStrip(keyedStrip, STRIP_POSES_V2.length)
  const pitches = segments.map(s => estimatePitch(s))
  const sorted = [...pitches].sort((a, b) => a - b)
  const pitch = sorted[Math.floor(sorted.length / 2)]!
  const outs = segments.map(s => v7Chain(s, pitch).out)
  const cells = {} as Record<StripPoseV2, RawImage>
  const idle = place(outs[0]!)
  cells['idle'] = idle
  for (let i = 1; i < STRIP_POSES_V2.length; i++) {
    const placed = place(outs[i]!)
    const { dx } = registerToReference(idle, placed)
    if (dx === 0) { cells[STRIP_POSES_V2[i]!] = placed; continue }
    // apply the registration shift; a centered ~40px sprite leaves ample margin for |dx| ≤ 8
    const b = opaqueBbox(placed)!
    if (b.x0 + dx < 0 || b.x1 + dx >= CELL_V2) throw new Error(`registration dx=${dx} pushes sprite off canvas`)
    const shifted = new Uint8ClampedArray(CELL_V2 * CELL_V2 * 4)
    for (let y = 0; y < CELL_V2; y++) for (let x = b.x0; x <= b.x1; x++) {
      const s = (y * CELL_V2 + x) * 4
      if (placed.data[s + 3] === 0) continue
      shifted.set(placed.data.subarray(s, s + 4), (y * CELL_V2 + x + dx) * 4)
    }
    cells[STRIP_POSES_V2[i]!] = { width: CELL_V2, height: CELL_V2, data: shifted }
  }
  return { cells, pitch, pitchSpread: sorted[sorted.length - 1]! - sorted[0]! }
}

function withinFacingFailures(f: Facing, cells: Record<StripPoseV2, RawImage>, median: number): GateFailure[] {
  const walk = Object.fromEntries(WALK_POSES_V2.map(p => [p, cells[p]])) as Record<WalkPoseV2, RawImage>
  return [
    ...strideGate(f, walk, median),
    ...frameCoherenceGate(f, cells['idle'], WALK_POSES_V2.map(p => ({ label: p, img: cells[p] }))),
  ]
}

type StripState = {
  cand: Candidate; strip: ProcessedStrip; retries: number
  failures: GateFailure[]; attempts: string[]
}
const strips = new Map<Facing, StripState>()
const reportLines: string[] = []

// Provisional gate median until all facings exist: the v1 sheet's measured 0.310.
// Recomputed from the actual 20 standing cells before the cross-facing pass.
const PROVISIONAL_MEDIAN = 0.310

async function attemptStrip(f: Facing, attempt: number): Promise<{ ok: boolean; state: StripState }> {
  const cands: Candidate[] = []
  for (let i = 0; i < 2; i++) {
    const guided = USE_GUIDES && i % 2 === 1
    try { cands.push(await candidate(`strip-${f}-a${attempt}-c${i}`, stripPrompt(f), guided, '1024x1024')) }
    catch (e) { if (e instanceof BudgetExceededError) throw new OutOfBudget(e.message); throw e }
  }
  cands.sort((a, b) => b.score - a.score)
  let best: StripState | null = null
  for (const cand of cands) {
    let strip: ProcessedStrip
    try { strip = processStrip(chromaKey(await decodePng(cand.raw))) }
    catch (e) {
      reportLines.push(`${cand.key} (${cand.guided ? 'guided' : 'unguided'}) score=${cand.score} — process FAILED: ${String(e)}`)
      continue
    }
    const failures = withinFacingFailures(f, strip.cells, PROVISIONAL_MEDIAN)
    reportLines.push(`${cand.key} (${cand.guided ? 'guided' : 'unguided'}) score=${cand.score} ` +
      `pitch=${strip.pitch.toFixed(2)}±${strip.pitchSpread.toFixed(2)} gates=${failures.length === 0 ? 'PASS' : failures.map(x => x.gate).join(',')}`)
    const state: StripState = { cand, strip, retries: attempt, failures, attempts: cands.map(c => c.key) }
    if (failures.length === 0) return { ok: true, state }
    if (!best) best = state
  }
  if (!best) throw new Error(`${f}: every strip candidate failed processing at attempt ${attempt}`)
  return { ok: false, state: best }
}

for (const f of FACINGS) {
  console.log(`strip ${f}`)
  let last: StripState | null = null
  for (let attempt = 0; attempt <= 2; attempt++) {
    let r: { ok: boolean; state: StripState }
    try { r = await attemptStrip(f, attempt) }
    catch (e) {
      if (e instanceof OutOfBudget && last) { console.log(`budget exhausted; keeping ${f} attempt ${last.retries}`); break }
      throw e
    }
    last = r.state
    if (r.ok) break
    console.log(`  ${f} attempt ${attempt} failed gates: ${r.state.failures.map(x => `${x.gate} ${x.a}~${x.b} ${x.value.toFixed(3)}<${x.limit.toFixed(3)}`).join('; ')}`)
  }
  strips.set(f, last!)
}

// Sleep row: one single-cell call per facing, judged, gated (palette identity + lying bbox).
type SleepState = { cand: Candidate; cell: RawImage; retries: number; failures: GateFailure[] }
const sleeps = new Map<Facing, SleepState>()

async function attemptSleep(f: Facing, attempt: number): Promise<{ ok: boolean; state: SleepState }> {
  const cands: Candidate[] = []
  for (let i = 0; i < 2; i++) {
    const guided = USE_GUIDES && i % 2 === 1
    try { cands.push(await candidate(`sleep-${f}-a${attempt}-c${i}`, sleepPrompt(f), guided, '512x512')) }
    catch (e) { if (e instanceof BudgetExceededError) throw new OutOfBudget(e.message); throw e }
  }
  cands.sort((a, b) => b.score - a.score)
  let best: SleepState | null = null
  for (const cand of cands) {
    let cell: RawImage
    try {
      const keyed = chromaKey(await decodePng(cand.raw))
      cell = place(v7Chain(keyed, estimatePitch(keyed)).out)
    } catch (e) {
      reportLines.push(`${cand.key} (${cand.guided ? 'guided' : 'unguided'}) score=${cand.score} — process FAILED: ${String(e)}`)
      continue
    }
    const failures = sleepGate(f, strips.get(f)!.strip.cells['idle'], cell)
    reportLines.push(`${cand.key} (${cand.guided ? 'guided' : 'unguided'}) score=${cand.score} gates=${failures.length === 0 ? 'PASS' : failures.map(x => x.gate).join(',')}`)
    const state: SleepState = { cand, cell, retries: attempt, failures }
    if (failures.length === 0) return { ok: true, state }
    if (!best) best = state
  }
  if (!best) throw new Error(`${f}/sleep: every candidate failed processing at attempt ${attempt}`)
  return { ok: false, state: best }
}

for (const f of FACINGS) {
  console.log(`sleep ${f}`)
  let last: SleepState | null = null
  for (let attempt = 0; attempt <= 2; attempt++) {
    let r: { ok: boolean; state: SleepState }
    try { r = await attemptSleep(f, attempt) }
    catch (e) {
      if (e instanceof OutOfBudget && last) { console.log(`budget exhausted; keeping ${f}/sleep attempt ${last.retries}`); break }
      throw e
    }
    last = r.state
    if (r.ok) break
    console.log(`  ${f}/sleep attempt ${attempt} failed: ${r.state.failures.map(x => x.gate).join(', ')}`)
  }
  sleeps.set(f, last!)
}

// Cross-facing hard gates over the real cells; a failing pair regenerates the b-side
// facing's strip (or sleep cell) while retries remain.
const cellOf = (f: Facing, p: PoseV2): RawImage =>
  p === 'sleep' ? sleeps.get(f)!.cell : strips.get(f)!.strip.cells[p]

function crossFailures(median: number): { pose: PoseV2; failures: GateFailure[] }[] {
  return POSES_V2.map(p => ({
    pose: p,
    failures: crossFacingDupeGate(FACINGS.map(f => ({ label: label(f, p), img: cellOf(f, p) })), median),
  })).filter(r => r.failures.length > 0)
}

let median = pairwiseMedian(FACINGS.flatMap(f => STRIP_POSES_V2.map(p => cellOf(f, p))))
console.log(`pairwise median (20 standing cells): ${median.toFixed(3)}`)

crossLoop: for (let round = 1; round <= 2; round++) {
  const failing = crossFailures(median)
  if (failing.length === 0) break
  for (const { pose, failures } of failing) for (const fnd of failures) {
    const f = fnd.b.split('/')[0] as Facing
    if (pose === 'sleep') {
      const st = sleeps.get(f)!
      if (st.retries >= 2) continue
      console.log(`cross round ${round}: regen sleep ${f} (${fnd.gate} vs ${fnd.a})`)
      try { sleeps.set(f, (await attemptSleep(f, st.retries + 1)).state) }
      catch (e) { if (e instanceof OutOfBudget) break crossLoop; throw e }
    } else {
      const st = strips.get(f)!
      if (st.retries >= 2) continue
      console.log(`cross round ${round}: regen strip ${f} (${fnd.gate} ${fnd.a}~${fnd.b})`)
      try { strips.set(f, (await attemptStrip(f, st.retries + 1)).state) }
      catch (e) { if (e instanceof OutOfBudget) break crossLoop; throw e }
    }
  }
  median = pairwiseMedian(FACINGS.flatMap(f => STRIP_POSES_V2.map(p => cellOf(f, p))))
}

// Final verdict: within-facing (recomputed at the final median), sleep and cross gates.
const finalFailures: GateFailure[] = [
  ...FACINGS.flatMap(f => withinFacingFailures(f, strips.get(f)!.strip.cells, median)),
  ...FACINGS.flatMap(f => sleeps.get(f)!.failures),
  ...crossFailures(median).flatMap(r => r.failures),
]
const BLOCKED = finalFailures.length > 0

// Persist everything durable (even when BLOCKED, for the human post-mortem)…
const grid = POSES_V2.map(p => FACINGS.map(f => cellOf(f, p)))
const sheet = assembleGrid(grid, CELL_V2, CELL_V2)
writeFileSync(`${DURABLE}/sheet.png`, await encodePng(sheet))
writeFileSync(`${DURABLE}/sheet-4x.png`, await encodePng(upscaleNearest(sheet, 4)))
for (const f of FACINGS) {
  for (const p of POSES_V2) writeFileSync(`${DURABLE}/cells/${file(f, p)}`, await encodePng(cellOf(f, p)))
  writeFileSync(`${DURABLE}/raws/strip-${f}.png`, strips.get(f)!.cand.raw)
  writeFileSync(`${DURABLE}/raws/sleep-${f}.png`, sleeps.get(f)!.cand.raw)
}
// …walk GIF per facing: the v2 render loop contact-A → passing-A → contact-B → passing-B
// at 8fps (125 ms/frame). The renderer additionally bobs passing frames 1px down —
// renderer behavior, deliberately NOT baked into cells or GIFs.
for (const f of FACINGS) {
  const frames = WALK_POSES_V2.map(p => upscaleNearest(cellOf(f, p), 4))
  const fw = frames[0]!.width, fh = frames[0]!.height
  const stacked = new Uint8ClampedArray(fw * fh * frames.length * 4)
  frames.forEach((fr, i) => stacked.set(fr.data, fw * fh * 4 * i))
  const gif = await sharp(Buffer.from(stacked.buffer), {
    raw: { width: fw, height: fh * frames.length, channels: 4, pageHeight: fh },
  }).gif({ delay: frames.map(() => 125), loop: 0 }).toBuffer()
  writeFileSync(`${DURABLE}/gifs/walk-${f}.gif`, gif)
}

// The repo out/ copy is the SHIP artifact: only written on a clean pass.
if (!BLOCKED) {
  mkdirSync(`${OUT}/cells`, { recursive: true })
  writeFileSync(`${OUT}/sheet.png`, await encodePng(sheet))
  for (const p of POSES_V2) for (const f of FACINGS)
    writeFileSync(`${OUT}/cells/${file(f, p)}`, await encodePng(cellOf(f, p)))
}

const labels = POSES_V2.flatMap(p => FACINGS.map(f => label(f, p)))
const cells24 = labels.map(l => {
  const [f, p] = l.split('/') as [Facing, PoseV2]
  return { label: l, img: cellOf(f, p) }
})
const report = [
  `== CHARACTER V3 (standard v2): ${BLOCKED ? '** BLOCKED — do not ship **' : 'PASS'} ==`,
  `guides A/B: ${USE_GUIDES ? 'ON (odd candidates guided)' : 'off'}; concept ref: ${CONCEPT ? process.argv[conceptIdx + 1] : 'none'}`,
  '', '== candidates (guided/unguided, judge score, pitch, gate outcome) ==', ...reportLines,
  '', '== chosen strips ==',
  ...FACINGS.map(f => {
    const s = strips.get(f)!
    return `${f}: ${s.cand.key} (${s.cand.guided ? 'guided' : 'unguided'}) score=${s.cand.score} retries=${s.retries} pitch=${s.strip.pitch.toFixed(2)}±${s.strip.pitchSpread.toFixed(2)} — ${s.cand.notes}`
  }),
  ...FACINGS.map(f => {
    const s = sleeps.get(f)!
    return `${f}/sleep: ${s.cand.key} score=${s.cand.score} retries=${s.retries} — ${s.cand.notes}`
  }),
  '', `pairwise median (20 standing cells)=${median.toFixed(3)}; hard limits: straight<${(0.55 * median).toFixed(3)} mirror<${(0.35 * median).toFixed(3)} stride>=${(0.35 * median).toFixed(3)} contact-passing>=${(0.25 * median).toFixed(3)}`,
  '', '== remaining gate failures ==',
  ...(finalFailures.length === 0 ? ['none'] : finalFailures.map(x => `${x.gate}  ${x.a} ~ ${x.b}  value=${x.value.toFixed(3)} limit=${x.limit.toFixed(3)}`)),
  '', '== straight distance matrix (24x24) ==', distanceMatrix(cells24, false),
  '', '== mirrored distance matrix (24x24) ==', distanceMatrix(cells24, true),
  '', `total spend: $${budget.total.toFixed(3)} of $${CAP.toFixed(2)}`,
].join('\n')
writeFileSync(`${DURABLE}/report.txt`, report)
console.log(report)
if (BLOCKED) process.exitCode = 1
