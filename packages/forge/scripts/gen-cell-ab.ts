// LIVE — cap $1.00. Quality A/B for one cell (sw/idle): 3 models × 2 candidates,
// big-pixel prompt style, each candidate reduced two ways (NEAREST+outline vs
// majority-vote, no outline). Human picks the winning combo from the contact sheet.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { BudgetGuard } from '../src/budget.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { decodePng, encodePng, downscaleNearest, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { quantize } from '../src/post/quantize.js'
import { outlinePass } from '../src/post/outline.js'
import { FACING_CLAUSES, POSE_CLAUSES, downscaleMajority, upscaleNearest } from '../src/sheet.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const budget = new BudgetGuard(1)
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const RESERVE = 0.06

const ANCHOR = readFileSync('packages/forge/content/reference/identity-anchor.png')
const DURABLE = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5/quality-ab'
mkdirSync(`${DURABLE}/raws`, { recursive: true })
mkdirSync(`${DURABLE}/cells`, { recursive: true })

const PROMPT = `${STYLE_PROMPT} A single character sprite, exactly one figure, whole body visible. ` +
  `The character is ${FACING_CLAUSES.sw}. The character is ${POSE_CLAUSES.idle}. ` +
  'Subject: a friendly young villager in a sage-green cap and overalls. ' +
  'Rendered as chunky low-resolution pixel art: the entire figure is drawn from large visible square pixels ' +
  '(as if a 32x32 sprite enlarged), flat solid colors from a limited palette, absolutely no smooth shading, ' +
  'no painterly detail, no anti-aliasing, thick 1-pixel dark outline around the silhouette.'

// gpt-image-2 rejects size/response_format (T6 v4 wave: aspect_ratio 1:1, quality medium only).
const MODELS: { id: string; short: string; body: Record<string, unknown> }[] = [
  { id: 'google/gemini-3.1-flash-image', short: 'gemini', body: { size: '512x512', response_format: 'b64_json' } },
  { id: 'openai/gpt-image-2', short: 'gpt2', body: { aspect_ratio: '1:1', quality: 'medium', n: 1 } },
  // seedream rejects 512x512 (needs >=3,686,400 output px); omit size for its default.
  { id: 'bytedance-seed/seedream-4.5', short: 'seedream', body: { response_format: 'b64_json' } },
]

async function generate(model: typeof MODELS[number]): Promise<{ png: Buffer; costUsd: number }> {
  budget.spend(RESERVE)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model.id, prompt: PROMPT, ...model.body,
      input_references: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${ANCHOR.toString('base64')}` } }],
      usage: { include: true },
    }),
  })
  if (!res.ok) throw new Error(`${model.id} HTTP ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const b64 = json.data?.[0]?.b64_json
  if (!b64) throw new Error(`${model.id}: no data[0].b64_json`)
  const costUsd = json.usage?.cost ?? RESERVE
  if (costUsd > RESERVE) budget.spend(costUsd - RESERVE)
  return { png: Buffer.from(b64, 'base64'), costUsd }
}


// contact sheet: rows = model, cols = cand0-nearest, cand0-majority, cand1-nearest, cand1-majority
const CELLPX = 128, GAP = 1
const sheetW = 4 * CELLPX + 3 * GAP, sheetH = MODELS.length * CELLPX + (MODELS.length - 1) * GAP
const sheet: RawImage = { width: sheetW, height: sheetH, data: new Uint8ClampedArray(sheetW * sheetH * 4) }
function blit(cell: RawImage, row: number, col: number) {
  const ox = col * (CELLPX + GAP), oy = row * (CELLPX + GAP)
  for (let y = 0; y < cell.height; y++)
    sheet.data.set(cell.data.subarray(y * cell.width * 4, (y + 1) * cell.width * 4), ((oy + y) * sheetW + ox) * 4)
}

const readme: string[] = ['quality-ab contact sheet layout (no text labels rendered):',
  'rows top->bottom: gemini (google/gemini-3.1-flash-image), gpt2 (openai/gpt-image-2), seedream (bytedance-seed/seedream-4.5)',
  'cols left->right: cand0-nearest, cand0-majority, cand1-nearest, cand1-majority',
  'nearest = chromaKey -> downscaleNearest 32 -> quantize -> outlinePass (old chain)',
  'majority = chromaKey -> downscaleMajority 32 -> quantize, no outline (new chain)', '', 'per-image costs:']
for (const [row, model] of MODELS.entries()) {
  for (let i = 0; i < 2; i++) {
    // idempotent rerun: an existing raw means this image is already paid for
    const rawPath = `${DURABLE}/raws/${model.short}-${i}.png`
    let png: Buffer
    try { png = readFileSync(rawPath); console.log(`${model.short} cand${i}: reusing existing raw`) }
    catch {
      const r = await generate(model)
      png = r.png
      console.log(`${model.short} cand${i}: $${r.costUsd.toFixed(4)}`)
      readme.push(`${model.short} cand${i}: $${r.costUsd.toFixed(4)}`)
      writeFileSync(rawPath, png)
    }
    const keyed = chromaKey(await decodePng(png))
    const nearest = outlinePass(quantize(downscaleNearest(keyed, 32, 32)))
    const majority = quantize(downscaleMajority(keyed, 32, 32))
    writeFileSync(`${DURABLE}/cells/${model.short}-${i}-nearest.png`, await encodePng(nearest))
    writeFileSync(`${DURABLE}/cells/${model.short}-${i}-majority.png`, await encodePng(majority))
    blit(upscaleNearest(nearest, 4), row, i * 2)
    blit(upscaleNearest(majority, 4), row, i * 2 + 1)
  }
}
writeFileSync(`${DURABLE}/contact-sheet.png`, await encodePng(sheet))
readme.push('', `total spend: $${budget.total.toFixed(4)} of $1.00 (reserve-then-fire at $${RESERVE}/image)`)
writeFileSync(`${DURABLE}/README.txt`, readme.join('\n'))
console.log(readme.join('\n'))
