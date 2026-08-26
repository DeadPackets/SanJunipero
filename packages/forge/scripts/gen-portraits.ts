// LIVE (Phase B) — cap $PORTRAIT_CAP (default $2). 512 gen on magenta -> v7 chain -> 128x128.
// Stage 1 is 3 neutral candidates for a HUMAN pick; stage 2 reruns with PORTRAIT_NEUTRAL=<index>.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { BudgetGuard, BudgetExceededError } from '../src/budget.js'
import { makeVlmJudge, type JudgeFn } from '../src/judge.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { decodePng, encodePng, downscaleNearest, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import {
  estimatePitch, v7Chain, anchorToCanvas, opaqueBbox, upscaleNearest, paletteJaccard,
} from '../src/sheet.js'
import { CHAR_DESC, ASYMMETRY_CLAUSE } from './character.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.PORTRAIT_CAP ?? '2')
const budget = new BudgetGuard(CAP)
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'
const RESERVE = 0.046

const conceptIdx = process.argv.indexOf('--concept')
const CONCEPT = conceptIdx >= 0 ? readFileSync(process.argv[conceptIdx + 1]!) : null

const SCRATCH = scratch('c5')
const DURABLE = `${SCRATCH}/portraits`
const CACHE = `${DURABLE}/candidates`
for (const d of [`${DURABLE}/final`, CACHE]) mkdirSync(d, { recursive: true })

const STYLE_ANCHOR = readFileSync('packages/forge/content/reference/style-anchor.png')
const baseRefs: Buffer[] = [STYLE_ANCHOR, ...(CONCEPT ? [CONCEPT] : [])]
const judge: JudgeFn = makeVlmJudge({ apiKey: KEY, refSheets: baseRefs })

const SHIP = 128
// Portrait consistency gates vs the chosen neutral (looser than sprite coherence:
// expressions legitimately move features): palette Jaccard ≥ 0.75, bbox within ±12%.
const PORTRAIT_JACCARD_MIN = 0.75
const PORTRAIT_BBOX_TOL = 0.12

const EXPRESSIONS = ['happy', 'sad', 'angry', 'surprised', 'weary', 'asleep'] as const
type Expression = typeof EXPRESSIONS[number]
const EXPRESSION_CLAUSES: Record<Expression, string> = {
  happy: 'beaming with a warm open smile, bright eyes',
  sad: 'downcast eyes, drooping mouth, gently sorrowful',
  angry: 'furrowed brow, puffed cheeks, cross frown',
  surprised: 'wide eyes, raised eyebrows, small open mouth',
  weary: 'half-closed heavy eyelids, tired slump, faint sigh',
  asleep: 'eyes fully closed, serene sleeping face, head tilted slightly',
}

const SCORES_PATH = `${CACHE}/scores.json`
const scores: Record<string, { score: number; notes: string }> = (() => {
  try { return JSON.parse(readFileSync(SCORES_PATH, 'utf8')) } catch { return {} }
})()

async function generate(prompt: string, refs: Buffer[]): Promise<Buffer> {
  budget.spend(RESERVE)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, prompt, size: '512x512', response_format: 'b64_json',
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

function portraitPrompt(expressionClause: string): string {
  return `${STYLE_PROMPT} A large character portrait, bust framing (head and shoulders), the same single ` +
    `character, painted pixel-art style, facing slightly toward the viewer's left. Expression: ${expressionClause}. ` +
    `Subject: ${CHAR_DESC}. ${ASYMMETRY_CLAUSE}`
}

// Detect the magenta canvas before keying: portraits SHOULD generate on magenta, but
// chromaKey only applies when the corners actually carry it.
function keyIfMagenta(img: RawImage): RawImage {
  const corners = [0, (img.width - 1) * 4, (img.height - 1) * img.width * 4, (img.width * img.height - 1) * 4]
  const magenta = corners.filter(i => {
    const r = img.data[i]!, g = img.data[i + 1]!, b = img.data[i + 2]!
    return 255 - r <= 72 && g <= 72 && 255 - b <= 72
  }).length
  return magenta >= 3 ? chromaKey(img) : img
}

// v7 primitive chain → bottom-anchored 128×128 ship canvas. Art larger than the ship
// canvas downscales NEAREST to fit (fixed-size UI asset, unlike native-res sprites).
async function processPortrait(raw: Buffer): Promise<RawImage> {
  const keyed = keyIfMagenta(await decodePng(raw))
  let art = v7Chain(keyed, estimatePitch(keyed)).out
  if (art.width > SHIP || art.height > SHIP) {
    const k = Math.min(SHIP / art.width, (SHIP - 1) / art.height)
    art = downscaleNearest(art, Math.max(1, Math.floor(art.width * k)), Math.max(1, Math.floor(art.height * k)))
  }
  return anchorToCanvas(art, SHIP, SHIP, SHIP - 1)
}

type Candidate = { key: string; raw: Buffer; score: number; notes: string; shipped: RawImage }

async function candidate(key: string, prompt: string, refs: Buffer[]): Promise<Candidate | null> {
  const rawPath = `${CACHE}/${key}.png`
  let raw: Buffer
  if (existsSync(rawPath)) { raw = readFileSync(rawPath); console.log(`  ${key}: reusing cached raw`) }
  else {
    raw = await generate(prompt, refs)
    writeFileSync(rawPath, raw)
    console.log(`  ${key}: generated, total spend $${budget.total.toFixed(3)}`)
  }
  let shipped: RawImage
  try { shipped = await processPortrait(raw) }
  catch (e) { console.log(`  ${key}: post-process failed: ${String(e)}`); return null }
  let v = scores[key]
  if (!v) {
    v = await judge(raw)
    scores[key] = v
    writeFileSync(SCORES_PATH, JSON.stringify(scores, null, 1))
  }
  writeFileSync(`${CACHE}/${key}-shipped.png`, await encodePng(shipped))
  console.log(`  ${key}: score=${v.score} — ${v.notes}`)
  return { key, raw, score: v.score, notes: v.notes, shipped }
}

const chosen = process.env.PORTRAIT_NEUTRAL // candidate index '0' | '1' | '2'

// ── Stage 1: neutral base, 3 candidates, human picks from the report ──
if (chosen === undefined) {
  const report: string[] = ['== portrait neutral candidates (HUMAN PICK REQUIRED) ==']
  for (let i = 0; i < 3; i++) {
    let c: Candidate | null
    try { c = await candidate(`neutral-c${i}`, portraitPrompt('calm, friendly, neutral resting face'), baseRefs) }
    catch (e) { if (e instanceof BudgetExceededError) { report.push(`c${i}: SKIPPED (budget)`); break } throw e }
    report.push(c ? `c${i}: score=${c.score} — ${c.notes}` : `c${i}: post-process FAILED`)
  }
  report.push('', 'inspect candidates/*.png (raw) and candidates/*-shipped.png (128×128),',
    'then rerun with PORTRAIT_NEUTRAL=<index> to generate the 6 expressions.',
    '', `total spend: $${budget.total.toFixed(3)} of $${CAP.toFixed(2)}`)
  writeFileSync(`${DURABLE}/neutral-report.txt`, report.join('\n'))
  console.log(report.join('\n'))
  process.exit(0)
}

// ── Stage 2: 6 expressions against the chosen neutral ──
const neutralRaw = readFileSync(`${CACHE}/neutral-c${chosen}.png`)
const neutral = await processPortrait(neutralRaw)
const neutralBbox = opaqueBbox(neutral)!
const nW = neutralBbox.x1 - neutralBbox.x0 + 1, nH = neutralBbox.y1 - neutralBbox.y0 + 1
writeFileSync(`${DURABLE}/final/neutral.png`, await encodePng(neutral))
writeFileSync(`${DURABLE}/final/neutral-4x.png`, await encodePng(upscaleNearest(neutral, 4)))

const exprRefs: Buffer[] = [STYLE_ANCHOR, ...(CONCEPT ? [CONCEPT] : []), neutralRaw]
const report: string[] = [`== portrait expressions (neutral=c${chosen}) ==`]

function consistency(img: RawImage): string[] {
  const problems: string[] = []
  const jac = paletteJaccard(neutral, img)
  if (jac < PORTRAIT_JACCARD_MIN) problems.push(`palette jaccard ${jac.toFixed(3)} < ${PORTRAIT_JACCARD_MIN}`)
  const b = opaqueBbox(img)
  if (!b) return ['empty image']
  const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1
  if (Math.abs(w / nW - 1) > PORTRAIT_BBOX_TOL) problems.push(`bbox width ${w} vs neutral ${nW} beyond ±${PORTRAIT_BBOX_TOL * 100}%`)
  if (Math.abs(h / nH - 1) > PORTRAIT_BBOX_TOL) problems.push(`bbox height ${h} vs neutral ${nH} beyond ±${PORTRAIT_BBOX_TOL * 100}%`)
  return problems
}

let blocked = false
exprLoop: for (const expr of EXPRESSIONS) {
  console.log(`expression ${expr}`)
  let best: { c: Candidate; problems: string[] } | null = null
  for (let i = 0; i < 2; i++) {
    let c: Candidate | null
    try { c = await candidate(`${expr}-c${i}`, portraitPrompt(EXPRESSION_CLAUSES[expr]), exprRefs) }
    catch (e) {
      if (e instanceof BudgetExceededError) { report.push(`${expr}: INCOMPLETE (budget)`); blocked = true; break exprLoop }
      throw e
    }
    if (!c) continue
    const problems = consistency(c.shipped)
    report.push(`${expr}-c${i}: score=${c.score} ${problems.length === 0 ? 'consistency PASS' : `consistency FAIL: ${problems.join('; ')}`} — ${c.notes}`)
    if (problems.length === 0 && (!best || best.problems.length > 0 || c.score > best.c.score)) best = { c, problems }
    else if (!best) best = { c, problems }
  }
  if (!best) { report.push(`${expr}: every candidate failed post-processing`); blocked = true; continue }
  if (best.problems.length > 0) blocked = true
  writeFileSync(`${DURABLE}/final/${expr}.png`, await encodePng(best.c.shipped))
  writeFileSync(`${DURABLE}/final/${expr}-4x.png`, await encodePng(upscaleNearest(best.c.shipped, 4)))
}

report.push('', blocked ? '** BLOCKED: at least one expression failed its consistency gate — do not ship **' : 'all expressions PASS',
  `total spend: $${budget.total.toFixed(3)} of $${CAP.toFixed(2)}`)
writeFileSync(`${DURABLE}/expressions-report.txt`, report.join('\n'))
console.log(report.join('\n'))
if (blocked) process.exitCode = 1
