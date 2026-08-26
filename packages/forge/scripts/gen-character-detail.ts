// LIVE — cap $1. Three ref-free villager candidates with extra detail clauses, landing beside
// the first wave as rig-part2-{0,1,2}.png for a human to compare and pick.
import { mkdirSync, writeFileSync } from 'node:fs'
import { makeImageClient } from '../src/imageClient.js'
import { buildAssetPrompt } from '../src/styleBible.js'
import { BudgetGuard } from '../src/budget.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const budget = new BudgetGuard(1)
const client = makeImageClient({ apiKey: KEY, budget })
const OUT = 'packages/forge/out/reference-candidates'
mkdirSync(OUT, { recursive: true })

const desc =
  'a friendly adult villager in sage-green clothes, high visible detail: ' +
  'clear face with distinct eyes, nose, and mouth, individual hair strands, ' +
  'hands with fingers, clothing folds and wrinkles, a belt with pockets, and sturdy boots'

const cands = await client.generateCandidates(
  buildAssetPrompt(desc, { w: 1, h: 1 }, 'rig-part'),
  [],
  3,
)
cands.forEach((c, i) => {
  writeFileSync(`${OUT}/rig-part2-${i}.png`, c.png)
})
console.log(`rig-part2: ${cands.length} candidates`)
cands.forEach((c, i) => {
  console.log(`  rig-part2-${i}.png  model=${c.model}  cost=$${c.costUsd.toFixed(4)}`)
})
console.log(`total spend=$${budget.total.toFixed(4)} (cap $1)`)
