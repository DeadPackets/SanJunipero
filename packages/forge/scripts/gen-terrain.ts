// LIVE — cap $3. One 4x4 tile sheet per season (grass, path, water-edge, rock variants
// in seasonal grading: sage spring, deep summer, autumn leaf-litter, snow-blued winter)
// plus one 1x1 scaffolding building sprite. Human curates, writes manifest.json, commits.
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
const budget = new BudgetGuard(3)
const refs = await loadReferenceSheet()
const OUT = 'packages/forge/out/terrain-candidates'
mkdirSync(OUT, { recursive: true })

const codex = new AssetCodex(openForgeDb('packages/forge/out/terrain.db'))
const forge = createForge({
  client: makeImageClient({ apiKey: KEY, budget }),
  judge: makeVlmJudge({ apiKey: KEY, refSheets: refs }),
  codex,
  refs,
})

const sheets: [string, string, 'terrain' | 'building', { w: number; h: number }][] = [
  [
    'spring',
    'seasonal ground tileset, spring: fresh sage meadow grass, dirt path, river water edge, mossy rock — 16 tile variants',
    'terrain',
    { w: 4, h: 4 },
  ],
  [
    'summer',
    'seasonal ground tileset, summer: deep warm green grass, dry dirt path, calm river water edge, sun-baked rock — 16 tile variants',
    'terrain',
    { w: 4, h: 4 },
  ],
  [
    'autumn',
    'seasonal ground tileset, autumn: leaf-littered amber grass, muddy path, cool river water edge, lichen rock — 16 tile variants',
    'terrain',
    { w: 4, h: 4 },
  ],
  [
    'winter',
    'seasonal ground tileset, winter: snow-blued ground, trodden snow path, icy river edge, frosted rock — 16 tile variants',
    'terrain',
    { w: 4, h: 4 },
  ],
  [
    'scaffolding',
    'a construction scaffolding of honey-wood poles and cream canvas wraps, building-under-construction sprite',
    'building',
    { w: 1, h: 1 },
  ],
]
for (const [id, desc, klass, fp] of sheets) {
  const rec = await forge.commission(desc, fp, klass, id)
  writeFileSync(`${OUT}/${id}.${rec.status}.png`, codex.get(rec.id)!.png)
  console.log(
    `${id}: ${rec.status} score=${rec.score} attempts=${rec.attempts} $${rec.costUsd.toFixed(3)}`,
  )
}
console.log(
  'curate into packages/forge/content/tilesets/ + manifest.json (16 tile names per season)',
)
