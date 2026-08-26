// LIVE (Phase B step 2) — cap $PROBE_CAP (default $0.50). Guided-vs-unguided strip probe on sw.
// Shares gen-character-v3.ts cache keys and judge refs so the full run reuses the paid raws.
// If both candidates fail twice it exits 2 rather than shipping a flagged strip.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { BudgetGuard, BudgetExceededError } from '../src/budget.js'
import { makeVlmJudge, type JudgeFn } from '../src/judge.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { renderCheckerGuide, renderStripFrameGuide } from '../src/guides.js'
import {
  FACING_CLAUSES,
  STRIP_POSES_V2,
  WALK_POSES_V2,
  POSE_CLAUSES_V2,
  CELL_V2,
  FEET_Y_V2,
  type StripPoseV2,
  type WalkPoseV2,
  sliceStrip,
  estimatePitch,
  v7Chain,
  opaqueBbox,
  anchorToCanvas,
  registerToReference,
  strideGate,
  frameCoherenceGate,
  upscaleNearest,
  type GateFailure,
} from '../src/sheet.js'
import { CHAR_DESC, ASYMMETRY_CLAUSE, BIG_PIXEL } from './character.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.PROBE_CAP ?? '0.5')
const budget = new BudgetGuard(CAP)
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'
const RESERVE = 0.046

const conceptIdx = process.argv.indexOf('--concept')
const CONCEPT = conceptIdx >= 0 ? readFileSync(process.argv[conceptIdx + 1]!) : null

const SCRATCH = scratch('c5')
const DURABLE = `${SCRATCH}/character-v3`
const CACHE = `${DURABLE}/candidates`
const PROBE = `${DURABLE}/probe`
for (const d of [CACHE, `${PROBE}/unguided`, `${PROBE}/guided`]) mkdirSync(d, { recursive: true })

const STYLE_ANCHOR = readFileSync('packages/forge/content/reference/style-anchor.png')
const IDENTITY = readFileSync(`${SCRATCH}/character-sheet-v2/raws/idle-sw.png`)
const REFS: Buffer[] = [STYLE_ANCHOR, ...(CONCEPT ? [CONCEPT] : []), IDENTITY]
const GUIDE_REFS: Buffer[] = [
  await encodePng(renderCheckerGuide()),
  await encodePng(renderStripFrameGuide()),
]

const judge: JudgeFn = makeVlmJudge({ apiKey: KEY, refSheets: REFS })

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

const HARDEN = ' Five separate complete figures, none cropped, evenly spaced, identical character.'
const PROVISIONAL_MEDIAN = 0.31

function stripPrompt(hardened: boolean): string {
  const phases = STRIP_POSES_V2.map((p, i) => `frame ${i + 1}: ${POSE_CLAUSES_V2[p]}`).join('; ')
  return (
    `${STYLE_PROMPT} A horizontal sprite strip of exactly FIVE copies of the SAME character side by side, ` +
    `evenly spaced with clear magenta gaps between figures, whole body visible in each. Every figure is ` +
    `${FACING_CLAUSES.sw}. Left to right: ${phases}. The five figures are identical in costume, colors and ` +
    `proportions — only the pose changes. Subject: ${CHAR_DESC}. ${ASYMMETRY_CLAUSE} ${BIG_PIXEL}` +
    (hardened ? HARDEN : '')
  )
}

async function generate(prompt: string, refs: Buffer[]): Promise<Buffer> {
  budget.spend(RESERVE)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size: '1024x1024',
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
  return Buffer.from(b64, 'base64')
}

type ProbeResult = {
  key: string
  guided: boolean
  score: number
  notes: string
  sliced: boolean
  sliceError?: string
  pitch?: number
  pitchSpread?: number
  failures?: GateFailure[]
  cells?: Record<StripPoseV2, RawImage>
}

function place(img: RawImage): RawImage {
  return anchorToCanvas(img, CELL_V2, CELL_V2, FEET_Y_V2)
}

// mirrors gen-character-v3.ts processStrip (not exported there)
function processStrip(keyedStrip: RawImage): {
  cells: Record<StripPoseV2, RawImage>
  pitch: number
  pitchSpread: number
} {
  const segments = sliceStrip(keyedStrip, STRIP_POSES_V2.length)
  const pitches = segments.map((s) => estimatePitch(s))
  const sorted = [...pitches].sort((a, b) => a - b)
  const pitch = sorted[Math.floor(sorted.length / 2)]!
  const outs = segments.map((s) => v7Chain(s, pitch).out)
  const cells = {} as Record<StripPoseV2, RawImage>
  const idle = place(outs[0]!)
  cells.idle = idle
  for (let i = 1; i < STRIP_POSES_V2.length; i++) {
    const placed = place(outs[i]!)
    const { dx } = registerToReference(idle, placed)
    if (dx === 0) {
      cells[STRIP_POSES_V2[i]!] = placed
      continue
    }
    const b = opaqueBbox(placed)!
    if (b.x0 + dx < 0 || b.x1 + dx >= CELL_V2)
      throw new Error(`registration dx=${dx} pushes sprite off canvas`)
    const shifted = new Uint8ClampedArray(CELL_V2 * CELL_V2 * 4)
    for (let y = 0; y < CELL_V2; y++)
      for (let x = b.x0; x <= b.x1; x++) {
        const s = (y * CELL_V2 + x) * 4
        if (placed.data[s + 3] === 0) continue
        shifted.set(placed.data.subarray(s, s + 4), (y * CELL_V2 + x + dx) * 4)
      }
    cells[STRIP_POSES_V2[i]!] = { width: CELL_V2, height: CELL_V2, data: shifted }
  }
  return { cells, pitch, pitchSpread: sorted[sorted.length - 1]! - sorted[0]! }
}

async function probe(key: string, guided: boolean, hardened: boolean): Promise<ProbeResult> {
  const rawPath = `${CACHE}/${key}.png`
  let raw: Buffer
  if (existsSync(rawPath)) {
    raw = readFileSync(rawPath)
    console.log(`${key}: reusing cached raw`)
  } else {
    raw = await generate(stripPrompt(hardened), guided ? [...REFS, ...GUIDE_REFS] : REFS)
    writeFileSync(rawPath, raw)
    console.log(
      `${key}: generated (${guided ? 'guided' : 'unguided'}${hardened ? ', hardened' : ''}), total spend $${budget.total.toFixed(3)}`,
    )
  }
  let v = scores[key]
  if (!v) {
    v = await judge(raw)
    scores[key] = v
    writeFileSync(SCORES_PATH, JSON.stringify(scores, null, 1))
  }
  const base: ProbeResult = { key, guided, score: v.score, notes: v.notes, sliced: false }
  try {
    const { cells, pitch, pitchSpread } = processStrip(chromaKey(await decodePng(raw)))
    const walk = Object.fromEntries(WALK_POSES_V2.map((p) => [p, cells[p]])) as Record<
      WalkPoseV2,
      RawImage
    >
    const failures = [
      ...strideGate('sw', walk, PROVISIONAL_MEDIAN),
      ...frameCoherenceGate(
        'sw',
        cells.idle,
        WALK_POSES_V2.map((p) => ({ label: p, img: cells[p] })),
      ),
    ]
    return { ...base, sliced: true, pitch, pitchSpread, failures, cells }
  } catch (e) {
    return { ...base, sliceError: String(e) }
  }
}

const fmt = (r: ProbeResult) =>
  !r.sliced
    ? `${r.key} (${r.guided ? 'guided' : 'unguided'}) score=${r.score} — SLICE/PROCESS FAILED: ${r.sliceError}`
    : `${r.key} (${r.guided ? 'guided' : 'unguided'}) score=${r.score} pitch=${r.pitch!.toFixed(2)}±${r.pitchSpread!.toFixed(2)} ` +
      `gates=${r.failures!.length === 0 ? 'PASS' : r.failures!.map((x) => `${x.gate} ${x.a}~${x.b} ${x.value.toFixed(3)} vs ${x.limit.toFixed(3)}`).join('; ')}`

const failed = (r: ProbeResult) => !r.sliced || r.failures!.length > 0

const lines: string[] = ['== strip probe: sw, guided vs unguided (provisional median 0.310) ==']
let results: ProbeResult[]
try {
  results = [
    await probe('strip-sw-a0-c0', false, false),
    await probe('strip-sw-a0-c1', true, false),
  ]
} catch (e) {
  if (e instanceof BudgetExceededError) {
    console.log('probe budget exhausted before both candidates')
    process.exit(2)
  }
  throw e
}
lines.push(...results.map(fmt))

if (results.every(failed)) {
  lines.push('', 'both initial candidates failed — hardened retry (once each)')
  try {
    results = [
      await probe('probe-hard-sw-c0', false, true),
      await probe('probe-hard-sw-c1', true, true),
    ]
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      lines.push('budget exhausted during hardened retry')
    } else throw e
  }
  lines.push(...results.map(fmt))
  if (results.every(failed)) {
    lines.push(
      '',
      '** BLOCKED-STRIPS: both strips fail slicing/coherence after hardened retries — stop, escalate to image-to-video **',
      `total spend: $${budget.total.toFixed(3)} of $${CAP.toFixed(2)}`,
    )
    writeFileSync(`${PROBE}/probe-report.txt`, lines.join('\n'))
    console.log(lines.join('\n'))
    process.exit(2)
  }
}

// persist processed cells for whichever candidates sliced
for (const r of results) {
  if (!r.cells) continue
  const dir = `${PROBE}/${r.guided ? 'guided' : 'unguided'}`
  for (const p of STRIP_POSES_V2) {
    writeFileSync(`${dir}/${p}-sw.png`, await encodePng(r.cells[p]))
    writeFileSync(`${dir}/${p}-sw-4x.png`, await encodePng(upscaleNearest(r.cells[p], 4)))
  }
}

// verdict: gate outcome first, then measured pitch cleanliness (spread), then judge score
const [u, g] = [results.find((r) => !r.guided)!, results.find((r) => r.guided)!]
let verdict: string
if (failed(u) !== failed(g)) verdict = failed(u) ? 'guided' : 'unguided'
else if (u.sliced && g.sliced && Math.abs(u.pitchSpread! - g.pitchSpread!) > 0.1)
  verdict = u.pitchSpread! < g.pitchSpread! ? 'unguided' : 'guided'
else verdict = g.score > u.score ? 'guided' : 'unguided'
lines.push(
  '',
  `VERDICT: ${verdict}`,
  `total spend: $${budget.total.toFixed(3)} of $${CAP.toFixed(2)}`,
)
writeFileSync(`${PROBE}/probe-report.txt`, lines.join('\n'))
console.log(lines.join('\n'))
