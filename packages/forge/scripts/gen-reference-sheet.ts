// LIVE — cap $2. Generates 9 ref-free candidates (3 subjects × 3 candidates) from the
// pure Style Bible prompt. A HUMAN picks the best 3 (variety: building, item, character)
// and copies them to content/reference/ref-{1,2,3}.png — the permanent reference sheet.
import { mkdirSync, writeFileSync } from 'node:fs'
import { makeImageClient } from '../src/imageClient.js'
import { buildAssetPrompt, type AssetClass } from '../src/styleBible.js'
import { BudgetGuard } from '../src/budget.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const client = makeImageClient({ apiKey: KEY, budget: new BudgetGuard(2) })
const OUT = 'packages/forge/out/reference-candidates'
mkdirSync(OUT, { recursive: true })

const subjects: [string, AssetClass][] = [
  ['a small timber-and-cream-stone cottage with a honey-wood door', 'building'],
  ['a wooden bucket with a rope handle', 'item'],
  ['a friendly adult villager in sage-green clothes', 'rig-part'],
]
for (const [desc, klass] of subjects) {
  const cands = await client.generateCandidates(
    buildAssetPrompt(desc, { w: 1, h: 1 }, klass),
    [],
    3,
  )
  cands.forEach((c, i) => {
    writeFileSync(`${OUT}/${klass}-${i}.png`, c.png)
  })
  console.log(
    `${klass}: ${cands.length} candidates, $${cands.reduce((s, c) => s + c.costUsd, 0).toFixed(3)}`,
  )
}
console.log(
  'Curate: pick 3 (one per subject), copy to packages/forge/content/reference/ref-{1,2,3}.png',
)
