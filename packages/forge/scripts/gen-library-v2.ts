// LIVE — the fifty-item library, COMMITTED. Cap $LIB_CAP.
// The icon is a WHOLE-number downscale of the paid generation (1024/128, 1024/64); a
// fractional divide is what made the round-3 items mush.
// Controls: BATCH (required, or `all`), ITEMS=<comma list> for reruns, LIB_DRY=1,
// LIB_ATTEMPTS, LIB_REJECTED=<candidate keys a human refused>.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BudgetGuard } from '../src/budget.js'
import { SpendLedger } from '../src/spendLedger.js'
import { paletteSwatchPng } from '../src/referenceSheet.js'
import { decodePng, encodePng, encodeWebp, type RawImage } from '../src/post/raw.js'
import { loadForgeConfig } from '../src/forgeConfig.js'
import {
  makeVisionJudge,
  CRITERIA,
  LIBRARY_BATCHES,
  planBatch,
  type VisionVerdict,
} from '@sj/forge/gen'
import { paletteDistance } from '../src/pixelGates.js'
import { ICON_PX, WORLD_SPRITE_PX } from '../src/assetResolution.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { spriteCell } from '../src/reCell.js'
import { candidateRank, silhouetteStats } from '../src/library/postItem.js'
import { refusalMessage } from '../src/gate.js'
import { ITEMS_CONTENT_DIR } from '../src/library/committed.js'
import type { LibraryEntry } from '../src/library/catalog.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.LIB_CAP ?? '12.00')
const MAX_ATTEMPTS = Number(process.env.LIB_ATTEMPTS ?? '3')
const BATCH = process.env.BATCH ?? ''
if (!BATCH) throw new Error(`BATCH is required — one of ${LIBRARY_BATCHES.join(', ')}, or all`)
const ONLY = (process.env.ITEMS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
// A candidate named here is one a human LOOKED AT and refused, so it is never chosen however
// clean its numbers are. The eye is the gate the gates cannot be.
const REJECTED = new Set(
  (process.env.LIB_REJECTED ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)
const DRY = process.env.LIB_DRY === '1'

const S = scratch('ar')
const RAWS = `${S}/raws/items`
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'
// 1024 divides by 128 and by 64 exactly, so both the sprite and the icon come off whole
// factors of the same paid generation.
const GEN_PX = 1024

const budget = new BudgetGuard(CAP)
const ledger = new SpendLedger(`${S}/spend.json`)
const config = loadForgeConfig()

async function generate(prompt: string, ref: Buffer, assetId: string) {
  const reserve = 0.08
  if (budget.total + reserve > CAP)
    throw new Error(`reserve exceeds cap ($${budget.total.toFixed(3)} of $${CAP})`)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size: `${GEN_PX}x${GEN_PX}`,
      response_format: 'b64_json',
      input_references: [
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${ref.toString('base64')}` },
        },
      ],
      usage: { include: true },
    }),
  })
  if (!res.ok) throw new Error(`${MODEL} HTTP ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const b64 = (json.data ?? []).filter((d) => d.b64_json).at(-1)?.b64_json
  if (!b64) throw new Error(`${MODEL}: no b64_json`)
  const cost = json.usage?.cost ?? reserve
  budget.spend(cost)
  ledger.append({ assetId, kind: 'image_gen', model: MODEL, usd: cost }) // throws past the $5 anomaly stop
  ledger.flush()
  return { raw: Buffer.from(b64, 'base64'), cost }
}

const meanScore = (v: VisionVerdict): number =>
  CRITERIA.reduce((s, k) => s + v.criteria[k].score, 0) / CRITERIA.length

const batches = BATCH === 'all' ? [...LIBRARY_BATCHES] : [BATCH]
const items = batches
  .flatMap((b) => planBatch(b))
  .filter((i) => ONLY.length === 0 || ONLY.includes(i.entry.kind))
if (items.length === 0)
  throw new Error(`no items selected (BATCH=${BATCH} ITEMS=${ONLY.join(',')})`)

console.log(
  `gen-library-v2 ${DRY ? 'DRY' : 'LIVE'} — ${items.length} items, gen ${GEN_PX}, ` +
    `sprite ${WORLD_SPRITE_PX} icon ${ICON_PX}, cap $${CAP}`,
)

mkdirSync(RAWS, { recursive: true })
mkdirSync(`${S}/cells/items`, { recursive: true })
const swatch = await paletteSwatchPng()
writeFileSync(`${S}/palette-swatch.png`, swatch)
// The judge is a reader, not a painter: the swatch it sees cannot bleed into anything.
const judge = makeVisionJudge({ apiKey: KEY, refs: [swatch], config })

type Row = {
  kind: string
  category: string
  status: 'shipped' | 'no-candidate'
  attempts: number
  factor: number
  islands: number
  opaqueFrac: number
  spend: number
  chosen: string
  score: number | null
  note: string
}
const rows: Row[] = []
const lines: string[] = []
// Kinds this run refused to ship. Collected, not thrown on the spot: the unit of work is ONE
// ITEM, and the report of every attempt is worth more than an early exit.
const refusedKinds: string[] = []

for (const item of items) {
  const e: LibraryEntry = item.entry
  const assetId = `library:${e.kind}`
  const spentBefore = ledger.totalFor(assetId)
  console.log(`\n== ${e.kind} (${e.category}) ==`)

  type Cand = {
    key: string
    sprite: RawImage
    icon: RawImage
    factor: number
    islands: number
    opaqueFrac: number
    verdict: VisionVerdict | null
  }
  const cands: Cand[] = []
  let extra = ''

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const key = `${e.kind}-c${i}`
    const path = `${RAWS}/${key}.png`
    let buf: Buffer
    if (existsSync(path)) {
      buf = readFileSync(path)
      console.log(`  ${key}: cached`)
    } else {
      if (DRY) {
        console.log(`  ${key}: DRY, skipped`)
        continue
      }
      // Feedback position law: boilerplate, then the fix, then the commission.
      const prompt = `${extra ? `${item.boilerplate} ${extra}` : item.boilerplate} ${item.commissionText}`
      const r = await generate(prompt, swatch, assetId)
      writeFileSync(path, r.raw)
      buf = r.raw
      console.log(`  ${key}: generated $${r.cost.toFixed(4)} (total $${budget.total.toFixed(4)})`)
    }
    try {
      const keyed = chromaKey(await decodePng(buf))
      // The ENTRY's size, not the class default: a bed and a rug cover more ground than a knife
      // and are authored at 192. `artCoverage.test.ts` measures the sprite against `e.spritePx`.
      const sprite = spriteCell(keyed, { w: e.spritePx, h: e.spritePx, anchor: 'centre' })
      const icon = spriteCell(keyed, { w: ICON_PX, h: ICON_PX, anchor: 'centre' })
      const { islands, opaqueFrac } = silhouetteStats(sprite.cell)
      // The mechanical gates cannot tell a pail from a market stall. One vision call per
      // candidate can, and it is 6% of the cost of the generation it is judging.
      let verdict: VisionVerdict | null = null
      if (!DRY) {
        const jv = await judge({
          assetId,
          klass: 'item',
          sprite: sprite.cell,
          commission: e.desc,
          attempt: i + 1,
        })
        ledger.append({ assetId, kind: 'vision_qa', model: jv.verdict.model, usd: jv.costUsd })
        ledger.flush()
        verdict = jv.verdict
      }
      const refused = REJECTED.has(key)
      if (!refused)
        cands.push({
          key,
          sprite: sprite.cell,
          icon: icon.cell,
          factor: sprite.plan.factor,
          islands,
          opaqueFrac,
          verdict,
        })
      writeFileSync(`${S}/cells/items/${key}.png`, await encodePng(sprite.cell))
      const msg =
        `${e.kind}: ${key} factor ${sprite.plan.factor}, islands ${islands}, ` +
        `opaque ${(opaqueFrac * 100).toFixed(1)}%, ` +
        `palette distance ${paletteDistance(sprite.cell).toFixed(1)}, ` +
        `${verdict ? `, judge ${verdict.overall}` : ''}${refused ? ' — REFUSED BY EYE' : ''}`
      lines.push(msg)
      console.log(`  ${msg}`)
      if (!refused && verdict?.overall === 'pass') break
      if (verdict && verdict.overall !== 'pass') extra = verdict.feedback
    } catch (err) {
      const msg = `${e.kind}: ${key} process FAILED — ${String(err).slice(0, 200)}`
      lines.push(msg)
      console.log(`  ${msg}`)
    }
  }

  // Both verdicts are binding, the judge's included — it is the only gate that can tell a pail
  // from a market stall. The rank chooses among what is left.
  // A NULL verdict is "not judged", not "failed": under LIB_DRY=1 the judge is never called.
  const judgeFails = (c: Cand): string[] =>
    c.verdict !== null && c.verdict.overall !== 'pass'
      ? [`judge: ${c.verdict.overall} — ${c.verdict.feedback}`]
      : []
  const clean = cands.filter((c) => judgeFails(c).length === 0)
  const rank = (c: Cand): number => candidateRank(c)
  const win = clean.slice().sort((a, b) => rank(a) - rank(b))[0]
  if (!win) {
    const why =
      refusalMessage(
        e.kind,
        cands.map((c) => ({ key: c.key, failures: judgeFails(c) })),
      ) || `${e.kind}: NO CANDIDATE`
    lines.push(why)
    console.log(`  ${why}`)
    refusedKinds.push(e.kind)
    rows.push({
      kind: e.kind,
      category: e.category,
      status: 'no-candidate',
      attempts: MAX_ATTEMPTS,
      factor: 0,
      islands: 0,
      opaqueFrac: 0,
      spend: ledger.totalFor(assetId) - spentBefore,
      chosen: '',
      score: null,
      note: cands.length === 0 ? 'every attempt failed' : 'every candidate failed a gate',
    })
    continue
  }

  const dir = join(ITEMS_CONTENT_DIR, e.kind)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'sprite.webp'), await encodeWebp(win.sprite))
  writeFileSync(join(dir, 'icon.webp'), await encodeWebp(win.icon))
  writeFileSync(
    join(dir, 'manifest.json'),
    `${JSON.stringify(
      {
        version: 'v1-library-item',
        kind: e.kind,
        category: e.category,
        spritePx: e.spritePx,
        iconPx: e.iconPx,
        ...(e.interior ? { interior: e.interior } : {}),
      },
      null,
      2,
    )}\n`,
  )

  rows.push({
    kind: e.kind,
    category: e.category,
    status: 'shipped',
    attempts: cands.length,
    factor: win.factor,
    islands: win.islands,
    opaqueFrac: win.opaqueFrac,
    spend: ledger.totalFor(assetId) - spentBefore,
    chosen: win.key,
    score: win.verdict ? meanScore(win.verdict) : null,
    note: '',
  })
}

const md = [
  `# library recovery — ${batches.join(', ')}`,
  '',
  '| kind | category | status | attempts | factor | islands | opaque | judge | $ | chosen | note |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.kind} | ${r.category} | ${r.status} | ${r.attempts} | ${r.factor} | ` +
      `${r.islands} | ${(r.opaqueFrac * 100).toFixed(1)}% | ${r.score?.toFixed(1) ?? '-'} | ` +
      `${r.spend.toFixed(4)} | ${r.chosen} | ${r.note.replace(/\|/g, '/').slice(0, 120)} |`,
  ),
  '',
  '## every attempt',
  '',
  ...lines.map((l) => `- ${l}`),
  '',
  `spend this run: $${budget.total.toFixed(4)} of $${CAP} cap; ledger total $${ledger.total().toFixed(4)}`,
].join('\n')
mkdirSync(`${S}/reports`, { recursive: true })
writeFileSync(`${S}/reports/library-${batches.join('-')}.md`, md)
console.log(`\n${md.split('\n## every attempt')[0]}`)
console.log(`\nwrote ${S}/reports/library-${batches.join('-')}.md`)

// ★ THE REFUSALS ARE BINDING, AFTER THE REPORT IS ON DISK — the report is what tells an
// operator whether the model or the threshold is wrong, and the items that DID pass are
// already committed. Nothing was written for a refused kind.
if (refusedKinds.length > 0)
  throw new Error(
    `${refusedKinds.length} item(s) shipped nothing: ${refusedKinds.join(', ')}.\n  Raise ` +
      `LIB_ATTEMPTS to draw more, LIB_REJECTED to refuse a candidate by eye, or change a ` +
      `threshold on purpose.`,
  )
