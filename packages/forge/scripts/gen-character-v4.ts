// LIVE (Asset Standard v3, phase 2c) — cap $V4_CAP (default $1.00). USER RULING: cells are
// stored at NATIVE model resolution and the webview scales down.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'
import { BudgetGuard, BudgetExceededError } from '../src/budget.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { decodePng, encodePng, downscaleNearest, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import {
  FACINGS, CELL_V2, FEET_Y_V2,
  sliceStrip, opaqueBbox, anchorToCanvas, assembleGrid, downscaleMajority, pairwiseMedian,
  type GateFailure,
} from '../src/sheet.js'
import {
  AUTHORED_FACINGS, STRIP_POSES_V4, WALK_CYCLE_V4, WALK_FRAME_MS,
  deriveSheet, strideGateV4, coherenceGateV4, sleepCoherenceGateV4,
  type AuthoredFacing, type StripPoseV4,
} from '../src/mirror.js'
import { processHiResCell, normalizeFigureHeight, cellAnchor, buildManifestV4 } from '../src/hires.js'
import { refusalMessage } from '../src/gate.js'
import { CHAR_DESC_V4, FEATURE_CAP_V4, BIG_PIXEL } from './character.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.V4_CAP ?? '1.0')
const budget = new BudgetGuard(CAP)
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'

const SCRATCH = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5'
const DURABLE = `${SCRATCH}/character-v4`
for (const d of [`${DURABLE}/raws`, `${DURABLE}/cells`, `${DURABLE}/master`, `${DURABLE}/gifs`]) mkdirSync(d, { recursive: true })

const STYLE_ANCHOR = readFileSync('packages/forge/content/reference/style-anchor.png')

class OutOfBudget extends Error {}

type GenResult = { raw: Buffer; images: number; cost: number }

// Pre-checks the reserve without committing it (an HTTP failure must not burn budget),
// then records the ACTUAL reported cost. If actual overruns remaining cap the raw is
// still cached (it is paid for) before the hard stop.
async function generate(prompt: string, refs: Buffer[], size: string, reserve: number): Promise<GenResult> {
  if (budget.total + reserve > CAP) throw new OutOfBudget(`reserve $${reserve.toFixed(3)} exceeds remaining cap ($${budget.total.toFixed(3)} of $${CAP} spent)`)
  const body: Record<string, unknown> = {
    model: MODEL, prompt, size, response_format: 'b64_json',
    input_references: refs.map(r => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${r.toString('base64')}` } })),
    usage: { include: true },
  }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${MODEL} HTTP ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const images = (json.data ?? []).filter(d => d.b64_json)
  const b64 = images[images.length - 1]?.b64_json
  if (!b64) throw new Error(`${MODEL}: no b64_json in data[] (${json.data?.length ?? 0} entries)`)
  const cost = json.usage?.cost ?? reserve
  return { raw: Buffer.from(b64, 'base64'), images: images.length, cost }
}

// Crash-proof raw cache; no judge, no scores — candidate choice is mechanical.
async function candidate(key: string, prompt: string, refs: Buffer[], size: string, reserve: number): Promise<Buffer> {
  const rawPath = `${DURABLE}/raws/${key}.png`
  if (existsSync(rawPath)) { console.log(`  ${key}: reusing cached raw`); return readFileSync(rawPath) }
  const r = await generate(prompt, refs, size, reserve)
  writeFileSync(rawPath, r.raw)
  try { budget.spend(r.cost) } catch (e) {
    if (e instanceof BudgetExceededError) { console.log(`  ${key}: cost $${r.cost.toFixed(3)} overran the cap — HARD STOP (raw cached)`); throw new OutOfBudget(e.message) }
    throw e
  }
  console.log(`  ${key}: generated ($${r.cost.toFixed(3)}, ${r.images} image${r.images === 1 ? '' : 's'}), total spend $${budget.total.toFixed(3)}`)
  return r.raw
}

// ── prompts: views, never compass prose ──────────────────────────────────────
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
type WalkPose = Exclude<StripPoseV4, 'idle'>
const WALK_POSES: readonly WalkPose[] = ['contact-a', 'passing', 'contact-b']

function framePrompt(f: AuthoredFacing, p: WalkPose): string {
  return `${STYLE_PROMPT} A single character sprite, exactly ONE figure (count: 1 figure), whole body and ` +
    `feet visible, centered on the magenta background. The figure is the ${VIEW[f]} — exactly the same ` +
    `character, costume and colors as ${VIEW_REF[f]}, with the same chunky pixel look: the visible square ` +
    `pixels must be the SAME SIZE relative to the body as in the reference figure. Pose: ${POSE_V4[p]}. ` +
    `NO text, NO words, NO labels, NO captions. NO shadow under the figure. NO buildings, NO houses, ` +
    `NO scenery, NO ground plane — do NOT draw the building from the first reference image (it is a STYLE ` +
    `reference only). The ONLY content is the single figure on magenta. ` +
    `Subject: ${CHAR_DESC_V4}. ${FEATURE_CAP_V4} ${BIG_PIXEL} ` +
    'The figure stands about four fifths of the frame height tall, with clear magenta margin on all sides; ' +
    'the figure must NOT touch the edges of the image.'
}

// ── chroma key (adaptive tolerance, drift-proofed in phase 2) ─────────────────
function keyBg(img: RawImage): RawImage {
  for (const tolerance of [72, 110]) {
    const keyed = chromaKey(img, { tolerance })
    let clear = 0
    for (let i = 3; i < keyed.data.length; i += 4) if (keyed.data[i] === 0) clear++
    if (clear / (keyed.width * keyed.height) >= 0.10) return keyed
  }
  throw new Error('keyBg: <10% background keyed even at tolerance 110 — not a magenta-background image')
}

// ── gate views: hi-res cell → legacy 96 canvas (majority downscale + anchor) ──
// Both sides of every gate go through THIS path, so comparisons are like-vs-like.
const MAX_ART_H = FEET_Y_V2 + 1
function gateView(img: RawImage): RawImage {
  const k = Math.min(MAX_ART_H / img.height, CELL_V2 / img.width, 1)
  const fitted = k === 1 ? img : downscaleMajority(img,
    Math.min(CELL_V2, Math.max(1, Math.round(img.width * k))),
    Math.min(MAX_ART_H, Math.max(1, Math.round(img.height * k))))
  return anchorToCanvas(fitted, CELL_V2, CELL_V2, FEET_Y_V2)
}

const reportLines: string[] = []
// Stride/coherence ratios are ×median, fixed at the v1-calibrated cross-facing 0.310.
// Gate views are majority-downscaled hi-res cells now (not v7 lattice outputs) — same
// canvas and comparable magnitudes; the measured median is reported for drift checks.
const CALIBRATED_MEDIAN = 0.310

// ── master: cached adopted raw (master-b0-c1) → hi-res idle crops, $0 ─────────
const MASTER_KEY = 'master-b0-c1'
const masterRawPath = `${DURABLE}/raws/${MASTER_KEY}.png`
if (!existsSync(masterRawPath)) throw new Error(`adopted master raw missing: ${masterRawPath}`)
const masterRaw = readFileSync(masterRawPath)
const masterSegs = sliceStrip(keyBg(await decodePng(masterRaw)), 2)
const idleSe = processHiResCell(masterSegs[0]!)
const seBbox = opaqueBbox(idleSe)!
const TARGET_H = seBbox.y1 - seBbox.y0 + 1
const idleNe = processHiResCell(masterSegs[1]!, TARGET_H)
const idleHi: Record<AuthoredFacing, RawImage> = { se: idleSe, ne: idleNe }
const masterGate: Record<AuthoredFacing, RawImage> = { se: gateView(idleSe), ne: gateView(idleNe) }
reportLines.push(`master ${MASTER_KEY}: idle crops se=${idleSe.width}x${idleSe.height} ne=${idleNe.width}x${idleNe.height}, figureH=${TARGET_H} (NE height-normalized to SE)`)
console.log(reportLines[reportLines.length - 1])

// ── walk frames: 6 single-figure edit-calls, up to 2 candidates each ──────────
// Highest supported size: probe 1024x1536 portrait once; fall back to 1024x1024.
let walkSize = '1024x1536'
let walkReserve = 0.14

type FrameCand = { key: string; hi: RawImage; gate: RawImage; failures: GateFailure[] }
const frameCands: Record<AuthoredFacing, Record<WalkPose, FrameCand[]>> = {
  se: { 'contact-a': [], 'passing': [], 'contact-b': [] },
  ne: { 'contact-a': [], 'passing': [], 'contact-b': [] },
}

function evalFrame(key: string, f: AuthoredFacing, raw: RawImage): FrameCand {
  const keyed = keyBg(raw) // chroma gate
  const hi = processHiResCell(keyed, TARGET_H)
  const b = opaqueBbox(hi)!
  const aspect = (b.x1 - b.x0 + 1) / (b.y1 - b.y0 + 1)
  if (aspect > 1.15) throw new Error(`aspect ${aspect.toFixed(2)} > 1.15 — likely multi-figure or lying`)
  const gate = gateView(hi)
  return { key, hi, gate, failures: coherenceGateV4(key, masterGate[f], gate) }
}

async function genFrame(f: AuthoredFacing, p: WalkPose, i: number): Promise<FrameCand | null> {
  const key = `walk2c-${f}-${p}-c${i}`
  for (;;) {
    let raw: Buffer
    try {
      raw = await candidate(key, framePrompt(f, p), [STYLE_ANCHOR, masterRaw], walkSize, walkReserve)
    } catch (e) {
      if (e instanceof OutOfBudget) throw e
      if (walkSize !== '1024x1024' && String(e).includes('HTTP')) {
        console.log(`  ${walkSize} rejected (${String(e).slice(0, 160)}); falling back to 1024x1024`)
        walkSize = '1024x1024'; walkReserve = 0.08
        continue
      }
      reportLines.push(`${key}: generation FAILED — ${String(e).slice(0, 200)}`); console.log(`  ${key}: generation FAILED`)
      return null
    }
    try {
      const cand = evalFrame(key, f, await decodePng(raw))
      const line = `${key}: gates=${cand.failures.length === 0 ? 'PASS' : cand.failures.map(x => `${x.gate}(${x.value.toFixed(3)})`).join(',')}`
      reportLines.push(line); console.log(`  ${line}`)
      return cand
    } catch (e) {
      reportLines.push(`${key}: process FAILED — ${String(e).slice(0, 200)}`); console.log(`  ${key}: process FAILED — ${String(e).slice(0, 200)}`)
      return null
    }
  }
}

// A palette jaccard far below the 0.80 gate means the character's identity broke
// (wrong cap/costume colors), which is worse than any count of soft flags: such a
// candidate loses to ANY candidate above the floor regardless of failure counts.
const PALETTE_HARD_FLOOR = 0.6
function identityBroken(c: FrameCand): boolean {
  return c.failures.some(x => x.gate === 'palette' && x.value < PALETTE_HARD_FLOOR)
}
function bestOf(cands: FrameCand[]): FrameCand | null {
  return cands.reduce<FrameCand | null>((a, c) => {
    if (!a) return c
    if (identityBroken(a) !== identityBroken(c)) return identityBroken(a) ? c : a
    return c.failures.length < a.failures.length ? c : a
  }, null)
}

// Superseded by gen-cast-v5.ts and still under the same ruling: `bestOf` chooses, it does not
// decide. This renders a `GateFailure` with its margin — the margin is what tells an operator
// a threshold from a bad drawing.
const said = (x: GateFailure): string =>
  `${x.gate}: ${x.a} vs ${x.b} — ${x.value.toFixed(4)} against ${x.limit.toFixed(4)} `
  + `(off by ${Math.abs(x.value - x.limit).toFixed(4)})`

function refuseFailing(what: string, cands: readonly { key: string; failures: GateFailure[] }[]): void {
  const msg = refusalMessage(what, cands.map((c) => ({ key: c.key, failures: c.failures.map(said) })))
  if (msg === '') return
  throw new Error(`${msg}\n  Nothing is written. Use gen-cast-v5.ts.`)
}

const chosen: Record<AuthoredFacing, Record<WalkPose, FrameCand>> = { se: {}, ne: {} } as never
for (const f of AUTHORED_FACINGS) {
  console.log(`walk frames ${f}`)
  for (const p of WALK_POSES) {
    let c = await genFrame(f, p, 0)
    if (c) frameCands[f][p].push(c)
    if (!c || c.failures.length > 0) {
      const retry = await genFrame(f, p, 1)
      if (retry) frameCands[f][p].push(retry)
    }
    const best = bestOf(frameCands[f][p])
    if (!best) throw new Error(`${f}/${p}: every candidate failed processing`)
    refuseFailing(`${f}/${p}`, frameCands[f][p].map(c => ({ key: c.key, failures: c.failures })))
    chosen[f][p] = best
  }
  // in-strip stride across the assembled trio (+ master idle for the record)
  const gateStrip = (): Record<StripPoseV4, RawImage> => ({
    'idle': masterGate[f],
    'contact-a': chosen[f]['contact-a'].gate,
    'passing': chosen[f]['passing'].gate,
    'contact-b': chosen[f]['contact-b'].gate,
  })
  let stride = strideGateV4(f, gateStrip(), CALIBRATED_MEDIAN)
  if (stride.length > 0) {
    // one retry for the second member of the first failing pair (if not yet retried)
    const pose = stride[0]!.b.split('/')[1] as WalkPose
    if (frameCands[f][pose].length < 2) {
      console.log(`  stride flagged (${stride[0]!.gate} ${stride[0]!.a}~${stride[0]!.b}); retrying ${f}/${pose}`)
      const retry = await genFrame(f, pose, 1)
      if (retry) {
        frameCands[f][pose].push(retry)
        const alt = { ...chosen[f], [pose]: retry }
        const altStrip: Record<StripPoseV4, RawImage> = {
          'idle': masterGate[f],
          'contact-a': alt['contact-a'].gate, 'passing': alt['passing'].gate, 'contact-b': alt['contact-b'].gate,
        }
        const altStride = strideGateV4(f, altStrip, CALIBRATED_MEDIAN)
        if (altStride.length + retry.failures.length < stride.length + chosen[f][pose].failures.length) {
          chosen[f][pose] = retry
          stride = altStride
        }
      }
    }
  }
  for (const x of stride) reportLines.push(`${f} stride: ${x.gate} ${x.a}~${x.b} value=${x.value.toFixed(3)} limit=${x.limit.toFixed(3)}`)
  reportLines.push(`${f} trio: ${WALK_POSES.map(p => chosen[f][p].key).join(', ')} stride=${stride.length === 0 ? 'PASS' : 'FAILED'}`)
  // A property of three frames already chosen — there is no candidate to re-roll, so the
  // failure is the strip's, loudly. It used to print FLAGGED and go on.
  refuseFailing(`${f}/stride-trio`, [{
    key: `${f}: ${WALK_POSES.map(p => chosen[f][p].key).join(', ')}`, failures: stride,
  }])
}

// ── sleep: re-key the passed phase-2b raw through the hi-res path, $0 ─────────
const sleepRawPath = `${DURABLE}/raws/sleep-b0.png`
if (!existsSync(sleepRawPath)) throw new Error(`cached sleep raw missing: ${sleepRawPath}`)
let sleepHi = processHiResCell(keyBg(await decodePng(readFileSync(sleepRawPath))))
{
  // lying figure: normalize body LENGTH (opaque width) to the standing figure height
  const b = opaqueBbox(sleepHi)!
  const bw = b.x1 - b.x0 + 1
  if (bw !== TARGET_H) {
    const k = TARGET_H / bw
    sleepHi = downscaleNearest(sleepHi,
      Math.max(1, Math.round(sleepHi.width * k)), Math.max(1, Math.round(sleepHi.height * k)))
  }
}
const sleepFailures = sleepCoherenceGateV4(masterGate.se, gateView(sleepHi))
reportLines.push(`sleep-b0 (re-keyed hi-res): gates=${sleepFailures.length === 0 ? 'PASS' : sleepFailures.map(x => x.gate).join(',')}`)
console.log(reportLines[reportLines.length - 1])
// The sleep cell is a cached raw, so there is nothing to re-roll and its verdict was printed
// and then discarded. It is binding: a sleep cell that fails is not shipped either.
refuseFailing('sleep', [{ key: 'sleep-b0 (cached raw, re-keyed)', failures: sleepFailures }])

// ── derivation (zero spend): 9 authored hi-res cells → the 24-cell contract ───
const authoredStrips: Record<AuthoredFacing, Record<StripPoseV4, RawImage>> = {
  se: { 'idle': idleHi.se, 'contact-a': chosen.se['contact-a'].hi, 'passing': chosen.se['passing'].hi, 'contact-b': chosen.se['contact-b'].hi },
  ne: { 'idle': idleHi.ne, 'contact-a': chosen.ne['contact-a'].hi, 'passing': chosen.ne['passing'].hi, 'contact-b': chosen.ne['contact-b'].hi },
}
const cells = deriveSheet({ strips: authoredStrips, sleep: sleepHi })
for (const [name, img] of cells) writeFileSync(`${DURABLE}/cells/${name}.png`, await encodePng(img))
const manifest = buildManifestV4(cells, TARGET_H)
writeFileSync(`${DURABLE}/manifest.json`, JSON.stringify(manifest, null, 2))

// ── preview cells: lanczos downscale to a uniform figure height (the webview
// contract: place by manifest feet anchor, scale by figureH), 384px canvas ─────
const PREVIEW_CELL = 384
const PREVIEW_FIG_H = 320
const PREVIEW_FEET = { x: PREVIEW_CELL / 2, y: 352 }
async function previewCell(img: RawImage): Promise<RawImage> {
  const k = PREVIEW_FIG_H / TARGET_H
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k))
  const buf = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength),
    { raw: { width: img.width, height: img.height, channels: 4 } })
    .resize(w, h, { kernel: 'lanczos3', fit: 'fill' }).raw().toBuffer()
  const scaled: RawImage = { width: w, height: h, data: new Uint8ClampedArray(buf) }
  const a = cellAnchor(img)
  const left = Math.round(PREVIEW_FEET.x - a.feetX * k), top = Math.round(PREVIEW_FEET.y - a.feetY * k)
  const out = new Uint8ClampedArray(PREVIEW_CELL * PREVIEW_CELL * 4)
  for (let y = 0; y < h; y++) {
    const dy = top + y
    if (dy < 0 || dy >= PREVIEW_CELL) continue
    for (let x = 0; x < w; x++) {
      const dx = left + x
      if (dx < 0 || dx >= PREVIEW_CELL) continue
      const s = (y * w + x) * 4
      if (scaled.data[s + 3] === 0) continue
      out.set(scaled.data.subarray(s, s + 4), (dy * PREVIEW_CELL + dx) * 4)
    }
  }
  return { width: PREVIEW_CELL, height: PREVIEW_CELL, data: out }
}
const preview = new Map<string, RawImage>()
for (const [name, img] of cells) preview.set(name, await previewCell(img))

// ── contact sheet: masters | SE walk | NE walk | sleep | derived row ──────────
const BLANK: RawImage = { width: PREVIEW_CELL, height: PREVIEW_CELL, data: new Uint8ClampedArray(PREVIEW_CELL * PREVIEW_CELL * 4) }
const pad = (row: RawImage[], cols: number) => [...row, ...Array(cols - row.length).fill(BLANK) as RawImage[]]
const stripRow = async (f: AuthoredFacing) => [
  preview.get(`idle-${f}`)!,
  ...await Promise.all(WALK_POSES.map(p => previewCell(chosen[f][p].hi))),
]
const contactRows: RawImage[][] = [
  pad([preview.get('idle-se')!, preview.get('idle-ne')!], 8),
  pad(await stripRow('se'), 8),
  pad(await stripRow('ne'), 8),
  pad([preview.get('sleep-se')!], 8),
  [
    ...(['idle', 'contact-a', 'passing-a', 'contact-b'] as const).map(p => preview.get(`${p}-sw`)!),
    ...(['idle', 'contact-a', 'passing-a', 'contact-b'] as const).map(p => preview.get(`${p}-nw`)!),
  ],
]
const contact = assembleGrid(contactRows, PREVIEW_CELL, PREVIEW_CELL)
writeFileSync(`${DURABLE}/contact-sheet.png`, await encodePng(contact))

// ── 4 walking GIFs: F1-F2-F1-F3 (contact-a → passing → contact-b → passing) ──
for (const f of FACINGS) {
  const frames = WALK_CYCLE_V4.map(p => preview.get(`${p === 'passing' ? 'passing-a' : p}-${f}`)!)
  const fw = frames[0]!.width, fh = frames[0]!.height
  const stacked = new Uint8ClampedArray(fw * fh * frames.length * 4)
  frames.forEach((fr, i) => stacked.set(fr.data, fw * fh * 4 * i))
  const gif = await sharp(Buffer.from(stacked.buffer), {
    raw: { width: fw, height: fh * frames.length, channels: 4, pageHeight: fh },
  }).gif({ delay: frames.map(() => WALK_FRAME_MS), loop: 0 }).toBuffer()
  writeFileSync(`${DURABLE}/gifs/walk-${f}.gif`, gif)
}

// ── report (facing verdict deliberately absent: human eyeball only) ──────────
const finalFailures = [
  ...AUTHORED_FACINGS.flatMap(f => WALK_POSES.flatMap(p => chosen[f][p].failures)),
  ...AUTHORED_FACINGS.flatMap(f => strideGateV4(f, {
    'idle': masterGate[f],
    'contact-a': chosen[f]['contact-a'].gate, 'passing': chosen[f]['passing'].gate, 'contact-b': chosen[f]['contact-b'].gate,
  }, CALIBRATED_MEDIAN)),
  ...sleepFailures,
]
const measuredMedian = pairwiseMedian([
  ...AUTHORED_FACINGS.map(f => masterGate[f]),
  ...AUTHORED_FACINGS.flatMap(f => WALK_POSES.map(p => chosen[f][p].gate)),
])
const report = [
  `== CHARACTER V4 phase 2c (hi-res cells, webview scales down): mechanical gates ${finalFailures.length === 0 ? 'PASS' : 'FLAGGED'} ==`,
  'FACING VERDICT: none — human eyeball on contact-sheet.png + gifs/ is the gate.',
  `walk generation size: ${walkSize}; cells stored at native resolution, figureH=${TARGET_H}`,
  '', '== candidates ==', ...reportLines,
  '', `chosen: master=${MASTER_KEY} walk=${AUTHORED_FACINGS.flatMap(f => WALK_POSES.map(p => chosen[f][p].key)).join(',')} sleep=sleep-b0`,
  `gate-view pairwise median (8 standing cells)=${measuredMedian.toFixed(3)} (gate ratios ran against calibrated ${CALIBRATED_MEDIAN})`,
  '', '== remaining gate failures ==',
  ...(finalFailures.length === 0 ? ['none'] : finalFailures.map(x => `${x.gate}  ${x.a} ~ ${x.b}  value=${x.value.toFixed(3)} limit=${x.limit.toFixed(3)}`)),
  '', `total spend: $${budget.total.toFixed(3)} of $${CAP.toFixed(2)}`,
].join('\n')
writeFileSync(`${DURABLE}/report.txt`, report)
console.log(report)
if (finalFailures.length > 0) process.exitCode = 1
