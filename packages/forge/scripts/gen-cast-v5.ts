// LIVE — the cast, COMMITTED. Cap $CAST_CAP. The pipeline itself lives in
// `src/characterCommission.ts`, which the live town drives for a person it makes; this is its
// CLI shell: the cap, the raws cache, the report.
// Controls: CAST=<comma ids>, CAST_ATTEMPTS=<n, default 3>, CAST_DRY=1,
//           CAST_REJECTED=<raw keys the eye refused>.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BudgetExceededError, BudgetGuard } from '../src/budget.js'
import { SpendLedger } from '../src/spendLedger.js'
import { encodePng } from '../src/post/raw.js'
import { CAST_CONTENT_DIR } from '../src/castArt.js'
import { CAST_V5, PROPORTION_ANCHOR_ID, type CastLook } from '../src/castLooks.js'
import {
  CHARACTER_ATTEMPTS,
  commissionCharacter,
  committedProportionRef,
  onMagenta,
  type CharacterImage,
} from '../src/characterCommission.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.CAST_CAP ?? '12.00')
const DRY = process.env.CAST_DRY === '1'
const REJECTED = new Set(
  (process.env.CAST_REJECTED ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)
const FILTER = (process.env.CAST ?? CAST_V5.map((c) => c.id).join(','))
  .split(',')
  .map((s) => s.trim())
// Omar first whatever the filter order says: his master is everyone else's proportion ref.
const RUN = CAST_V5.filter((c) => FILTER.includes(c.id)).sort(
  (a, b) => Number(b.id === PROPORTION_ANCHOR_ID) - Number(a.id === PROPORTION_ANCHOR_ID),
)
if (RUN.length === 0) throw new Error(`CAST=${process.env.CAST} matches no cast member`)

const S = scratch('ar')
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'
const ATTEMPTS = Math.max(1, Number(process.env.CAST_ATTEMPTS ?? String(CHARACTER_ATTEMPTS)))

const budget = new BudgetGuard(CAP)
const ledger = new SpendLedger(`${S}/spend.json`)

async function generate(
  prompt: string,
  refs: Buffer[],
  size: string,
  reserve: number,
  assetId: string,
): Promise<CharacterImage> {
  if (budget.total + reserve > CAP) throw new BudgetExceededError(CAP, budget.total + reserve)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size,
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
  const costUsd = json.usage?.cost ?? reserve
  budget.spend(costUsd)
  ledger.append({ assetId, kind: 'image_gen', model: MODEL, usd: costUsd }) // $5 anomaly stop
  ledger.flush()
  return { png: Buffer.from(b64, 'base64'), model: MODEL, costUsd }
}

const summary: string[] = []
let proportionRef: Buffer | null = RUN.some((c) => c.id === PROPORTION_ANCHOR_ID)
  ? null
  : await committedProportionRef()
if (proportionRef !== null) {
  writeFileSync(`${S}/proportion-ref.png`, proportionRef)
  console.log(`proportion reference: ${PROPORTION_ANCHOR_ID}'s committed sheet`)
}

async function runCharacter(m: CastLook): Promise<void> {
  const DIR = `${S}/cast/${m.id}`
  for (const d of [`${DIR}/raws`, `${DIR}/cells`]) mkdirSync(d, { recursive: true })
  const assetId = `cast:${m.id}`
  const spentBefore = ledger.totalFor(assetId)
  const report: string[] = []
  let refused: string | null = null
  console.log(`\n== ${m.id} ==`)

  const sheet = await commissionCharacter(
    {
      attempts: ATTEMPTS,
      rejected: REJECTED,
      proportionRef,
      onNote: (line) => {
        report.push(line)
        console.log(`  ${line}`)
      },
      onRefused: (reason) => {
        refused = reason
      },
      // The raws cache is the script's, not the pipeline's: a re-run of a character re-reads the
      // candidates it already paid for instead of buying them again.
      generate: async ({ key, prompt, refs, size, reserveUsd }) => {
        const path = `${DIR}/raws/${key}.png`
        if (existsSync(path)) {
          console.log(`  ${key}: cached`)
          return { png: readFileSync(path), model: MODEL, costUsd: 0 }
        }
        if (DRY) throw new BudgetExceededError(CAP, budget.total)
        const r = await generate(prompt, refs, size, reserveUsd, assetId)
        writeFileSync(path, r.png)
        console.log(
          `  ${key}: generated $${r.costUsd.toFixed(4)} (total $${budget.total.toFixed(4)})`,
        )
        return r
      },
    },
    m,
  )
  writeFileSync(`${DIR}/report.txt`, report.join('\n'))
  if (sheet === null) throw new Error(refused ?? `${m.id}: refused with no reason given`)

  for (const [name, img] of sheet.cells)
    writeFileSync(`${DIR}/cells/${name}.png`, await encodePng(img))
  const dir = join(CAST_CONTENT_DIR, m.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'atlas.webp'), sheet.atlas)
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(sheet.manifest, null, 2)}\n`)
  // The next character in the run measures itself against this one's own master pair.
  if (m.id === PROPORTION_ANCHOR_ID)
    proportionRef = await encodePng(onMagenta(sheet.cells.get('idle-se')!))

  const spend = ledger.totalFor(assetId) - spentBefore
  summary.push(
    `${m.id}: figureH ${sheet.figureH}, atlas ${sheet.image.width}x${sheet.image.height}, ` +
      `$${spend.toFixed(4)}`,
  )
}

for (const m of RUN) {
  try {
    await runCharacter(m)
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      summary.push(`${m.id}: STOPPED — ${String(e).slice(0, 120)}`)
      break
    }
    summary.push(`${m.id}: FAILED — ${String(e).slice(0, 240)}`)
    console.log(`\n${m.id}: FAILED — ${String(e).slice(0, 400)}`)
  }
}
const out = [
  '== cast recovery ==',
  ...summary,
  `total this run: $${budget.total.toFixed(4)} of $${CAP} cap; ledger total $${ledger.total().toFixed(4)}`,
].join('\n')
mkdirSync(`${S}/reports`, { recursive: true })
writeFileSync(`${S}/reports/cast.md`, out)
console.log(`\n${out}`)
