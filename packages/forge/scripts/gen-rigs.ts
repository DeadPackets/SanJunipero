// LIVE — cap $4. Commissions rig content through the FULL gated pipeline:
// 2 base bodies × 3 age bands + 4 hair layers + 3 clothing layers = 13 rig-part sheets
// (4 facing directions each, 128x32). Human curates, writes manifest.json, commits.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createForge } from '../src/forge.js'
import { makeImageClient } from '../src/imageClient.js'
import { makeVlmJudge } from '../src/judge.js'
import { loadReferenceSheet } from '../src/referenceSheet.js'
import { AssetCodex } from '../src/codex.js'
import { openForgeDb } from '../src/db.js'
import { BudgetGuard } from '../src/budget.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const budget = new BudgetGuard(4)
const refs = await loadReferenceSheet()
const codex = new AssetCodex(openForgeDb('packages/forge/out/rigs.db'))
const forge = createForge({ client: makeImageClient({ apiKey: KEY, budget }), judge: makeVlmJudge({ apiKey: KEY, refSheets: refs }), codex, refs })
const OUT = 'packages/forge/out/rig-candidates'
mkdirSync(OUT, { recursive: true })

const parts: [string, string][] = [
  ...(['child', 'adult', 'elder'] as const).flatMap(age => [
    [`body-a-${age}`, `a bald unclothed pixel villager base body in plain warm grey underclothes, ${age} proportions, 3 heads tall`],
    [`body-b-${age}`, `a bald unclothed stockier pixel villager base body in plain warm grey underclothes, ${age} proportions, 3 heads tall`],
  ] as [string, string][]),
  ['hair-braid', 'a hair-only layer: long braided hair in honey wood colors, floating on magenta, positioned for a 3-heads-tall villager head'],
  ['hair-short', 'a hair-only layer: short tidy hair in honey wood colors, floating on magenta, positioned for a 3-heads-tall villager head'],
  ['hair-bun', 'a hair-only layer: round bun hair in honey wood colors, floating on magenta, positioned for a 3-heads-tall villager head'],
  ['hair-curls', 'a hair-only layer: loose curls in honey wood colors, floating on magenta, positioned for a 3-heads-tall villager head'],
  ['clothing-tunic', 'a clothing-only layer: simple belted tunic in sage green colors, floating on magenta, fitted to a 3-heads-tall villager body'],
  ['clothing-apron', 'a clothing-only layer: work apron over shirt in sage green colors, floating on magenta, fitted to a 3-heads-tall villager body'],
  ['clothing-coat', 'a clothing-only layer: long winter coat in sage green colors, floating on magenta, fitted to a 3-heads-tall villager body'],
]
let spent = 0
for (const [id, desc] of parts) {
  const rec = await forge.commission(desc, { w: 1, h: 1 }, 'rig-part')
  spent += rec.costUsd
  writeFileSync(`${OUT}/${id}.${rec.status}.png`, codex.get(rec.id)!.png)
  console.log(`${id}: ${rec.status} score=${rec.score} attempts=${rec.attempts} $${rec.costUsd.toFixed(3)}`)
}
console.log(`total $${spent.toFixed(2)} — curate into packages/forge/content/rigs/ + manifest.json (ramps = the 4 palette hexes each layer actually uses)`)
