// LIVE (one image call, ~$0.046) unless the generated raw is cached. Three treatments of
// heart/sleep/alert side by side at 4x: authored 16x16, authored 32x32, and one generated 3x1 grid.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'
import { encodePng, decodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { renderEmote, EMOTE_PALETTE } from '../src/emotes.js'
import { upscaleNearest, opaqueBbox, downscaleMajority } from '../src/sheet.js'
import { makeImageClient } from '../src/imageClient.js'
import { BudgetGuard } from '../src/budget.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')

const SCRATCH = scratch('c5', 'emotes')
mkdirSync(SCRATCH, { recursive: true })

// ─────────────────────────── Authored 32×32 glyphs ───────────────────────────
// Same char-code convention as src/emotes.ts GLYPHS, plus shade codes (uppercase)
// for the richer shading. Palette extends EMOTE_PALETTE with darker shade ramps.
const AUTH_PALETTE: Record<string, [number, number, number]> = {
  o: EMOTE_PALETTE.outline!,
  c: EMOTE_PALETTE.cream!,
  r: EMOTE_PALETTE.rose!,
  k: EMOTE_PALETTE.sky!,
  d: EMOTE_PALETTE.deep!,
  R: [0xc2, 0x55, 0x3a], // rose shade
  K: [0x7c, 0xab, 0xc2], // sky shade
  D: [0x3c, 0x68, 0x84], // deep shade
}

const AUTH_GLYPHS: Record<'heart' | 'sleep' | 'alert', string[]> = {
  heart: [
    '................................',
    '................................',
    '................................',
    '..........o..........o..........',
    '.......ooocooo....ooocooo.......',
    '......occccccco..occccccco......',
    '.....orrrrrrrrroorrrrrrrrro.....',
    '.....orrrrrrrrrrrrrrrrrrrro.....',
    '.....orrrrrrrrrrrrrrrrrrrro.....',
    '....orrrrrrrrrrrrrrrrrrrrrro....',
    '.....orrrrrrrrrrrrrrrrrrrro.....',
    '.....orrrrrrrrrrrrrrrrrrrro.....',
    '.....orrrrrrrrrrrrrrrrrrrro.....',
    '......orrrrrrrrrRRRRRRRRRo......',
    '.......orrrrrrrrRRRRRRRRo.......',
    '........orrrrrrrRRRRRRRo........',
    '.........orrrrrrRRRRRRo.........',
    '.........orrrrrrRRRRRRo.........',
    '..........orrrrrRRRRRo..........',
    '...........orrrrRRRRo...........',
    '...........orrrrRRRRo...........',
    '............orrrRRRo............',
    '............orrrRRRo............',
    '.............orrRRo.............',
    '..............orRo..............',
    '..............orRo..............',
    '...............oo...............',
    '...............oo...............',
    '................................',
    '................................',
    '................................',
    '................................',
  ],
  sleep: [
    '................................',
    '................................',
    '.............oooooooooooooo.....',
    '.............okkkkkkkKKKKKo.....',
    '.............ooooooooooKKKo.....',
    '.......................oKo......',
    '......................oKo.......',
    '.....................oKo........',
    '....................oKo.........',
    '...................oko..........',
    '.............ooooookkKooooo.....',
    '.............okkkkkkkKKKKKo.....',
    '.............okoooooooooooo.....',
    '....oooooooooDo.................',
    '....oddddddDDDo.................',
    '....oooooooDDDo.................',
    '...........oDo..................',
    '..........oDo...................',
    '.........odo....................',
    '....oooooddDooo.................',
    '....oddddddDDDo.................',
    '..ookkkKKKooooo.................',
    '..okkkkKKo......................',
    '..ooookKKo......................',
    '......oKo.......................',
    '.....oko........................',
    '....oko.........................',
    '...oko..........................',
    '..okkkoooo......................',
    '..okkkkKKo......................',
    '..oooooooo......................',
    '................................',
  ],
  alert: [
    '................................',
    '................................',
    '................................',
    '................................',
    '.............oooooo.............',
    '.............ocrrRo.............',
    '.............ocrrRo.............',
    '.............ocrrRo.............',
    '.............ocrrRo.............',
    '.............ocrrRo.............',
    '.............ocrrRo.............',
    '.............ocrrRo.............',
    '.............ocrrRo.............',
    '.............ocrrRo.............',
    '.............ocrrRo.............',
    '.............ocrrRo.............',
    '.............ocrrRo.............',
    '.............ocrrRo.............',
    '.............ocrrRo.............',
    '.............ocrrRo.............',
    '.............oooooo.............',
    '................................',
    '................................',
    '..............oooo..............',
    '..............orro..............',
    '.............orrrro.............',
    '..............orro..............',
    '..............oooo..............',
    '................................',
    '................................',
    '................................',
    '................................',
  ],
}

const AUTH_SIZE = 32

function renderAuthored(kind: 'heart' | 'sleep' | 'alert'): RawImage {
  const rows = AUTH_GLYPHS[kind]
  const data = new Uint8ClampedArray(AUTH_SIZE * AUTH_SIZE * 4)
  rows.forEach((row, y) => {
    if (row.length !== AUTH_SIZE) throw new Error(`${kind}: row ${y} has ${row.length} chars`)
    for (let x = 0; x < AUTH_SIZE; x++) {
      const ch = row[x]!
      if (ch === '.') continue
      const color = AUTH_PALETTE[ch]
      if (!color) throw new Error(`${kind}: unknown glyph char '${ch}' at ${x},${y}`)
      data.set([...color, 255], (y * AUTH_SIZE + x) * 4)
    }
  })
  return { width: AUTH_SIZE, height: AUTH_SIZE, data }
}

// ─────────────────────────── Generated option (one call) ───────────────────────────
const GEN_RAW_PATH = `${SCRATCH}/generated-raw.png`
const GEN_PROMPT =
  'Three pixel-art emote icons in a single horizontal row, evenly spaced, each centered ' +
  'in its own equal third of the image. Left to right: (1) a heart, (2) a "Zzz" sleep ' +
  'symbol, (3) an exclamation mark. Chunky pixel art style, large square pixels, crisp ' +
  'edges, no anti-aliasing, no gradients. Each emote is large, filling most of its cell. ' +
  'Warm pastel palette: rose #e8785a, cream #fff6e9, sky blue #a8cfe0, deep blue #5a8cab, ' +
  'dark outline #43394a. Flat solid colors with a dark outline around each shape. Solid ' +
  'magenta #FF00FF background, no border, no frame, no grid lines, no text.'

const SPEND_PATH = `${SCRATCH}/spend.json`
function readSpend(): number {
  try {
    const parsed: unknown = JSON.parse(readFileSync(SPEND_PATH, 'utf8'))
    if (typeof parsed === 'object' && parsed !== null && 'spendUsd' in parsed) {
      const v = parsed.spendUsd
      return typeof v === 'number' ? v : 0
    }
    return 0
  } catch {
    return 0
  }
}

async function generatedGlyphs(): Promise<{ imgs: RawImage[] }> {
  let raw: Buffer
  let costUsd = 0
  if (existsSync(GEN_RAW_PATH)) {
    raw = readFileSync(GEN_RAW_PATH)
    console.log(`generated raw cached at ${GEN_RAW_PATH} (no spend)`)
  } else {
    const client = makeImageClient({ apiKey: KEY!, budget: new BudgetGuard(1.0) })
    const cand = (await client.generateCandidates(GEN_PROMPT, [], 1))[0]!
    raw = cand.png
    costUsd = cand.costUsd
    writeFileSync(GEN_RAW_PATH, raw)
    writeFileSync(
      SPEND_PATH,
      JSON.stringify(
        { asset: 'emote-treatment-generated', spendUsd: readSpend() + costUsd },
        null,
        2,
      ),
    )
    console.log(
      `generated raw written to ${GEN_RAW_PATH} (${cand.model}, $${cand.costUsd.toFixed(4)})`,
    )
  }
  const sheet = await decodePng(raw)
  // Slice the 512-wide sheet into 3 equal columns (170px each; the last 2px are dropped).
  const cellW = Math.floor(sheet.width / 3)
  const imgs: RawImage[] = []
  for (let c = 0; c < 3; c++) {
    const data = new Uint8ClampedArray(cellW * sheet.height * 4)
    for (let y = 0; y < sheet.height; y++) {
      const src = (y * sheet.width + c * cellW) * 4
      data.set(sheet.data.subarray(src, src + cellW * 4), y * cellW * 4)
    }
    const cell: RawImage = { width: cellW, height: sheet.height, data }
    const keyed = chromaKey(cell) // magenta background -> transparent
    const bbox = opaqueBbox(keyed)
    if (!bbox) throw new Error(`generated cell ${c} is empty after keying`)
    const bw = bbox.x1 - bbox.x0 + 1,
      bh = bbox.y1 - bbox.y0 + 1
    const cropped = new Uint8ClampedArray(bw * bh * 4)
    for (let y = 0; y < bh; y++) {
      const src = ((bbox.y0 + y) * cellW + bbox.x0) * 4
      cropped.set(keyed.data.subarray(src, src + bw * 4), y * bw * 4)
    }
    const glyph = downscaleMajority({ width: bw, height: bh, data: cropped }, AUTH_SIZE, AUTH_SIZE)
    let opaque = 0
    for (let i = 3; i < glyph.data.length; i += 4) if (glyph.data[i]! > 0) opaque++
    console.log(`generated cell ${c}: bbox ${bw}x${bh} -> 32x32, ${opaque} opaque px`)
    imgs.push(glyph)
  }
  return { imgs }
}

// ─────────────────────────── Composition ───────────────────────────
const CELL = 128 // 4x of the 32×32 treatments
const GAP = 16
const LABEL_W = 90
const HEADER_H = 40
const MARGIN = 20
const COLS = 3,
  ROWS = 3
const SHEET_W = LABEL_W + COLS * CELL + (COLS - 1) * GAP + MARGIN
const SHEET_H = HEADER_H + ROWS * CELL + (ROWS - 1) * GAP + MARGIN

const TREATMENTS = ['Current 16×16', 'Authored 32×32', 'Generated 32×32'] as const
const GLYPH_NAMES = ['heart', 'sleep', 'alert'] as const

async function textPng(text: string, size: number, color = '#43394a'): Promise<Buffer> {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${size + 10}">` +
      `<text x="0" y="${size}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" ` +
      `font-weight="600" fill="${color}">${text}</text></svg>`,
  )
  return sharp(svg).trim().png().toBuffer()
}

async function main(): Promise<void> {
  // Build the 3×3 grid of glyph cells (rows = glyphs, cols = treatments).
  const current = GLYPH_NAMES.map((n) => renderEmote(n === 'alert' ? 'exclaim' : n))
  const authored = GLYPH_NAMES.map((n) => renderAuthored(n))
  const { imgs: generated } = await generatedGlyphs()

  const cells: RawImage[][] = GLYPH_NAMES.map((_, r) => [
    upscaleNearest(current[r]!, CELL / 16), // 16×16 → 8x to fill the 128 cell
    upscaleNearest(authored[r]!, CELL / AUTH_SIZE), // 32×32 → 4x
    upscaleNearest(generated[r]!, CELL / AUTH_SIZE), // 32×32 → 4x
  ])

  // Composite onto a transparent canvas with sharp.
  const base = await sharp({
    create: {
      width: SHEET_W,
      height: SHEET_H,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer()

  const layers: { input: Buffer; left: number; top: number }[] = []
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      layers.push({
        input: await encodePng(cells[r]![c]!),
        left: LABEL_W + c * (CELL + GAP),
        top: HEADER_H + r * (CELL + GAP),
      })
    }
  }
  // Column headers, centered over each column.
  for (let c = 0; c < COLS; c++) {
    const label = await textPng(TREATMENTS[c]!, 14)
    const meta = await sharp(label).metadata()
    const w = meta.width
    layers.push({
      input: label,
      left: LABEL_W + c * (CELL + GAP) + Math.round((CELL - w) / 2),
      top: 8,
    })
  }
  // Row labels, vertically centered per row.
  for (let r = 0; r < ROWS; r++) {
    const label = await textPng(GLYPH_NAMES[r]!, 20)
    const meta = await sharp(label).metadata()
    const h = meta.height
    layers.push({
      input: label,
      left: 8,
      top: HEADER_H + r * (CELL + GAP) + Math.round((CELL - h) / 2),
    })
  }

  const out = await sharp(base).composite(layers).png().toBuffer()
  const outPath = `${SCRATCH}/emote-treatment-compare.png`
  writeFileSync(outPath, out)
  console.log(`wrote ${outPath} (${SHEET_W}x${SHEET_H})`)

  // Report.
  const report = [
    '# Emote treatment comparison — report',
    '',
    `- **PNG:** \`${outPath}\` (${SHEET_W}×${SHEET_H})`,
    `- **Spend:** $${readSpend().toFixed(4)} total (one image call for the final artifact; a discarded first attempt is included)`,
    '- **Invocation:**',
    '  ```',
    '  node --env-file=/Users/deadpackets/workspace/SanJunipero/.env \\',
    '    node_modules/.pnpm/tsx@4.23.12/node_modules/tsx/dist/cli.mjs \\',
    '    packages/forge/scripts/emote-treatment-compare.ts',
    '  ```',
    '- **Layout:** 3 columns (treatments) × 3 rows (glyphs heart / sleep / alert).',
    '  Cells are 128×128. Current 16×16 is upscaled 8× to fill the cell; authored and',
    '  generated 32×32 are upscaled 4× (the "4x" of the brief).',
    '- **Notes:**',
    '  - Authored mock = code-drawn 32×32 glyphs (shading + outline) in this standalone',
    '    script, extending the `src/emotes.ts` char-code convention; no library changes.',
    '  - Generated = one 512×512 image call (3×1 grid on magenta), sliced into 3 cells,',
    '    chroma-keyed, bbox-cropped, majority-downscaled to 32×32.',
    '  - "alert" maps to the existing `exclaim` glyph (the exclamation mark).',
    '',
  ].join('\n')
  const reportPath = `${SCRATCH}/emote-treatment-report.md`
  writeFileSync(reportPath, report)
  console.log(`wrote ${reportPath}`)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
