// LIVE (Phase B) — cap $CONCEPT_CAP (default $1). NOT a sprite: rich rendering allowed, no
// pixel constraints, no chroma background. The HUMAN pick becomes the identity root.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { BudgetGuard, BudgetExceededError } from '../src/budget.js'
import { makeVlmJudge, type JudgeFn } from '../src/judge.js'
import { CHAR_DESC, ASYMMETRY_CLAUSE } from './character.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.CONCEPT_CAP ?? '1')
const budget = new BudgetGuard(CAP)
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'
const RESERVE = 0.046

const DURABLE = scratch('c5', 'concept')
mkdirSync(DURABLE, { recursive: true })

const STYLE_ANCHOR = readFileSync('packages/forge/content/reference/style-anchor.png')
// Judge caveat: the VLM judge scores pixel-art conformance, which concept art will
// deliberately violate — scores are only comparative between the two candidates here.
const judge: JudgeFn = makeVlmJudge({ apiKey: KEY, refSheets: [STYLE_ANCHOR] })

const PROMPT =
  'High-detail character concept art in a warm storybook box-art style, full body, ' +
  'three-quarter view, soft painterly rendering with rich material detail. This image ' +
  'establishes the character\'s costume, exact palette and accessories for a cozy ' +
  'pixel-art village game (warm cozy pastel: cream stone, honey wood, sage green, dusty rose). ' +
  `Subject: ${CHAR_DESC}. ${ASYMMETRY_CLAUSE} ` +
  'Plain soft warm background, single character only, no text, no logos.'

async function generate(): Promise<Buffer> {
  budget.spend(RESERVE)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, prompt: PROMPT, size: '1024x1024', response_format: 'b64_json',
      input_references: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${STYLE_ANCHOR.toString('base64')}` } }],
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

const report: string[] = ['== character concept candidates (HUMAN PICK REQUIRED) ==']
for (let i = 0; i < 2; i++) {
  const path = `${DURABLE}/concept-c${i}.png`
  let raw: Buffer
  if (existsSync(path)) { raw = readFileSync(path); console.log(`concept-c${i}: reusing cached raw`) }
  else {
    try { raw = await generate() }
    catch (e) { if (e instanceof BudgetExceededError) { report.push(`c${i}: SKIPPED (budget)`); break } throw e }
    writeFileSync(path, raw)
    console.log(`concept-c${i}: generated, total spend $${budget.total.toFixed(3)}`)
  }
  const v = await judge(raw)
  report.push(`c${i}: score=${v.score} (comparative only — judge is pixel-art biased) — ${v.notes}`)
}
report.push('', 'pick one and pass it to the sprite/portrait scripts as: --concept ' + `${DURABLE}/concept-c<i>.png`,
  '', `total spend: $${budget.total.toFixed(3)} of $${CAP.toFixed(2)}`)
writeFileSync(`${DURABLE}/report.txt`, report.join('\n'))
console.log(report.join('\n'))
