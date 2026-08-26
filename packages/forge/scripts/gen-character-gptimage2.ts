// LIVE — cap $1.5. gpt-image-2 takes aspect_ratio/quality/n instead of size/response_format,
// so this posts the image body directly. On a 4xx with the reference it retries once without it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { buildAssetPrompt } from '../src/styleBible.js'
import { BudgetGuard } from '../src/budget.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')

const MODEL = 'openai/gpt-image-2'
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const EST_IMAGE_USD = 0.055 // gpt-image-2 medium @1:1 observed ~$0.053; reserve, reconcile upward
const budget = new BudgetGuard(1.5)
const OUT = 'packages/forge/out/reference-candidates'
mkdirSync(OUT, { recursive: true })

// Raw PNG bytes; encoded exactly as imageClient does (base64 data URL in image_url wrapper).
const refPng = readFileSync(
  '/Users/deadpackets/workspace/SanJunipero/.claude/scratch/c5/ref-sheet.png',
)

const desc =
  'a friendly adult villager in sage-green clothes, high visible detail: ' +
  'clear face with distinct eyes, nose, and mouth, individual hair strands, ' +
  'hands with fingers, clothing folds and wrinkles, a belt with pockets, and sturdy boots. ' +
  'Same character proportions and 3/4-view pose as the reference walk sheet, facing south-west, ' +
  '4-direction-walk-sheet-compatible design, hard pixel edges, thick readable silhouette'

const prompt = buildAssetPrompt(desc, { w: 1, h: 1 }, 'rig-part')

type Candidate = { png: Buffer; costUsd: number }

class GenError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(`image generation failed (${MODEL}, HTTP ${status}): ${detail}`)
  }
}

async function generateOne(refs: Buffer[]): Promise<Candidate> {
  budget.spend(EST_IMAGE_USD) // reserve BEFORE firing; throws BudgetExceededError past cap
  const body: Record<string, unknown> = {
    model: MODEL,
    prompt,
    aspect_ratio: '1:1',
    quality: 'medium',
    n: 1,
  }
  if (refs.length) {
    body.input_references = refs.map((r) => ({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${r.toString('base64')}` },
    }))
  }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new GenError(res.status, await res.text())
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const b64 = json.data?.[0]?.b64_json
  if (!b64) throw new GenError(res.status, 'no data[0].b64_json in response')
  const costUsd = json.usage?.cost ?? EST_IMAGE_USD
  if (costUsd > EST_IMAGE_USD) budget.spend(costUsd - EST_IMAGE_USD)
  return { png: Buffer.from(b64, 'base64'), costUsd }
}

async function batch(refs: Buffer[]): Promise<{ candidates: Candidate[]; errors: GenError[] }> {
  const settled = await Promise.allSettled([0, 1, 2].map(() => generateOne(refs)))
  const candidates: Candidate[] = []
  const errors: GenError[] = []
  for (const s of settled) {
    if (s.status === 'fulfilled') candidates.push(s.value)
    else errors.push(s.reason instanceof GenError ? s.reason : new GenError(0, String(s.reason)))
  }
  return { candidates, errors }
}

let result = await batch([refPng])
let fallback = false
if (
  result.candidates.length === 0 &&
  result.errors.some((e) => e.status >= 400 && e.status < 500)
) {
  fallback = true
  result = await batch([])
}

if (result.candidates.length === 0) {
  const e = result.errors[0]!
  console.error(`BLOCKED ${MODEL}: HTTP ${e.status} ${e.detail.slice(0, 500)}`)
  process.exitCode = 1
} else {
  result.candidates.forEach((c, i) => writeFileSync(`${OUT}/rig-part4-${i}.png`, c.png))
  console.log(`rig-part4: ${result.candidates.length} candidates (fallback=${fallback})`)
  result.candidates.forEach((c, i) =>
    console.log(`  rig-part4-${i}.png  model=${MODEL}  cost=$${c.costUsd.toFixed(4)}`),
  )
  const actual = result.candidates.reduce((s, c) => s + c.costUsd, 0)
  console.log(
    `actual spend=$${actual.toFixed(4)}  budget.total=$${budget.total.toFixed(4)} (cap $1.5)`,
  )
  if (fallback) console.log('FALLBACK: reference omitted after 4xx on the with-reference call')
}
