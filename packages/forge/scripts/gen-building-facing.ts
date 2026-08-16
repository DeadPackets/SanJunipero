// LIVE — cap $0.30. SE-facing variant of the approved cottage (door on the other
// visible wall). Never mirrored: light stays locked from the north-west.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { makeImageClient } from '../src/imageClient.js'
import { makeVlmJudge } from '../src/judge.js'
import { BudgetGuard } from '../src/budget.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { decodePng, encodePng, downscaleNearest } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { quantize } from '../src/post/quantize.js'
import { outlinePass } from '../src/post/outline.js'
import { upscaleNearest } from '../src/sheet.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const budget = new BudgetGuard(0.3)
const client = makeImageClient({ apiKey: KEY, budget })

const REF_CANDIDATES = '/Users/deadpackets/workspace/SanJunipero/.claude/scratch/c5/reference-candidates'
// Canonical style anchor (the approved cottage raw, committed): FIRST generation ref + FIRST judge ref.
const STYLE_ANCHOR = readFileSync('packages/forge/content/reference/style-anchor.png')
const judge = makeVlmJudge({
  apiKey: KEY,
  refSheets: [STYLE_ANCHOR, readFileSync(`${REF_CANDIDATES}/item-1.png`),
    readFileSync('packages/forge/content/reference/identity-anchor.png')],
})

const OUT = 'packages/forge/out/building-facing'
const DURABLE = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5/building-facing'
for (const d of [`${OUT}/candidates`, `${DURABLE}/candidates`]) mkdirSync(d, { recursive: true })

const PROMPT = `${STYLE_PROMPT} A single free-standing building sprite. ` +
  'the SAME cottage as the reference, identical materials and roof, but with the door and entrance ' +
  'on the other visible wall (the south-east face). Same fixed camera, do NOT mirror the image; ' +
  'lighting stays from the north-west. ' +
  'Match the pixel density, palette warmth, and cute rounded style of the first reference image exactly.'


const cands = await client.generateCandidates(PROMPT, [STYLE_ANCHOR], 3)
let winner: { png: Buffer; score: number; notes: string } | null = null
for (const [i, c] of cands.entries()) {
  const v = await judge(c.png)
  console.log(`candidate ${i} (${c.model}): score=${v.score} $${c.costUsd.toFixed(3)} — ${v.notes}`)
  writeFileSync(`${OUT}/candidates/${i}.png`, c.png)
  writeFileSync(`${DURABLE}/candidates/${i}.png`, c.png)
  if (!winner || v.score > winner.score) winner = { png: c.png, score: v.score, notes: v.notes }
}

const cell = outlinePass(quantize(downscaleNearest(chromaKey(await decodePng(winner!.png)), 64, 64)))
const winnerPng = await encodePng(cell)
writeFileSync(`${OUT}/winner.png`, winnerPng)
writeFileSync(`${DURABLE}/winner.png`, winnerPng)
writeFileSync(`${DURABLE}/winner-4x.png`, await encodePng(upscaleNearest(cell, 4)))
console.log(`winner score=${winner!.score}; total spend $${budget.total.toFixed(3)} of $0.30`)
