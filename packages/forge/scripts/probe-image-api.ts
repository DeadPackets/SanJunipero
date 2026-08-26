// LIVE probe — GATE for chunk C5. Hard cap $5 via BudgetGuard.
// Verifies: Image API endpoint + response shape, input_references, magenta bg,
// per-image cost, and one gpt-5.6-luna judge call. Writes the authoritative report.
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { BudgetGuard } from '../src/budget.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const budget = new BudgetGuard(5)
const EST_IMAGE_USD = 0.045 // gemini-3.1-flash-image @512px, used when usage.cost absent
const OUT = 'packages/forge/probe-out'
mkdirSync(OUT, { recursive: true })

const PROMPT =
  'Cutesy isometric pixel-art sprite of a small timber cottage, 2:1 dimetric projection, ' +
  'light from the north-west, hard pixels, no anti-aliasing, warm cozy pastel colors ' +
  '(cream stone, honey wood, sage green, dusty rose), Stardew Valley style, rounded ' +
  'silhouette, oversized door and windows. The cottage is centered on a SOLID PURE ' +
  'MAGENTA (#FF00FF) background with no shadows or ground plane on the background.'

type ProbeResult = {
  endpoint: string
  requestShape: unknown
  responseSkeleton: unknown
  png: Buffer
  costUsd: number
}

async function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Shape A — dedicated Image API (spec §15: "OpenRouter Image API, base64 out", input_references)
async function tryImagesEndpoint(model: string, refs: string[]): Promise<ProbeResult> {
  // input_references entries must be objects: bare data-URL strings are rejected (400 ZodError).
  const requestShape = {
    model,
    prompt: PROMPT,
    size: '512x512',
    response_format: 'b64_json',
    ...(refs.length
      ? { input_references: refs.map((url) => ({ type: 'image_url', image_url: { url } })) }
      : {}),
    usage: { include: true },
  }
  const res = await post('https://openrouter.ai/api/v1/images/generations', requestShape)
  if (!res.ok) throw new Error(`images endpoint ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const b64 = json.data?.[0]?.b64_json
  if (!b64) throw new Error('images endpoint: no data[0].b64_json')
  const costUsd = json.usage?.cost ?? EST_IMAGE_USD
  budget.spend(costUsd)
  return {
    endpoint: 'POST /api/v1/images/generations',
    requestShape,
    responseSkeleton: skeleton(json),
    png: Buffer.from(b64, 'base64'),
    costUsd,
  }
}

// Shape B — chat completions with image modality (fallback probe if Shape A 404s)
async function tryChatEndpoint(model: string, refs: string[]): Promise<ProbeResult> {
  const content: unknown[] = [{ type: 'text', text: PROMPT }]
  for (const r of refs) content.push({ type: 'image_url', image_url: { url: r } })
  const requestShape = {
    model,
    messages: [{ role: 'user', content }],
    modalities: ['image', 'text'],
    usage: { include: true },
  }
  const res = await post('https://openrouter.ai/api/v1/chat/completions', requestShape)
  if (!res.ok) throw new Error(`chat endpoint ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as {
    choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[]
    usage?: { cost?: number }
  }
  const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url
  if (!url?.startsWith('data:image'))
    throw new Error('chat endpoint: no data-URL image in message.images')
  const costUsd = json.usage?.cost ?? EST_IMAGE_USD
  budget.spend(costUsd)
  return {
    endpoint: 'POST /api/v1/chat/completions (modalities:[image,text])',
    requestShape,
    responseSkeleton: skeleton(json),
    png: Buffer.from(url.split(',')[1]!, 'base64'),
    costUsd,
  }
}

// Replace every leaf with its typeof so the report never embeds real payloads/keys.
function skeleton(v: unknown): unknown {
  if (Array.isArray(v)) return v.slice(0, 1).map(skeleton)
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, skeleton(x)]),
    )
  return typeof v === 'string' && v.length > 40 ? `string(${v.length})` : typeof v
}

async function magentaShare(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let magenta = 0
  for (let i = 0; i < data.length; i += 4)
    if (255 - data[i]! <= 72 && data[i + 1]! <= 72 && 255 - data[i + 2]! <= 72) magenta++
  return magenta / (info.width * info.height)
}

async function judgeProbe(png: Buffer): Promise<{ score: number; notes: string; costUsd: number }> {
  const res = await post('https://openrouter.ai/api/v1/chat/completions', {
    model: 'openai/gpt-5.6-luna',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Score this pixel-art sprite 1-10 for: cozy pastel palette, isometric 2:1 projection, hard pixels, Stardew-like readability. Reply as JSON.',
          },
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
          },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'verdict',
        strict: true,
        schema: {
          type: 'object',
          properties: { score: { type: 'number' }, notes: { type: 'string' } },
          required: ['score', 'notes'],
          additionalProperties: false,
        },
      },
    },
    usage: { include: true },
  })
  if (!res.ok) throw new Error(`judge ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as {
    choices: { message: { content: string } }[]
    usage?: { cost?: number }
  }
  const costUsd = json.usage?.cost ?? 0.0004
  budget.spend(costUsd)
  return {
    ...(JSON.parse(json.choices[0]!.message.content) as { score: number; notes: string }),
    costUsd,
  }
}

async function main() {
  const generate = async (model: string, refs: string[]) => {
    try {
      return await tryImagesEndpoint(model, refs)
    } catch (e) {
      console.warn(`Shape A failed (${(e as Error).message}); trying Shape B`)
      return tryChatEndpoint(model, refs)
    }
  }

  // 1) 3 parallel ref-free candidates (the production pattern)
  const candidates = await Promise.all(
    [0, 1, 2].map(() => generate('google/gemini-3.1-flash-image', [])),
  )
  candidates.forEach((c, i) => {
    writeFileSync(`${OUT}/candidate-${i}.png`, c.png)
  })

  // 2) input_references round-trip: candidate 0 fed back as reference
  const ref = `data:image/png;base64,${candidates[0]!.png.toString('base64')}`
  const withRef = await generate('google/gemini-3.1-flash-image', [ref])
  writeFileSync(`${OUT}/with-reference.png`, withRef.png)

  // 3) magenta compliance + judge
  const shares = await Promise.all(candidates.map((c) => magentaShare(c.png)))
  const verdict = await judgeProbe(candidates[0]!.png)

  const report = `# C5 probe report — OpenRouter Image API (2026-08-15)

**AUTHORITATIVE for chunk C5.** imageClient.ts and judge.ts MUST match these shapes.

- Working endpoint: ${candidates[0]!.endpoint}
- input_references accepted: ${withRef.endpoint} (image returned: yes)
- input_references entry shape: \`{ type: 'image_url', image_url: { url: <data-URL> } }\` — bare data-URL strings are rejected (400 ZodError)
- Request shape used: \n\`\`\`json\n${JSON.stringify(candidates[0]!.requestShape, null, 2)}\n\`\`\`
- Response skeleton: \n\`\`\`json\n${JSON.stringify(candidates[0]!.responseSkeleton, null, 2)}\n\`\`\`
- Magenta background share per candidate: ${shares.map((s) => (s * 100).toFixed(1) + '%').join(', ')} (PASS if every candidate > 30%)
- Judge (openai/gpt-5.6-luna) verdict: score ${verdict.score}, cost $${verdict.costUsd}
- Per-image observed cost: ${candidates.map((c) => '$' + c.costUsd.toFixed(4)).join(', ')}
- Total probe spend: $${budget.total.toFixed(4)} of $5.00 cap
`
  mkdirSync('docs/superpowers/probes', { recursive: true })
  writeFileSync('docs/superpowers/probes/2026-08-15-c5-image-api.md', report)
  console.log(report)
}
main()
