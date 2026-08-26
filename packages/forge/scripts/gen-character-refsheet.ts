// LIVE — cap $1. Three villager candidates grounded on the curated 4-direction walk sheet
// (ref-sheet.png, CC0 'Green Cap Character 16x18'), with the gen-character-detail prompt.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { makeImageClient } from '../src/imageClient.js'
import { buildAssetPrompt } from '../src/styleBible.js'
import { BudgetGuard } from '../src/budget.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const budget = new BudgetGuard(1)
const client = makeImageClient({ apiKey: KEY, budget })
const OUT = 'packages/forge/out/reference-candidates'
mkdirSync(OUT, { recursive: true })

// imageClient.generateCandidates expects raw PNG bytes; it base64-encodes each ref
// into a data:image/png;base64 URL inside {type:'image_url', image_url:{url}} itself.
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
const cands = await client.generateCandidates(prompt, [refPng], 3)
cands.forEach((c, i) => writeFileSync(`${OUT}/rig-part3-${i}.png`, c.png))
console.log(`rig-part3: ${cands.length} candidates`)
cands.forEach((c, i) =>
  console.log(`  rig-part3-${i}.png  model=${c.model}  cost=$${c.costUsd.toFixed(4)}`),
)
console.log(`total spend=$${budget.total.toFixed(4)} (cap $1)`)
