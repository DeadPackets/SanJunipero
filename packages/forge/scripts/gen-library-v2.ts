// LIVE — the fifty-item library, COMMITTED. Cap $LIB_CAP.
//
//   BATCH=tools node --env-file=/Users/deadpackets/workspace/SanJunipero/.env \
//     node_modules/.pnpm/tsx@4.23.12/node_modules/tsx/dist/cli.mjs \
//     packages/forge/scripts/gen-library-v2.ts
//
// WHAT CHANGED SINCE gen-library.ts (round 3):
//
// 1. THE OUTPUT IS COMMITTED. Round 3 wrote all fifty items to `$C13/library` and registered
//    them from there. That directory now holds ZERO files, so every item this project has
//    ever paid for is gone and every item in the world draws the checkerboard placeholder.
//    These land in `content/items/<kind>/`, beside the terrain and beside round 4's building
//    cells — the two roots that survived the same wipe because they are committed.
//
// 2. ★ NO STYLE ANCHOR ON ANY CALL. Round 3 attached `style-anchor.png` — a cottage — to all
//    fifty item calls. Round 4 measured what a reference actually buys ($0.2053, same prompt
//    twice): with the anchor attached the model returned THE ANCHOR RECOLOURED, against a
//    prompt that banned its architecture by name; with a code-painted MASTER_PALETTE swatch
//    it returned the subject asked for. A swatch has no architecture in it. The only
//    reference any call here carries is that swatch. `plan.ts` carries the clause.
//
// 3. THE ICON IS ITS OWN INTEGER DOWNSCALE OF THE PAID GENERATION, not a resample of the
//    sprite. 1024/128 = 8 and 1024/64 = 16, both whole; 512/24 = 21.33 is what made every
//    earlier item mush.
//
// Controls: BATCH (required, or `all`), ITEMS=<comma list> for reruns, LIB_DRY=1,
// LIB_ATTEMPTS, LIB_REJECTED=<candidate keys a human refused>.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BudgetGuard } from '../src/budget.js'
import { SpendLedger } from '../src/spendLedger.js'
import { paletteSwatchPng } from '../src/referenceSheet.js'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { loadForgeConfig } from '../src/forgeConfig.js'
import { makeVisionJudge } from '../src/visionQa/visionJudge.js'
import { CRITERIA, type VisionVerdict } from '../src/visionQa/verdict.js'
import { alphaBinaryGate, paletteGate } from '../src/pixelGates.js'
import { ICON_PX, WORLD_SPRITE_PX } from '../src/assetResolution.js'
import { LIBRARY_BATCHES, planBatch } from '../src/library/plan.js'
import { integralSpriteCell } from '../src/library/integralCell.js'
import { candidateRank } from '../src/library/postItem.js'
import { ITEMS_CONTENT_DIR } from '../src/library/committed.js'
import type { LibraryEntry } from '../src/library/catalog.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.LIB_CAP ?? '12.00')
const MAX_ATTEMPTS = Number(process.env.LIB_ATTEMPTS ?? '3')
const BATCH = process.env.BATCH ?? ''
if (!BATCH) throw new Error(`BATCH is required — one of ${LIBRARY_BATCHES.join(', ')}, or all`)
const ONLY = (process.env.ITEMS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
// A candidate named here is one a human LOOKED AT and refused, so it is never chosen however
// clean its numbers are. The eye is the gate the gates cannot be.
const REJECTED = new Set((process.env.LIB_REJECTED ?? '').split(',').map((s) => s.trim()).filter(Boolean))
const DRY = process.env.LIB_DRY === '1'

const S = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/ar'
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
  if (budget.total + reserve > CAP) throw new Error(`reserve exceeds cap ($${budget.total.toFixed(3)} of $${CAP})`)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, prompt, size: `${GEN_PX}x${GEN_PX}`, response_format: 'b64_json',
      input_references: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${ref.toString('base64')}` } }],
      usage: { include: true },
    }),
  })
  if (!res.ok) throw new Error(`${MODEL} HTTP ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const b64 = (json.data ?? []).filter((d) => d.b64_json).at(-1)?.b64_json
  if (!b64) throw new Error(`${MODEL}: no b64_json`)
  const cost = json.usage?.cost ?? reserve
  budget.spend(cost)
  ledger.append({ assetId, kind: 'image_gen', model: MODEL, usd: cost })  // throws past the $5 anomaly stop
  ledger.flush()
  return { raw: Buffer.from(b64, 'base64'), cost }
}

const meanScore = (v: VisionVerdict): number =>
  CRITERIA.reduce((s, k) => s + v.criteria[k].score, 0) / CRITERIA.length

const batches = BATCH === 'all' ? [...LIBRARY_BATCHES] : [BATCH]
const items = batches.flatMap((b) => planBatch(b))
  .filter((i) => ONLY.length === 0 || ONLY.includes(i.entry.kind))
if (items.length === 0) throw new Error(`no items selected (BATCH=${BATCH} ITEMS=${ONLY.join(',')})`)

console.log(`gen-library-v2 ${DRY ? 'DRY' : 'LIVE'} — ${items.length} items, gen ${GEN_PX}, ` +
  `sprite ${WORLD_SPRITE_PX} icon ${ICON_PX}, cap $${CAP}`)

mkdirSync(RAWS, { recursive: true })
mkdirSync(`${S}/cells/items`, { recursive: true })
const swatch = await paletteSwatchPng()
writeFileSync(`${S}/palette-swatch.png`, swatch)
// The judge is a reader, not a painter: the swatch it sees cannot bleed into anything.
const judge = makeVisionJudge({ apiKey: KEY, refs: [swatch], config })

type Row = {
  kind: string; category: string; status: 'shipped' | 'no-candidate'; attempts: number
  factor: number; islands: number; opaqueFrac: number; spend: number; chosen: string
  score: number | null; note: string
}
const rows: Row[] = []
const lines: string[] = []

for (const item of items) {
  const e: LibraryEntry = item.entry
  const assetId = `library:${e.kind}`
  const spentBefore = ledger.totalFor(assetId)
  console.log(`\n== ${e.kind} (${e.category}) ==`)

  type Cand = {
    key: string; sprite: RawImage; icon: RawImage; factor: number; islands: number
    opaqueFrac: number; fails: string[]; verdict: VisionVerdict | null
  }
  const cands: Cand[] = []
  let extra = ''

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const key = `${e.kind}-c${i}`
    const path = `${RAWS}/${key}.png`
    let buf: Buffer
    if (existsSync(path)) { buf = readFileSync(path); console.log(`  ${key}: cached`) } else {
      if (DRY) { console.log(`  ${key}: DRY, skipped`); continue }
      // Feedback position law: boilerplate, then the fix, then the commission.
      const prompt = `${extra ? `${item.boilerplate} ${extra}` : item.boilerplate} ${item.commissionText}`
      const r = await generate(prompt, swatch, assetId)
      writeFileSync(path, r.raw); buf = r.raw
      console.log(`  ${key}: generated $${r.cost.toFixed(4)} (total $${budget.total.toFixed(4)})`)
    }
    try {
      const raw = await decodePng(buf)
      const sprite = integralSpriteCell(raw, WORLD_SPRITE_PX)
      const icon = integralSpriteCell(raw, ICON_PX)
      const fails = [
        ...alphaBinaryGate(sprite.cell).failures,
        ...paletteGate(sprite.cell).failures,
        ...alphaBinaryGate(icon.cell).failures,
        ...paletteGate(icon.cell).failures,
      ]
      // The mechanical gates cannot tell a pail from a market stall. One vision call per
      // candidate can, and it is 6% of the cost of the generation it is judging.
      let verdict: VisionVerdict | null = null
      if (!DRY) {
        const jv = await judge({
          assetId, klass: 'item', sprite: sprite.cell, commission: e.desc, attempt: i + 1,
        })
        ledger.append({ assetId, kind: 'vision_qa', model: jv.verdict.model, usd: jv.costUsd })
        ledger.flush()
        verdict = jv.verdict
      }
      const refused = REJECTED.has(key)
      if (!refused) cands.push({
        key, sprite: sprite.cell, icon: icon.cell, factor: sprite.factor,
        islands: sprite.islands, opaqueFrac: sprite.opaqueFrac, fails, verdict,
      })
      writeFileSync(`${S}/cells/items/${key}.png`, await encodePng(sprite.cell))
      const msg = `${e.kind}: ${key} factor ${sprite.factor}, islands ${sprite.islands}, ` +
        `opaque ${(sprite.opaqueFrac * 100).toFixed(1)}%, ` +
        `${fails.length === 0 ? 'pixel bar clean' : fails.join('; ')}` +
        `${verdict ? `, judge ${verdict.overall}` : ''}${refused ? ' — REFUSED BY EYE' : ''}`
      lines.push(msg); console.log(`  ${msg}`)
      if (fails.length === 0 && !refused && verdict?.overall === 'pass') break
      if (verdict && verdict.overall !== 'pass') extra = verdict.feedback
    } catch (err) {
      const msg = `${e.kind}: ${key} process FAILED — ${String(err).slice(0, 200)}`
      lines.push(msg); console.log(`  ${msg}`)
    }
  }

  // Clean pixel bar first, then the judge's verdict, then the cleanest silhouette.
  const rank = (c: Cand): number =>
    c.fails.length * 100 + (c.verdict?.overall === 'pass' ? 0 : 10) + candidateRank(c)
  const win = cands.slice().sort((a, b) => rank(a) - rank(b))[0]
  if (!win) {
    lines.push(`${e.kind}: NO CANDIDATE`); console.log('  NO CANDIDATE')
    rows.push({
      kind: e.kind, category: e.category, status: 'no-candidate', attempts: MAX_ATTEMPTS,
      factor: 0, islands: 0, opaqueFrac: 0, spend: ledger.totalFor(assetId) - spentBefore,
      chosen: '', score: null, note: 'every attempt failed',
    })
    continue
  }

  const dir = join(ITEMS_CONTENT_DIR, e.kind)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'sprite.png'), await encodePng(win.sprite))
  writeFileSync(join(dir, 'icon.png'), await encodePng(win.icon))
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify({
    version: 'v1-library-item', kind: e.kind, category: e.category,
    spritePx: e.spritePx, iconPx: e.iconPx, ...(e.interior ? { interior: e.interior } : {}),
  }, null, 2)}\n`)

  rows.push({
    kind: e.kind, category: e.category, status: 'shipped', attempts: cands.length,
    factor: win.factor, islands: win.islands, opaqueFrac: win.opaqueFrac,
    spend: ledger.totalFor(assetId) - spentBefore, chosen: win.key,
    score: win.verdict ? meanScore(win.verdict) : null,
    note: win.fails.join('; ') || (win.verdict?.overall === 'pass' ? '' : win.verdict?.feedback ?? ''),
  })
}

const md = [`# library recovery — ${batches.join(', ')}`, '',
  '| kind | category | status | attempts | factor | islands | opaque | judge | $ | chosen | note |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.kind} | ${r.category} | ${r.status} | ${r.attempts} | ${r.factor} | ` +
    `${r.islands} | ${(r.opaqueFrac * 100).toFixed(1)}% | ${r.score?.toFixed(1) ?? '-'} | ` +
    `${r.spend.toFixed(4)} | ${r.chosen} | ${r.note.replace(/\|/g, '/').slice(0, 120)} |`),
  '', '## every attempt', '', ...lines.map((l) => `- ${l}`), '',
  `spend this run: $${budget.total.toFixed(4)} of $${CAP} cap; ledger total $${ledger.total().toFixed(4)}`,
].join('\n')
mkdirSync(`${S}/reports`, { recursive: true })
writeFileSync(`${S}/reports/library-${batches.join('-')}.md`, md)
console.log(`\n${md.split('\n## every attempt')[0]}`)
console.log(`\nwrote ${S}/reports/library-${batches.join('-')}.md`)
