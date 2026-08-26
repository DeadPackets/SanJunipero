// LIVE (Asset Standard v3, buildings) — cap $BUILD_CAP (default $2.00).
// Buildings are NEVER mirrored (NW-light law) and author ONE facing each (door-sw default).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'
import { BudgetGuard, BudgetExceededError } from '../src/budget.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { estimatePitch, opaqueBbox } from '../src/sheet.js'
import { processHiResCell, cellAnchor } from '../src/hires.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.BUILD_CAP ?? '2.0')
const budget = new BudgetGuard(CAP)
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'

const SCRATCH = scratch('c5')
const PRODUCTION = `${SCRATCH}/production`

const STYLE_ANCHOR = readFileSync('packages/forge/content/reference/style-anchor.png')

class OutOfBudget extends Error {}

type Building = {
  id: string
  kind: string
  desc: string
  fp: { w: number; h: number }
  door: boolean
}
// Consumers: engine genesis (storehouse/wagon — C8 T8 stockStorehouse), scripted G6
// world (shed; hut = approved anchor), T16 scaffolding, genesis map standing stone.
const BUILDINGS: readonly Building[] = [
  {
    id: 'storehouse',
    kind: 'storehouse',
    fp: { w: 2, h: 2 },
    door: true,
    desc: 'a sturdy communal storehouse of honey-wood planks on a cream-stone base, wide double doors, a small hay loft window under the roof peak',
  },
  {
    id: 'wagon',
    kind: 'wagon',
    fp: { w: 1, h: 2 },
    door: false,
    desc: 'a settler travel wagon with a rounded cream canvas cover, honey-wood body and two big spoked wheels, standing still with no animals',
  },
  {
    id: 'shed',
    kind: 'shed',
    fp: { w: 1, h: 1 },
    door: true,
    desc: 'a small honey-wood tool shed with a single plank door and a slanted roof',
  },
  {
    id: 'scaffolding',
    kind: 'scaffolding',
    fp: { w: 1, h: 1 },
    door: false,
    desc: 'a construction scaffolding of honey-wood poles and cream canvas wraps, building-under-construction sprite',
  },
  {
    id: 'standing-stone',
    kind: 'standing_stone',
    fp: { w: 1, h: 1 },
    door: false,
    desc: 'an ancient weathered warm-grey standing stone, taller than a person, softly rounded edges, faint moss at its base',
  },
]
const FILTER = (process.env.BUILDINGS ?? BUILDINGS.map((b) => b.id).join(','))
  .split(',')
  .map((s) => s.trim())
const RUN = BUILDINGS.filter((b) => FILTER.includes(b.id))
if (RUN.length === 0) throw new Error(`BUILDINGS=${process.env.BUILDINGS} matches nothing`)

const assetSpend: Record<string, number> = {}

async function generate(
  prompt: string,
  size: string,
  reserve: number,
): Promise<{ raw: Buffer; cost: number }> {
  if (budget.total + reserve > CAP)
    throw new OutOfBudget(
      `reserve $${reserve.toFixed(3)} exceeds remaining cap ($${budget.total.toFixed(3)} of $${CAP} spent)`,
    )
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size,
      response_format: 'b64_json',
      input_references: [
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${STYLE_ANCHOR.toString('base64')}` },
        },
      ],
      usage: { include: true },
    }),
  })
  if (!res.ok) throw new Error(`${MODEL} HTTP ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const images = (json.data ?? []).filter((d) => d.b64_json)
  const b64 = images[images.length - 1]?.b64_json
  if (!b64) throw new Error(`${MODEL}: no b64_json in data[]`)
  return { raw: Buffer.from(b64, 'base64'), cost: json.usage?.cost ?? reserve }
}

async function candidate(dir: string, asset: string, key: string, prompt: string): Promise<Buffer> {
  const rawPath = `${dir}/raws/${key}.png`
  if (existsSync(rawPath)) {
    console.log(`  ${key}: reusing cached raw`)
    return readFileSync(rawPath)
  }
  const r = await generate(prompt, '1024x1024', 0.08)
  writeFileSync(rawPath, r.raw)
  assetSpend[asset] = (assetSpend[asset] ?? 0) + r.cost
  try {
    budget.spend(r.cost)
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      console.log(`  ${key}: cost $${r.cost.toFixed(3)} overran the cap — HARD STOP (raw cached)`)
      throw new OutOfBudget(e.message)
    }
    throw e
  }
  console.log(
    `  ${key}: generated ($${r.cost.toFixed(3)}), total spend $${budget.total.toFixed(3)}`,
  )
  return r.raw
}

function buildingPrompt(b: Building): string {
  const door = b.door
    ? 'The door and entrance are on the lower-left (south-west) visible wall, like the reference cottage. '
    : ''
  return (
    `${STYLE_PROMPT} A single free-standing building sprite. ` +
    `Subject: ${b.desc}. World footprint: ${b.fp.w}x${b.fp.h} tiles on a 32x16 pixel tile grid. ` +
    door +
    'Do NOT mirror or copy the reference cottage — it is a STYLE reference only; draw the subject described. ' +
    'NO text, NO words, NO labels, NO captions. NO people, NO animals. NO ground plane beyond the ' +
    'subject itself, NO path, NO scenery — the ONLY content is the single subject on the magenta background. ' +
    'The subject fills about four fifths of the frame with clear magenta margin on all sides. ' +
    'Style: match the pixel density, palette warmth, and cute rounded style of the first reference image exactly.'
  )
}

function keyBg(img: RawImage): RawImage {
  for (const tolerance of [72, 110]) {
    const keyed = chromaKey(img, { tolerance })
    let clear = 0
    for (let i = 3; i < keyed.data.length; i += 4) if (keyed.data[i] === 0) clear++
    if (clear / (keyed.width * keyed.height) >= 0.1) return keyed
  }
  throw new Error(
    'keyBg: <10% background keyed even at tolerance 110 — not a magenta-background image',
  )
}

const summary: string[] = []
for (const b of RUN) {
  const DIR = `${PRODUCTION}/building-${b.id}`
  mkdirSync(`${DIR}/raws`, { recursive: true })
  console.log(`\n== building ${b.id} (${b.fp.w}x${b.fp.h}) ==`)
  type Cand = { key: string; hi: RawImage; pitch: number }
  const cands: Cand[] = []
  const lines: string[] = []
  try {
    for (let i = 0; i < 2; i++) {
      const key = `building-${b.id}-c${i}`
      const raw = await candidate(DIR, b.id, key, buildingPrompt(b))
      try {
        const keyed = keyBg(await decodePng(raw))
        const pitch = estimatePitch(keyed)
        const hi = processHiResCell(keyed)
        const bb = opaqueBbox(hi)!
        const line = `${key}: keyed OK, pitch=${pitch.toFixed(2)}, cell=${hi.width}x${hi.height}, bbox=${bb.x1 - bb.x0 + 1}x${bb.y1 - bb.y0 + 1}`
        lines.push(line)
        console.log(`  ${line}`)
        cands.push({ key, hi, pitch })
      } catch (e) {
        const line = `${key}: process FAILED — ${String(e).slice(0, 200)}`
        lines.push(line)
        console.log(`  ${line}`)
      }
    }
  } catch (e) {
    if (e instanceof OutOfBudget) {
      summary.push(`${b.id}: STOPPED — out of budget`)
      console.log(`  ${b.id}: STOPPED — out of budget`)
      break
    }
    throw e
  }
  if (cands.length === 0) {
    summary.push(`${b.id}: FAILED — no candidate keyed/processed`)
    writeFileSync(`${DIR}/report.txt`, lines.join('\n'))
    continue
  }
  cands.sort((a, c) => c.pitch - a.pitch)
  const win = cands[0]!
  writeFileSync(`${DIR}/cell.png`, await encodePng(win.hi))
  const anchor = cellAnchor(win.hi)
  writeFileSync(
    `${DIR}/manifest.json`,
    JSON.stringify(
      {
        version: 'v4-hires-building',
        kind: b.kind,
        footprint: b.fp,
        cell: anchor, // anchorX/anchorY = feetX/feetY: ground contact = bottom-center of opaque bbox
      },
      null,
      2,
    ),
  )
  // 4x preview: 4 x the world render target (32·(w+h) px square per Style Bible)
  const target = 32 * (b.fp.w + b.fp.h) * 4
  const k = Math.min(target / win.hi.width, target / win.hi.height)
  const pw = Math.max(1, Math.round(win.hi.width * k)),
    ph = Math.max(1, Math.round(win.hi.height * k))
  const previewBuf = await sharp(
    Buffer.from(win.hi.data.buffer, win.hi.data.byteOffset, win.hi.data.byteLength),
    { raw: { width: win.hi.width, height: win.hi.height, channels: 4 } },
  )
    .resize(pw, ph, { kernel: 'lanczos3', fit: 'fill' })
    .png()
    .toBuffer()
  writeFileSync(`${DIR}/preview-4x.png`, previewBuf)
  lines.push(
    `chosen: ${win.key} (picked by pixel pitch); anchor={w:${anchor.w},h:${anchor.h},x:${anchor.feetX},y:${anchor.feetY}}`,
  )
  lines.push(`asset spend: $${(assetSpend[b.id] ?? 0).toFixed(3)}`)
  writeFileSync(`${DIR}/report.txt`, lines.join('\n'))
  writeFileSync(
    `${DIR}/spend.json`,
    JSON.stringify({ asset: `building-${b.id}`, spendUsd: assetSpend[b.id] ?? 0 }, null, 2),
  )
  summary.push(`${b.id}: chosen ${win.key}, spend $${(assetSpend[b.id] ?? 0).toFixed(3)}`)
}

const out = [
  '== BUILDING PRODUCTION SUMMARY ==',
  'QUALITY VERDICT: none — human eyeball on the batch artifacts is the gate.',
  ...summary,
  `total spend: $${budget.total.toFixed(3)} of $${CAP.toFixed(2)}`,
].join('\n')
mkdirSync(PRODUCTION, { recursive: true })
writeFileSync(`${PRODUCTION}/buildings-summary.txt`, out)
console.log(`\n${out}`)
