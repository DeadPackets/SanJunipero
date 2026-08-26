// LIVE — regenerate ONE founder's sleep cell only, cap $SLEEP_CAP (default $0.50).
// "Fully horizontal" was read as horizontal ON SCREEN and `aspect > 1` let a flat body pass;
// this gates on sleepAxisGate instead. Only the sleep cells are rewritten.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { BudgetGuard } from '../src/budget.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { decodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { sliceStrip, opaqueBbox, paletteJaccard } from '../src/sheet.js'
import { processHiResCell } from '../src/hires.js'
import { sleepAxisDeg, SLEEP_AXIS_DEG_MIN, SLEEP_AXIS_DEG_MAX } from '../src/mirror.js'
import { BIG_PIXEL } from './character.js'
import { CAST_V4 } from './cast.js'
import { scratch } from './scratch.js'

const S = scratch()

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.SLEEP_CAP ?? '0.50')
const MAX_ATTEMPTS = Number(process.env.SLEEP_ATTEMPTS ?? '3')
const budget = new BudgetGuard(CAP)
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'

const OUT = `${S}/r3/sleep`

const id = process.env.FOUNDER
const m = CAST_V4.find((c) => c.id === id)
if (!m) throw new Error(`FOUNDER=${id} is not in CAST_V4`)

const DIR = `${OUT}/${m.id}`
mkdirSync(`${DIR}/raws`, { recursive: true })
const MASTER = readFileSync(`${S}/c5/production/${m.id}/master/master.png`)

// The corrected pose text, matching gen-cast-v4's sleepPrompt. The reference pair reads as
// a body lying ALONG the 2:1 dimetric ground, head up to the right; naming "horizontal" got
// a body pasted flat across the picture instead.
function sleepPrompt(): string {
  return (
    `${STYLE_PROMPT} A single character sprite, exactly one figure — exactly the same character, costume and ` +
    `colors as the figures in the reference image, at the same chunky pixel scale. The character is ` +
    `curled on their side fast asleep on the ground, seen from the same high three-quarter angle as ` +
    `the reference figures. The body lies ALONG THE GROUND running away up to the right: the head is ` +
    `at the UPPER RIGHT end, the knees are drawn up and both feet are at the LOWER LEFT end, so the ` +
    `whole body sits on a diagonal about thirty degrees up to the right. Do NOT draw the body flat ` +
    `across the picture. The head rests ON THE GROUND in profile, cheek down, eyes closed, relaxed ` +
    `peaceful face. Both arms are tucked in front of the chest and are NOT propping the head up — ` +
    `the character is asleep, not resting on their elbows. Both feet are visible at the lower-left end. ` +
    `NO text, NO labels. NO shadow under the figure. NO bed, NO pillow, NO blanket, NO props. ` +
    `NO buildings, NO houses, NO scenery, NO ground plane. The ONLY content is the single sleeping ` +
    `figure on the magenta background. Subject: ${m!.desc}. ${m!.featureCap} ${BIG_PIXEL}`
  )
}

function keyBg(img: RawImage): RawImage {
  for (const tolerance of [72, 110]) {
    const keyed = chromaKey(img, { tolerance })
    let clear = 0
    for (let i = 3; i < keyed.data.length; i += 4) if (keyed.data[i] === 0) clear++
    if (clear / (keyed.width * keyed.height) >= 0.1) return keyed
  }
  throw new Error('keyBg: <10% keyed even at tolerance 110')
}

async function generate(prompt: string, refs: Buffer[], reserve: number) {
  if (budget.total + reserve > CAP)
    throw new Error(`reserve exceeds cap ($${budget.total.toFixed(3)} of $${CAP})`)
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
  const b64 = (json.data ?? []).filter((d) => d.b64_json).at(-1)?.b64_json
  if (!b64) throw new Error(`${MODEL}: no b64_json`)
  return { raw: Buffer.from(b64, 'base64'), cost: json.usage?.cost ?? reserve }
}

const masterKeyed = keyBg(await decodePng(MASTER))
const lines: string[] = []
type Cand = { key: string; deg: number; jac: number; ok: boolean; note: string }
const cands: Cand[] = []

for (let i = 0; i < MAX_ATTEMPTS; i++) {
  const key = `sleep-${m.id}-r${i}`
  const path = `${DIR}/raws/${key}.png`
  let buf: Buffer
  if (existsSync(path)) {
    buf = readFileSync(path)
    console.log(`  ${key}: cached`)
  } else {
    const r = await generate(sleepPrompt(), [MASTER], 0.08)
    writeFileSync(path, r.raw)
    budget.spend(r.cost)
    buf = r.raw
    console.log(`  ${key}: generated $${r.cost.toFixed(4)} (total $${budget.total.toFixed(4)})`)
  }
  try {
    const keyed = keyBg(await decodePng(buf))
    let twoFigures = false
    try {
      sliceStrip(keyed, 2)
      twoFigures = true
    } catch {
      /* one cluster — good */
    }
    if (twoFigures) throw new Error('slices into 2 figure clusters')
    const hi = processHiResCell(keyed)
    const bb = opaqueBbox(hi)!
    const aspect = (bb.x1 - bb.x0 + 1) / (bb.y1 - bb.y0 + 1)
    const deg = sleepAxisDeg(hi)
    const jac = paletteJaccard(masterKeyed, keyed)
    const axisOk = deg >= SLEEP_AXIS_DEG_MIN && deg <= SLEEP_AXIS_DEG_MAX
    const ok = axisOk && aspect > 1 && jac >= 0.6
    const note = `axis ${deg.toFixed(1)} ${axisOk ? 'OK' : 'OUT'}, aspect ${aspect.toFixed(3)}, palette ${jac.toFixed(3)}`
    cands.push({ key, deg, jac, ok, note })
    lines.push(`${key}: ${ok ? 'PASS' : 'FAIL'} — ${note}`)
    console.log(`  ${key}: ${ok ? 'PASS' : 'FAIL'} — ${note}`)
    if (ok) break
  } catch (e) {
    lines.push(`${key}: process FAILED — ${String(e).slice(0, 160)}`)
    console.log(`  ${key}: process FAILED — ${String(e).slice(0, 160)}`)
  }
}

// nearest to the middle of the band wins among passes; among failures, nearest the band
const mid = (SLEEP_AXIS_DEG_MIN + SLEEP_AXIS_DEG_MAX) / 2
const passes = cands.filter((c) => c.ok)
const pick = (passes.length ? passes : cands).sort(
  (a, b) => Math.abs(a.deg - mid) - Math.abs(b.deg - mid),
)[0]
lines.push(
  '',
  `spend: $${budget.total.toFixed(4)} of $${CAP}`,
  pick
    ? `chosen: ${pick.key} (${pick.ok ? 'PASS' : 'best of a failing set — DO NOT SHIP'}) ${pick.note}`
    : 'chosen: none',
)
writeFileSync(`${DIR}/report.txt`, lines.join('\n'))
writeFileSync(
  `${DIR}/spend.json`,
  JSON.stringify({ asset: `sleep-${m.id}`, spendUsd: budget.total }, null, 2),
)
console.log(`\n${lines.join('\n')}`)
if (pick?.ok) console.log(`\nSLEEP_RAW=${DIR}/raws/${pick.key}.png`)
