// LIVE — one targeted edit-call on a cached character master.
// Env: EDIT_CHAR, EDIT_SRC, EDIT_OUT, EDIT_NOTE, EDIT_CAP (default $0.20).
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { BudgetGuard } from '../src/budget.js'
import { STYLE_PROMPT } from '../src/styleBible.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CHAR = process.env.EDIT_CHAR
const SRC = process.env.EDIT_SRC
const OUT = process.env.EDIT_OUT
const NOTE = process.env.EDIT_NOTE
if (!CHAR || !SRC || !OUT || !NOTE) throw new Error('EDIT_CHAR, EDIT_SRC, EDIT_OUT, EDIT_NOTE all required')
const CAP = Number(process.env.EDIT_CAP ?? '0.2')
const budget = new BudgetGuard(CAP)

const SCRATCH = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5'
const RAWS = `${SCRATCH}/production/${CHAR}/raws`
const srcPath = `${RAWS}/${SRC}.png`
const outPath = `${RAWS}/${OUT}.png`
if (!existsSync(srcPath)) throw new Error(`source raw missing: ${srcPath}`)
if (existsSync(outPath)) { console.log(`${OUT}: already cached — nothing to do`); process.exit(0) }

const STYLE_ANCHOR = readFileSync('packages/forge/content/reference/style-anchor.png')
const srcRaw = readFileSync(srcPath)

const prompt =
  `${STYLE_PROMPT} Reproduce the LAST reference image EXACTLY — the same two pixel-art figures, same ` +
  `costume, same colors, same proportions, same chunky pixel size, same positions on the magenta ` +
  `background — with ONE change: ${NOTE} ` +
  'Everything else stays pixel-identical. NO text, NO labels, NO shadow, NO buildings, NO scenery — ' +
  'do NOT draw the building from the first reference image (it is a STYLE reference only).'

const res = await fetch('https://openrouter.ai/api/v1/images/generations', {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'google/gemini-3.1-flash-image', prompt, size: '1024x1024', response_format: 'b64_json',
    input_references: [STYLE_ANCHOR, srcRaw].map(r => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${r.toString('base64')}` } })),
    usage: { include: true },
  }),
})
if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
const images = (json.data ?? []).filter(d => d.b64_json)
const b64 = images[images.length - 1]?.b64_json
if (!b64) throw new Error('no b64_json in data[]')
budget.spend(json.usage?.cost ?? 0.08)
writeFileSync(outPath, Buffer.from(b64, 'base64'))
console.log(`${OUT}: written ($${budget.total.toFixed(3)} of $${CAP.toFixed(2)})`)
