// OFFLINE contact sheet for the premade library: world sprite + icon per entry, 4x/6x
// nearest onto a neutral checker (so any transparency residue shows), with the palette card
// along the header for colour comparison. No key, no network, no spend.
//
//   BATCH=tools OUT=$C13/reports/batch-1-sheet.png node ... scripts/library-sheet.ts
//   ALL=1 TITLE='master' OUT=$C13/reports/library-master-sheet.png node ... scripts/library-sheet.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import sharp from 'sharp'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { upscaleNearest } from '../src/sheet.js'
import { checkerBackground, compositeOver, paletteCard } from '../src/visionQa/rubric.js'
import { LIBRARY } from '../src/library/catalog.js'
import { planBatch } from '../src/library/plan.js'

const C13 = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c13'
const LIB = join(C13, 'library')

const ALL = process.env.ALL === '1'
const BATCH = process.env.BATCH ?? ''
const OUT = process.env.OUT ?? join(C13, 'reports', ALL ? 'library-master-sheet.png' : `batch-${BATCH}-sheet.png`)
const TITLE = process.env.TITLE ?? (ALL ? 'C13 premade library — all 50' : `C13 library batch: ${BATCH}`)

const CELL = 96                 // 16 px at 6x and 24 px at 4x both land here
const GAP = 10, LABEL_H = 20
const BLOCK_W = CELL * 2 + GAP, BLOCK_H = CELL + LABEL_H
const COLS = 5, MARGIN = 24, HEADER_H = 92, GROUP_H = 34, ROW_GAP = 18

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type Placed = { kind: string; x: number; y: number; sprite: RawImage | null; icon: RawImage | null }

async function loadCell(kind: string, file: string): Promise<RawImage | null> {
  const p = join(LIB, kind, file)
  if (!existsSync(p)) return null
  const img = await decodePng(readFileSync(p))
  const k = Math.max(1, Math.floor(CELL / Math.max(img.width, img.height)))
  return upscaleNearest(img, k)
}

async function main(): Promise<void> {
  const kinds = ALL
    ? LIBRARY.map(e => ({ kind: e.kind, group: e.category }))
    : planBatch(BATCH).map(i => ({ kind: i.entry.kind, group: i.entry.category }))

  const groups = [...new Set(kinds.map(k => k.group))]
  // Lay out group by group so the master sheet reads as five labelled sections.
  const placed: Placed[] = []
  const groupLabels: { text: string; y: number }[] = []
  let y = HEADER_H
  for (const g of groups) {
    const inGroup = kinds.filter(k => k.group === g)
    groupLabels.push({ text: `${g} (${inGroup.length})`, y })
    y += GROUP_H
    for (let i = 0; i < inGroup.length; i++) {
      const col = i % COLS, row = (i / COLS) | 0
      placed.push({
        kind: inGroup[i]!.kind, sprite: null, icon: null,
        x: MARGIN + col * (BLOCK_W + GAP), y: y + row * (BLOCK_H + ROW_GAP),
      })
    }
    y += Math.ceil(inGroup.length / COLS) * (BLOCK_H + ROW_GAP)
  }

  for (const p of placed) {
    p.sprite = await loadCell(p.kind, 'sprite.png')
    p.icon = await loadCell(p.kind, 'icon.png')
  }

  const width = MARGIN * 2 + COLS * (BLOCK_W + GAP) - GAP
  const height = y + MARGIN
  const canvas = checkerBackground(width, height)

  const card = paletteCard()
  compositeOver(canvas, upscaleNearest(card, 1), width - MARGIN - card.width, 34)

  for (const p of placed) {
    if (p.sprite) compositeOver(canvas, p.sprite, p.x + ((CELL - p.sprite.width) >> 1), p.y + ((CELL - p.sprite.height) >> 1))
    if (p.icon) compositeOver(canvas, p.icon, p.x + CELL + GAP + ((CELL - p.icon.width) >> 1), p.y + ((CELL - p.icon.height) >> 1))
  }

  const labels = [
    `<text x="${MARGIN}" y="40" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="700" fill="#43394a">${esc(TITLE)}</text>`,
    `<text x="${MARGIN}" y="66" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#6b6270">left of each pair: world sprite. right: icon. palette card top-right. missing art shows as bare checker.</text>`,
    ...groupLabels.map(g =>
      `<text x="${MARGIN}" y="${g.y + 22}" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="700" fill="#43394a">${esc(g.text)}</text>`),
    ...placed.map(p =>
      `<text x="${p.x}" y="${p.y + CELL + 15}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="${p.sprite ? '#43394a' : '#b2453c'}">${esc(p.kind)}${p.sprite ? '' : ' (missing)'}</text>`),
    ...placed.map(p =>
      `<rect x="${p.x - 2}" y="${p.y - 2}" width="${BLOCK_W + 4}" height="${CELL + 4}" fill="none" stroke="#b8afa5" stroke-width="1"/>`),
  ].join('')
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels}</svg>`)

  mkdirSync(dirname(OUT), { recursive: true })
  const out = await sharp(await encodePng(canvas)).composite([{ input: overlay, top: 0, left: 0 }]).png().toBuffer()
  writeFileSync(OUT, out)
  console.log(`wrote ${OUT} (${width}x${height}, ${placed.length} entries, ${placed.filter(p => p.sprite).length} with art)`)
}

await main()
