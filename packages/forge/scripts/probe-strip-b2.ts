// LIVE (Phase B2) — cap $PROBE_CAP (default $0.30). Wide-canvas sw strip probe; the first
// request doubles as the size probe: 1536x512, retried as aspect_ratio '3:1' on a rejection.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { BudgetGuard, BudgetExceededError } from '../src/budget.js'
import { makeVlmJudge, type JudgeFn } from '../src/judge.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { renderCheckerGuide, renderStripFrameGuide } from '../src/guides.js'
import {
  FACING_CLAUSES, STRIP_POSES_V2, WALK_POSES_V2, POSE_CLAUSES_V2,
  CELL_V2, FEET_Y_V2, type StripPoseV2, type WalkPoseV2,
  sliceStrip, estimatePitch, v7Chain, opaqueBbox, anchorToCanvas, registerToReference,
  strideGate, frameCoherenceGate, upscaleNearest, downscaleMajority, type GateFailure,
} from '../src/sheet.js'
import { CHAR_DESC, ASYMMETRY_CLAUSE, BIG_PIXEL } from './character.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.PROBE_CAP ?? '0.3')
const budget = new BudgetGuard(CAP)
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'
const RESERVE = 0.046

const conceptIdx = process.argv.indexOf('--concept')
const CONCEPT = conceptIdx >= 0 ? readFileSync(process.argv[conceptIdx + 1]!) : null

const SCRATCH = scratch('c5')
const DURABLE = `${SCRATCH}/character-v3`
const CACHE = `${DURABLE}/candidates`
const PROBE = `${DURABLE}/probe-wide`
for (const d of [CACHE, `${PROBE}/unguided`, `${PROBE}/guided`]) mkdirSync(d, { recursive: true })

const STYLE_ANCHOR = readFileSync('packages/forge/content/reference/style-anchor.png')
const IDENTITY = readFileSync(`${SCRATCH}/character-sheet-v2/raws/idle-sw.png`)
const REFS: Buffer[] = [STYLE_ANCHOR, ...(CONCEPT ? [CONCEPT] : []), IDENTITY]
const GUIDE_REFS: Buffer[] = [await encodePng(renderCheckerGuide()), await encodePng(renderStripFrameGuide())]
const judge: JudgeFn = makeVlmJudge({ apiKey: KEY, refSheets: REFS })

const SCORES_PATH = `${CACHE}/scores.json`
const scores: Record<string, { score: number; notes: string }> = (() => {
  try { return JSON.parse(readFileSync(SCORES_PATH, 'utf8')) } catch { return {} }
})()

const PROVISIONAL_MEDIAN = 0.310

// margin=true shrinks the figures: wide-canvas gens draw full-frame-height figures
// whose native art (~92-97 px) overflows the 88-row feet budget of the 96 cell.
function stripPrompt(margin: boolean): string {
  const phases = STRIP_POSES_V2.map((p, i) => `frame ${i + 1}: ${POSE_CLAUSES_V2[p]}`).join('; ')
  return `${STYLE_PROMPT} A horizontal sprite strip of exactly FIVE copies of the SAME character side by side, ` +
    `evenly spaced with clear magenta gaps between figures, whole body visible in each. Every figure is ` +
    `${FACING_CLAUSES['sw']}. Left to right: ${phases}. The five figures are identical in costume, colors and ` +
    `proportions — only the pose changes. Subject: ${CHAR_DESC}. ${ASYMMETRY_CLAUSE} ${BIG_PIXEL}` +
    (margin ? ' Each figure stands about three quarters of the frame height tall, with clear magenta margin ' +
      'above and below every figure; figures must NOT touch the top or bottom edge of the image.' : '')
}

// One request; sizeParams merged into the body. Distinguishes a param rejection
// (HTTP 4xx BEFORE billing — budget released) from success (image billed + returned).
type GenOutcome = { ok: true; raw: Buffer } | { ok: false; status: number; error: string }
async function tryGenerate(prompt: string, refs: Buffer[], sizeParams: Record<string, string>): Promise<GenOutcome> {
  budget.spend(RESERVE)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, prompt, ...sizeParams, response_format: 'b64_json',
      input_references: refs.map(r => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${r.toString('base64')}` } })),
      usage: { include: true },
    }),
  })
  if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).slice(0, 500) }
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const b64 = json.data?.[0]?.b64_json
  if (!b64) return { ok: false, status: res.status, error: 'no data[0].b64_json' }
  const costUsd = json.usage?.cost ?? RESERVE
  if (costUsd > RESERVE) budget.spend(costUsd - RESERVE)
  return { ok: true, raw: Buffer.from(b64, 'base64') }
}

// Coarsen-to-fit (v1 postProcessCell parity): gemini draws this character at
// ~90-113 native art px tall; the 96 cell with feet at y=88 budgets 89 rows.
// Majority-downscale keeps the vote-based reduction the v1 sheet shipped with.
const MAX_ART_H = FEET_Y_V2 + 1
function fitToBudget(img: RawImage): RawImage {
  const k = Math.min(MAX_ART_H / img.height, CELL_V2 / img.width, 1)
  if (k === 1) return img
  return downscaleMajority(img,
    Math.min(CELL_V2, Math.max(1, Math.round(img.width * k))),
    Math.min(MAX_ART_H, Math.max(1, Math.round(img.height * k))))
}
function place(img: RawImage): RawImage { return anchorToCanvas(fitToBudget(img), CELL_V2, CELL_V2, FEET_Y_V2) }

function processStrip(keyedStrip: RawImage): { cells: Record<StripPoseV2, RawImage>; pitch: number; pitchSpread: number } {
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

const lines: string[] = ['== phase B2 rung 1: wide-canvas sw strip probe ==']

// ── size-support probe: the first real generation attempt doubles as the probe ──
let sizeParams: Record<string, string> | null = null
let firstRaw: Buffer | null = null
const w0c0Path = `${CACHE}/strip-sw-w0-c0.png`
if (existsSync(w0c0Path)) {
  firstRaw = readFileSync(w0c0Path)
  sizeParams = { size: '1536x512' }
  lines.push('strip-sw-w0-c0: reusing cached raw (size support previously proven)')
} else {
  for (const params of [{ size: '1536x512' }, { aspect_ratio: '3:1' }] as Record<string, string>[]) {
    const r = await tryGenerate(stripPrompt(false), REFS, params)
    if (r.ok) {
      sizeParams = params
      firstRaw = r.raw
      writeFileSync(w0c0Path, r.raw)
      lines.push(`size probe: ${JSON.stringify(params)} ACCEPTED — strip-sw-w0-c0 generated (unguided), total spend $${budget.total.toFixed(3)}`)
      break
    }
    lines.push(`size probe: ${JSON.stringify(params)} REJECTED — HTTP ${r.status}: ${r.error}`)
  }
}
if (!sizeParams || !firstRaw) {
  lines.push('', 'RUNG 1 UNAVAILABLE: no wide-canvas request shape accepted — fall through to rung 2')
  writeFileSync(`${PROBE}/probe-wide-report.txt`, lines.join('\n'))
  console.log(lines.join('\n'))
  process.exit(3)
}

// one cached-or-generated candidate on the accepted shape
async function candidateRaw(key: string, guided: boolean, margin: boolean): Promise<Buffer | null> {
  const path = `${CACHE}/${key}.png`
  if (existsSync(path)) { lines.push(`${key}: reusing cached raw`); return readFileSync(path) }
  try {
    const r = await tryGenerate(stripPrompt(margin), guided ? [...REFS, ...GUIDE_REFS] : REFS, sizeParams!)
    if (!r.ok) { lines.push(`${key}: HTTP ${r.status}: ${r.error}`); return null }
    writeFileSync(path, r.raw)
    lines.push(`${key} generated (${guided ? 'guided' : 'unguided'}${margin ? ', margin' : ''}), total spend $${budget.total.toFixed(3)}`)
    return r.raw
  } catch (e) {
    if (e instanceof BudgetExceededError) { lines.push(`${key}: SKIPPED (budget)`); return null }
    throw e
  }
}
const guidedRaw = await candidateRaw('strip-sw-w0-c1', true, false)

type R = {
  key: string; guided: boolean; score: number; notes: string
  sliced: boolean; sliceError?: string; pitch?: number; pitchSpread?: number
  failures?: GateFailure[]; cells?: Record<StripPoseV2, RawImage>
}
async function assess(key: string, raw: Buffer, guided: boolean): Promise<R> {
  let v = scores[key]
  if (!v) {
    v = await judge(raw)
    scores[key] = v
    writeFileSync(SCORES_PATH, JSON.stringify(scores, null, 1))
  }
  const base: R = { key, guided, score: v.score, notes: v.notes, sliced: false }
  try {
    const { cells, pitch, pitchSpread } = processStrip(chromaKey(await decodePng(raw)))
    const walk = Object.fromEntries(WALK_POSES_V2.map(p => [p, cells[p]])) as Record<WalkPoseV2, RawImage>
    const failures = [
      ...strideGate('sw', walk, PROVISIONAL_MEDIAN),
      ...frameCoherenceGate('sw', cells['idle'], WALK_POSES_V2.map(p => ({ label: p, img: cells[p] }))),
    ]
    return { ...base, sliced: true, pitch, pitchSpread, failures, cells }
  } catch (e) { return { ...base, sliceError: String(e) } }
}

let results: R[] = [await assess('strip-sw-w0-c0', firstRaw, false)]
if (guidedRaw) results.push(await assess('strip-sw-w0-c1', guidedRaw, true))

const failed0 = (r: R) => !r.sliced || r.failures!.length > 0
const fmtEarly = (r: R) => !r.sliced
  ? `${r.key} (${r.guided ? 'guided' : 'unguided'}) score=${r.score} — SLICE/PROCESS FAILED: ${r.sliceError}`
  : `${r.key} (${r.guided ? 'guided' : 'unguided'}) score=${r.score} pitch=${r.pitch!.toFixed(2)}±${r.pitchSpread!.toFixed(2)} ` +
    `gates=${r.failures!.length === 0 ? 'PASS' : r.failures!.map(x => `${x.gate} ${x.a}~${x.b} ${x.value.toFixed(3)} vs ${x.limit.toFixed(3)}`).join('; ')}`
// margin retry (w1): full-frame figures overflow the 88-row art budget — regenerate
// once per mode with the margin clause when no w0 candidate fits/passes
if (results.every(failed0)) {
  lines.push(...results.map(fmtEarly), '', 'w0 candidates failed placement/gates — margin retry (w1)')
  const w1: R[] = []
  for (const [key, guided] of [['strip-sw-w1-c0', false], ['strip-sw-w1-c1', true]] as const) {
    const raw = await candidateRaw(key, guided, true)
    if (raw) w1.push(await assess(key, raw, guided))
  }
  if (w1.length > 0) results = w1
}

const fmt = (r: R) => !r.sliced
  ? `${r.key} (${r.guided ? 'guided' : 'unguided'}) score=${r.score} — SLICE/PROCESS FAILED: ${r.sliceError}`
  : `${r.key} (${r.guided ? 'guided' : 'unguided'}) score=${r.score} pitch=${r.pitch!.toFixed(2)}±${r.pitchSpread!.toFixed(2)} ` +
    `gates=${r.failures!.length === 0 ? 'PASS' : r.failures!.map(x => `${x.gate} ${x.a}~${x.b} ${x.value.toFixed(3)} vs ${x.limit.toFixed(3)}`).join('; ')}`
lines.push(...results.map(fmt))

for (const r of results) {
  if (!r.cells) continue
  const dir = `${PROBE}/${r.guided ? 'guided' : 'unguided'}`
  for (const p of STRIP_POSES_V2) {
    writeFileSync(`${dir}/${p}-sw.png`, await encodePng(r.cells[p]))
    writeFileSync(`${dir}/${p}-sw-4x.png`, await encodePng(upscaleNearest(r.cells[p], 4)))
  }
}

const failed = (r: R) => !r.sliced || r.failures!.length > 0
const ok = results.filter(r => !failed(r))
let verdict: string
if (ok.length === 0) verdict = 'RUNG1-FAILED: no wide candidate passed slicing+gates — fall through to rung 2'
else if (ok.length === 1) verdict = ok[0]!.guided ? 'guided' : 'unguided'
else {
  const [u, g] = [results.find(r => !r.guided)!, results.find(r => r.guided)!]
  verdict = Math.abs(u.pitchSpread! - g.pitchSpread!) > 0.10
    ? (u.pitchSpread! < g.pitchSpread! ? 'unguided' : 'guided')
    : (g.score > u.score ? 'guided' : 'unguided')
}
lines.push('', `accepted request shape: ${JSON.stringify(sizeParams)}`, `VERDICT: ${verdict}`,
  `total spend: $${budget.total.toFixed(3)} of $${CAP.toFixed(2)}`)
writeFileSync(`${PROBE}/probe-wide-report.txt`, lines.join('\n'))
console.log(lines.join('\n'))
if (ok.length === 0) process.exitCode = 3
