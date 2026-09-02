// LIVE — vision QA over the COMMITTED cast sheets, four cells a character. Cap $CAST_QA_CAP.
// Controls: CAST=<comma ids, default the whole cast>. Writes reports/cast-qa.md; changes nothing.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CAST_IDS } from '@sj/shared'
import { BudgetGuard } from '../src/budget.js'
import { SpendLedger } from '../src/spendLedger.js'
import { listCommittedCast } from '../src/castArt.js'
import { decodePng, type RawImage } from '../src/post/raw.js'
import { makeVisionJudge } from '../src/visionQa/visionJudge.js'
import { CAST_V5 } from './cast-v5.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.CAST_QA_CAP ?? '2.00')
const FILTER = (process.env.CAST ?? CAST_IDS.join(',')).split(',').map((s) => s.trim())

const S = scratch('ar')
const FORGE = new URL('..', import.meta.url).pathname
const budget = new BudgetGuard(CAP)
const ledger = new SpendLedger(`${S}/spend.json`)
const judge = makeVisionJudge({
  apiKey: KEY,
  refs: [readFileSync(join(FORGE, 'content', 'reference', 'style-anchor.png'))],
})

// Every authored drawing: the two idles, the three strides of each, and the sleep. The other
// facings are mirrors and would only repeat these.
const FRONT = 'front three-quarter view, facing bottom-right'
const BACK = 'back three-quarter view, facing top-right, no face visible'
const CELLS: readonly { name: string; facing: string }[] = [
  { name: 'idle-se', facing: FRONT },
  { name: 'contact-a-se', facing: `${FRONT}, mid-stride` },
  { name: 'passing-a-se', facing: `${FRONT}, one foot passing under the body` },
  { name: 'contact-b-se', facing: `${FRONT}, mid-stride` },
  { name: 'idle-ne', facing: BACK },
  { name: 'contact-a-ne', facing: `${BACK}, mid-stride` },
  { name: 'passing-a-ne', facing: `${BACK}, one foot passing under the body` },
  { name: 'contact-b-ne', facing: `${BACK}, mid-stride` },
  { name: 'sleep-se', facing: 'lying asleep along the ground, head to the upper right' },
]

const lines: string[] = [
  '# cast vision QA',
  '',
  '| character | cell | overall | scores | feedback |',
  '|---|---|---|---|---|',
]
const cast = listCommittedCast().filter((c) => FILTER.includes(c.id))
for (const c of cast) {
  const member = CAST_V5.find((m) => m.id === c.id)
  if (member === undefined) throw new Error(`${c.id}: committed but not in CAST_V5`)
  const atlas = await decodePng(c.atlas)
  const spentBefore = ledger.totalFor(`cast-qa:${c.id}`)
  for (const cell of CELLS) {
    const r = c.manifest.cells[cell.name]!
    const sprite: RawImage = { width: r.w, height: r.h, data: new Uint8ClampedArray(r.w * r.h * 4) }
    for (let y = 0; y < r.h; y++) {
      const s = ((r.y + y) * atlas.width + r.x) * 4
      sprite.data.set(atlas.data.subarray(s, s + r.w * 4), y * r.w * 4)
    }
    if (budget.total + 0.01 > CAP)
      throw new Error(`cap $${CAP} reached before ${c.id} ${cell.name}`)
    const { verdict, costUsd } = await judge({
      assetId: `cast-qa:${c.id}:${cell.name}`,
      klass: 'character',
      sprite,
      commission: `${member.desc}. ${member.featureCap}`,
      expectedFacing: cell.facing,
    })
    budget.spend(costUsd)
    ledger.append({
      assetId: `cast-qa:${c.id}`,
      kind: 'vision_qa',
      model: verdict.model,
      usd: costUsd,
    })
    ledger.flush()
    const scores = Object.entries(verdict.criteria)
      .map(([k, v]) => `${k} ${v.score}${v.pass ? '' : '!'}`)
      .join(', ')
    lines.push(
      `| ${c.id} | ${cell.name} | ${verdict.overall} | ${scores} | ${verdict.feedback.replace(/\|/g, '/')} |`,
    )
    console.log(`${c.id} ${cell.name}: ${verdict.overall} — ${scores}`)
  }
  const spent = ledger.totalFor(`cast-qa:${c.id}`) - spentBefore
  lines.push(`| ${c.id} | spend | | $${spent.toFixed(4)} | |`)
}
lines.push('', `total this run: $${budget.total.toFixed(4)} of $${CAP} cap`)
mkdirSync(`${S}/reports`, { recursive: true })
writeFileSync(`${S}/reports/cast-qa.md`, lines.join('\n'))
console.log(`\ntotal this run: $${budget.total.toFixed(4)} of $${CAP} cap`)
