// LIVE (Asset Standard v3, mirror standard) — cap $V4_CAP (default $1.50).
// 4 paid call groups: (1) master sheet — ONE image, two figures (front ¾ + back ¾) on
// magenta, reasoning path when the API accepts it, FINAL image only; (2-3) per authored
// facing a 1×4 wide-canvas strip (idle, contact-a, passing, contact-b) with the master
// attached; (4) ONE sleep pose. SW/NW/passing-b/sleep variants derive in code (mirror.ts).
// Gates: within-strip stride + ONE coherence gate vs master. Facing gate = HUMAN EYEBALL
// on the contact sheet + GIFs — this script never claims facing sign-off.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'
import { BudgetGuard, BudgetExceededError } from '../src/budget.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import {
  FACINGS, POSES_V2, CELL_V2, FEET_Y_V2, type Facing, type PoseV2,
  sliceStrip, estimatePitch, v7Chain, opaqueBbox, anchorToCanvas, registerToReference,
  assembleGrid, upscaleNearest, downscaleMajority, cellDistance, pairwiseMedian,
  type GateFailure,
} from '../src/sheet.js'
import {
  AUTHORED_FACINGS, STRIP_POSES_V4, WALK_CYCLE_V4, WALK_FRAME_MS,
  deriveSheet, strideGateV4, coherenceGateV4, sleepCoherenceGateV4,
  type AuthoredFacing, type StripPoseV4,
} from '../src/mirror.js'
import { CHAR_DESC_V4, FEATURE_CAP_V4, BIG_PIXEL } from './character.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.V4_CAP ?? '1.5')
const budget = new BudgetGuard(CAP)
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'
const RESERVE = 0.046

const SCRATCH = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5'
const DURABLE = `${SCRATCH}/character-v4`
for (const d of [`${DURABLE}/raws`, `${DURABLE}/cells`, `${DURABLE}/master`, `${DURABLE}/gifs`]) mkdirSync(d, { recursive: true })

const STYLE_ANCHOR = readFileSync('packages/forge/content/reference/style-anchor.png')
const CONCEPT = readFileSync(`${SCRATCH}/concept/concept-c1.png`)

class OutOfBudget extends Error {}

// masterMode records which path actually served the master (returned in the report):
// 'flash-reasoning' | 'flash-plain' (reasoning param rejected → plain fallback).
let masterMode = ''

type GenResult = { raw: Buffer; images: number }

async function generate(prompt: string, refs: Buffer[], size: string, reasoning: boolean): Promise<GenResult> {
  try { budget.spend(RESERVE) } catch (e) {
    if (e instanceof BudgetExceededError) throw new OutOfBudget(e.message)
    throw e
  }
  const body: Record<string, unknown> = {
    model: MODEL, prompt, size, response_format: 'b64_json',
    input_references: refs.map(r => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${r.toString('base64')}` } })),
    usage: { include: true },
  }
  if (reasoning) body.reasoning = { effort: 'high' }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${MODEL}${reasoning ? '+reasoning' : ''} HTTP ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const images = (json.data ?? []).filter(d => d.b64_json)
  // Reasoning models may return interim thought images — the FINAL image is the last one.
  const b64 = images[images.length - 1]?.b64_json
  if (!b64) throw new Error(`${MODEL}: no b64_json in data[] (${json.data?.length ?? 0} entries)`)
  const costUsd = json.usage?.cost ?? RESERVE
  if (costUsd > RESERVE) {
    try { budget.spend(costUsd - RESERVE) } catch (e) {
      if (e instanceof BudgetExceededError) throw new OutOfBudget(e.message)
      throw e
    }
  }
  return { raw: Buffer.from(b64, 'base64'), images: images.length }
}

// Crash-proof raw cache; no judge, no scores — candidate choice is mechanical.
async function candidate(key: string, prompt: string, refs: Buffer[], size: string, reasoning: boolean): Promise<Buffer> {
  const rawPath = `${DURABLE}/raws/${key}.png`
  if (existsSync(rawPath)) { console.log(`  ${key}: reusing cached raw`); return readFileSync(rawPath) }
  const r = await generate(prompt, refs, size, reasoning)
  writeFileSync(rawPath, r.raw)
  console.log(`  ${key}: generated (${r.images} image${r.images === 1 ? '' : 's'} returned), total spend $${budget.total.toFixed(3)}`)
  return r.raw
}

// ── prompts: views, never compass prose (cookbook technique 1) ──────────────
const VIEW: Record<AuthoredFacing, string> = {
  se: 'front three-quarter view, facing bottom-right',
  ne: 'back three-quarter view seen from behind, facing top-right, back of the head visible, NO face visible',
}
const VIEW_REF: Record<AuthoredFacing, string> = {
  se: 'the LEFT figure of the last reference image',
  ne: 'the RIGHT figure of the last reference image',
}
const POSE_V4: Record<StripPoseV4, string> = {
  'idle': 'standing at rest, both feet planted, arms relaxed at the sides',
  'contact-a': 'walk cycle CONTACT pose A: legs at full stride spread, one foot planted forward, the other back with heel lifting, opposite arm swung forward',
  'passing': 'walk cycle PASSING pose: legs close together, one foot lifted and passing under the body, the other leg planted straight, arms near the sides',
  'contact-b': 'walk cycle CONTACT pose B: legs at full stride spread, the OTHER foot planted forward this time, its opposite arm swung forward',
}

const masterPrompt =
  `${STYLE_PROMPT} Exactly TWO figures of the SAME character side by side on the magenta background, ` +
  `evenly spaced with a clear magenta gap between them, whole body and feet visible on both. ` +
  `LEFT figure: ${VIEW.se}. RIGHT figure: ${VIEW.ne}. ` +
  `The two figures are identical in costume, colors and proportions — only the view changes. ` +
  `Subject: ${CHAR_DESC_V4}. ${FEATURE_CAP_V4} ${BIG_PIXEL} ` +
  'Each figure stands about three quarters of the frame height tall, with clear magenta margin ' +
  'above and below; figures must NOT touch the edges of the image.'

function stripPrompt(f: AuthoredFacing): string {
  const phases = STRIP_POSES_V4.map((p, i) => `frame ${i + 1}: ${POSE_V4[p]}`).join('; ')
  return `${STYLE_PROMPT} A horizontal sprite strip of exactly FOUR copies of the SAME character side by side, ` +
    `evenly spaced with clear magenta gaps between figures, whole body visible in each. Every figure is the ` +
    `${VIEW[f]} — exactly the same character, costume and colors as ${VIEW_REF[f]}. ` +
    `Left to right: ${phases}. The four figures are identical in costume, colors and proportions — only the ` +
    `pose changes. Subject: ${CHAR_DESC_V4}. ${FEATURE_CAP_V4} ${BIG_PIXEL}` +
    ' Each figure stands about three quarters of the frame height tall, with clear magenta margin above and ' +
    'below every figure; figures must NOT touch the top or bottom edge of the image.'
}

const sleepPrompt =
  `${STYLE_PROMPT} A single character sprite, exactly one figure — exactly the same character, costume and ` +
  `colors as the figures in the last reference image. The character is lying on the ground fast asleep, body ` +
  `fully horizontal, eyes closed, relaxed peaceful face, same outfit. ` +
  `Subject: ${CHAR_DESC_V4}. ${FEATURE_CAP_V4} ${BIG_PIXEL}`

// ── post chain (surviving stages only): chroma key → slice → v7 → place ─────
const MAX_ART_H = FEET_Y_V2 + 1
function fitToBudget(img: RawImage): RawImage {
  const k = Math.min(MAX_ART_H / img.height, CELL_V2 / img.width, 1)
  if (k === 1) return img
  return downscaleMajority(img,
    Math.min(CELL_V2, Math.max(1, Math.round(img.width * k))),
    Math.min(MAX_ART_H, Math.max(1, Math.round(img.height * k))))
}
function place(img: RawImage): RawImage {
  return anchorToCanvas(fitToBudget(img), CELL_V2, CELL_V2, FEET_Y_V2)
}

function processStrip(keyedStrip: RawImage): Record<StripPoseV4, RawImage> {
  const segments = sliceStrip(keyedStrip, STRIP_POSES_V4.length)
  const pitches = segments.map(s => estimatePitch(s)).sort((a, b) => a - b)
  const pitch = pitches[Math.floor(pitches.length / 2)]!
  const outs = segments.map(s => v7Chain(s, pitch).out)
  const cells = {} as Record<StripPoseV4, RawImage>
  const idle = place(outs[0]!)
  cells['idle'] = idle
  for (let i = 1; i < STRIP_POSES_V4.length; i++) {
    const placed = place(outs[i]!)
    const { dx } = registerToReference(idle, placed)
    if (dx === 0) { cells[STRIP_POSES_V4[i]!] = placed; continue }
    const b = opaqueBbox(placed)!
    if (b.x0 + dx < 0 || b.x1 + dx >= CELL_V2) throw new Error(`registration dx=${dx} pushes sprite off canvas`)
    const shifted = new Uint8ClampedArray(CELL_V2 * CELL_V2 * 4)
    for (let y = 0; y < CELL_V2; y++) for (let x = b.x0; x <= b.x1; x++) {
      const s = (y * CELL_V2 + x) * 4
      if (placed.data[s + 3] === 0) continue
      shifted.set(placed.data.subarray(s, s + 4), (y * CELL_V2 + x + dx) * 4)
    }
    cells[STRIP_POSES_V4[i]!] = { width: CELL_V2, height: CELL_V2, data: shifted }
  }
  return cells
}

const reportLines: string[] = []
// Stride/coherence ratios are ×median; fixed at the v1-calibrated cross-facing 0.310
// (a within-strip median would be self-referential). Final measured median is reported.
const CALIBRATED_MEDIAN = 0.310

// ── call 1: master (2 candidates, reasoning path first, plain flash fallback) ─
type Master = { key: string; raw: Buffer; cells: Record<AuthoredFacing, RawImage>; frontBackDist: number }
async function pickMaster(): Promise<Master> {
  const chosen: Master[] = []
  for (let i = 0; i < 2; i++) {
    const key = `master-c${i}`
    let raw: Buffer
    if (!masterMode && !existsSync(`${DURABLE}/raws/${key}.png`)) {
      // Probe the reasoning path on the first real call; on rejection fall back to plain.
      try {
        raw = await candidate(key, masterPrompt, [STYLE_ANCHOR, CONCEPT], '1024x1024', true)
        masterMode = 'flash-reasoning'
      } catch (e) {
        if (e instanceof OutOfBudget) throw e
        console.log(`  reasoning path rejected (${String(e).slice(0, 200)}); falling back to plain flash`)
        raw = await candidate(key, masterPrompt, [STYLE_ANCHOR, CONCEPT], '1024x1024', false)
        masterMode = 'flash-plain'
      }
    } else {
      raw = await candidate(key, masterPrompt, [STYLE_ANCHOR, CONCEPT], '1024x1024', masterMode === 'flash-reasoning')
      if (!masterMode) masterMode = 'cached (mode of original run unknown)'
    }
    try {
      const segs = sliceStrip(chromaKey(await decodePng(raw)), 2)
      const cells = {
        se: place(v7Chain(segs[0]!, estimatePitch(segs[0]!)).out),
        ne: place(v7Chain(segs[1]!, estimatePitch(segs[1]!)).out),
      }
      const d = cellDistance(cells.se, cells.ne)
      reportLines.push(`${key}: sliced OK, front-back distance=${d.toFixed(3)}`)
      chosen.push({ key, raw, cells, frontBackDist: d })
    } catch (e) {
      reportLines.push(`${key}: process FAILED — ${String(e)}`)
    }
  }
  if (chosen.length === 0) throw new Error('master: both candidates failed to slice into two figures')
  chosen.sort((a, b) => b.frontBackDist - a.frontBackDist)
  return chosen[0]!
}

console.log('master')
const master = await pickMaster()
reportLines.push(`master chosen: ${master.key} (mode=${masterMode})`)
writeFileSync(`${DURABLE}/master/master.png`, master.raw)
writeFileSync(`${DURABLE}/master/master-se.png`, await encodePng(master.cells.se))
writeFileSync(`${DURABLE}/master/master-ne.png`, await encodePng(master.cells.ne))

// ── calls 2-3: authored strips (2 candidates + 1 retry round of 2) ───────────
type StripState = { key: string; cells: Record<StripPoseV4, RawImage>; failures: GateFailure[] }

function stripFailures(f: AuthoredFacing, cells: Record<StripPoseV4, RawImage>): GateFailure[] {
  return [
    ...strideGateV4(f, cells, CALIBRATED_MEDIAN),
    ...STRIP_POSES_V4.flatMap(p => coherenceGateV4(`${f}/${p}`, master.cells[f], cells[p])),
  ]
}

async function pickStrip(f: AuthoredFacing): Promise<StripState> {
  let best: StripState | null = null
  for (let attempt = 0; attempt <= 1; attempt++) {
    for (let i = 0; i < 2; i++) {
      const key = `strip-${f}-a${attempt}-c${i}`
      let state: StripState
      try {
        const raw = await candidate(key, stripPrompt(f), [STYLE_ANCHOR, master.raw], '1536x512', false)
        state = { key, cells: processStrip(chromaKey(await decodePng(raw))), failures: [] }
        state.failures = stripFailures(f, state.cells)
      } catch (e) {
        if (e instanceof OutOfBudget) { if (best) return best; throw e }
        reportLines.push(`${key}: process FAILED — ${String(e)}`)
        continue
      }
      reportLines.push(`${key}: gates=${state.failures.length === 0 ? 'PASS' : state.failures.map(x => `${x.gate}(${x.a}~${x.b} ${x.value.toFixed(3)})`).join(',')}`)
      if (state.failures.length === 0) return state
      if (!best || state.failures.length < best.failures.length) best = state
    }
  }
  if (!best) throw new Error(`${f}: every strip candidate failed processing`)
  return best
}

const strips = {} as Record<AuthoredFacing, StripState>
for (const f of AUTHORED_FACINGS) {
  console.log(`strip ${f}`)
  strips[f] = await pickStrip(f)
}

// ── call 4: ONE sleep pose (1 candidate + 1 retry) ───────────────────────────
async function pickSleep(): Promise<{ key: string; cell: RawImage; failures: GateFailure[] }> {
  let best: { key: string; cell: RawImage; failures: GateFailure[] } | null = null
  for (let attempt = 0; attempt <= 1; attempt++) {
    const key = `sleep-a${attempt}`
    try {
      const raw = await candidate(key, sleepPrompt, [STYLE_ANCHOR, master.raw], '512x512', false)
      const keyed = chromaKey(await decodePng(raw))
      const cell = place(v7Chain(keyed, estimatePitch(keyed)).out)
      const failures = sleepCoherenceGateV4(master.cells.se, cell)
      reportLines.push(`${key}: gates=${failures.length === 0 ? 'PASS' : failures.map(x => x.gate).join(',')}`)
      if (failures.length === 0) return { key, cell, failures }
      if (!best || failures.length < best.failures.length) best = { key, cell, failures }
    } catch (e) {
      if (e instanceof OutOfBudget) { if (best) return best; throw e }
      reportLines.push(`${key}: process FAILED — ${String(e)}`)
    }
  }
  if (!best) throw new Error('sleep: every candidate failed processing')
  return best
}

console.log('sleep')
const sleep = await pickSleep()

// ── derivation (zero spend): 9 authored cells → the 24-cell contract ─────────
const authoredStrips = { se: strips.se.cells, ne: strips.ne.cells }
const cells = deriveSheet({ strips: authoredStrips, sleep: sleep.cell })
for (const [name, img] of cells) writeFileSync(`${DURABLE}/cells/${name}.png`, await encodePng(img))

const grid = POSES_V2.map((p: PoseV2) => FACINGS.map((f: Facing) => cells.get(`${p}-${f}`)!))
const sheet = assembleGrid(grid, CELL_V2, CELL_V2)
writeFileSync(`${DURABLE}/sheet.png`, await encodePng(sheet))

// ── contact sheet: master + authored strips + sleep + derived flips, 4× ───────
const BLANK: RawImage = { width: CELL_V2, height: CELL_V2, data: new Uint8ClampedArray(CELL_V2 * CELL_V2 * 4) }
const pad = (row: RawImage[], cols: number) => [...row, ...Array(cols - row.length).fill(BLANK) as RawImage[]]
const contactRows: RawImage[][] = [
  pad([master.cells.se, master.cells.ne], 8),
  pad(STRIP_POSES_V4.map(p => strips.se.cells[p]), 8),
  pad(STRIP_POSES_V4.map(p => strips.ne.cells[p]), 8),
  pad([sleep.cell], 8),
  [
    ...(['idle', 'contact-a', 'passing-a', 'contact-b'] as const).map(p => cells.get(`${p}-sw`)!),
    ...(['idle', 'contact-a', 'passing-a', 'contact-b'] as const).map(p => cells.get(`${p}-nw`)!),
  ],
]
const contact = upscaleNearest(assembleGrid(contactRows, CELL_V2, CELL_V2), 4)
writeFileSync(`${DURABLE}/contact-sheet.png`, await encodePng(contact))

// ── 4 walking GIFs: F1-F2-F1-F3 (contact-a → passing → contact-b → passing) ──
for (const f of FACINGS) {
  const frames = WALK_CYCLE_V4.map(p => upscaleNearest(cells.get(`${p === 'passing' ? 'passing-a' : p}-${f}`)!, 4))
  const fw = frames[0]!.width, fh = frames[0]!.height
  const stacked = new Uint8ClampedArray(fw * fh * frames.length * 4)
  frames.forEach((fr, i) => stacked.set(fr.data, fw * fh * 4 * i))
  const gif = await sharp(Buffer.from(stacked.buffer), {
    raw: { width: fw, height: fh * frames.length, channels: 4, pageHeight: fh },
  }).gif({ delay: frames.map(() => WALK_FRAME_MS), loop: 0 }).toBuffer()
  writeFileSync(`${DURABLE}/gifs/walk-${f}.gif`, gif)
}

// ── report (facing verdict deliberately absent: human eyeball only) ──────────
const finalFailures = [...strips.se.failures, ...strips.ne.failures, ...sleep.failures]
const measuredMedian = pairwiseMedian(AUTHORED_FACINGS.flatMap(f => STRIP_POSES_V4.map(p => strips[f].cells[p])))
const report = [
  `== CHARACTER V4 (asset standard v3, mirror): mechanical gates ${finalFailures.length === 0 ? 'PASS' : 'FLAGGED'} ==`,
  'FACING VERDICT: none — human eyeball on contact-sheet.png + gifs/ is the gate.',
  `master mode: ${masterMode}`,
  '', '== candidates ==', ...reportLines,
  '', `chosen: master=${master.key} strips=${strips.se.key},${strips.ne.key} sleep=${sleep.key}`,
  `authored pairwise median (8 standing cells)=${measuredMedian.toFixed(3)} (gate ratios ran against calibrated ${CALIBRATED_MEDIAN})`,
  '', '== remaining gate failures ==',
  ...(finalFailures.length === 0 ? ['none'] : finalFailures.map(x => `${x.gate}  ${x.a} ~ ${x.b}  value=${x.value.toFixed(3)} limit=${x.limit.toFixed(3)}`)),
  '', `total spend: $${budget.total.toFixed(3)} of $${CAP.toFixed(2)}`,
].join('\n')
writeFileSync(`${DURABLE}/report.txt`, report)
console.log(report)
if (finalFailures.length > 0) process.exitCode = 1
