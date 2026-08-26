// Batch index sheet for the v3 production run — ONE image for the batched human
// eyeball: every new founder contact sheet (plus the approved Omar reference row for
// comparison) and the 5 building previews. Zero generation, zero spend.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'
import { scratch } from './scratch.js'

const SCRATCH = scratch('c5')
const PRODUCTION = `${SCRATCH}/production`
const W = 1920
const LABEL_H = 44
const BG = { r: 24, g: 22, b: 28, alpha: 1 }

function label(text: string): Promise<Buffer> {
  const svg =
    `<svg width="${W}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="100%" height="100%" fill="#18161c"/>` +
    `<text x="16" y="${LABEL_H - 14}" font-family="Menlo, monospace" font-size="24" fill="#f6e8d5">${text}</text></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function fitWidth(path: string, width: number): Promise<Buffer> {
  return sharp(readFileSync(path))
    .resize({ width, kernel: 'lanczos3' })
    .flatten({ background: BG })
    .png()
    .toBuffer()
}

type Part = { buf: Buffer; h: number }
const parts: Part[] = []
async function add(buf: Buffer): Promise<void> {
  const meta = await sharp(buf).metadata()
  parts.push({ buf, h: meta.height })
}

await add(
  await label(
    'SAN JUNIPERO ASSET PRODUCTION — standard v3 (hi-res mirror pipeline) — HUMAN EYEBALL GATE',
  ),
)

const CHARS: [string, string][] = [
  ['omar', `${SCRATCH}/character-v4/contact-sheet.png`],
  ['amara', `${PRODUCTION}/amara/contact-sheet.png`],
  ['yusuf', `${PRODUCTION}/yusuf/contact-sheet.png`],
  ['nadia', `${PRODUCTION}/nadia/contact-sheet.png`],
  ['salma', `${PRODUCTION}/salma/contact-sheet.png`],
]
for (const [name, path] of CHARS) {
  if (!existsSync(path)) {
    console.log(`SKIP ${name}: ${path} missing`)
    continue
  }
  const note =
    name === 'omar'
      ? 'omar — APPROVED REFERENCE (not regenerated this run)'
      : `${name} — rows: masters | SE walk | NE walk | sleep | derived SW+NW flips`
  await add(await label(note))
  await add(await fitWidth(path, W))
}

const BUILDINGS = ['storehouse', 'wagon', 'shed', 'scaffolding', 'standing-stone']
await add(
  await label(
    'buildings — storehouse 2x2 | wagon 1x2 | shed 1x1 | scaffolding 1x1 | standing stone 1x1 (hut = approved anchor cottage)',
  ),
)
{
  const H = 340
  const thumbs: { buf: Buffer; w: number }[] = []
  for (const b of BUILDINGS) {
    const p = `${PRODUCTION}/building-${b}/preview-4x.png`
    if (!existsSync(p)) {
      console.log(`SKIP building ${b}`)
      continue
    }
    const buf = await sharp(readFileSync(p))
      .resize({ height: H, kernel: 'lanczos3' })
      .flatten({ background: BG })
      .png()
      .toBuffer()
    const meta = await sharp(buf).metadata()
    thumbs.push({ buf, w: meta.width })
  }
  const total = thumbs.reduce((n, t) => n + t.w, 0)
  const gap = Math.max(8, Math.floor((W - total) / (thumbs.length + 1)))
  const row = sharp({ create: { width: W, height: H, channels: 4, background: BG } })
  let x = gap
  const comps: sharp.OverlayOptions[] = []
  for (const t of thumbs) {
    comps.push({ input: t.buf, left: Math.min(x, W - t.w), top: 0 })
    x += t.w + gap
  }
  await add(await row.composite(comps).png().toBuffer())
}

const totalH = parts.reduce((n, p) => n + p.h, 0)
const comps: sharp.OverlayOptions[] = []
let y = 0
for (const p of parts) {
  comps.push({ input: p.buf, left: 0, top: y })
  y += p.h
}
const out = await sharp({ create: { width: W, height: totalH, channels: 4, background: BG } })
  .composite(comps)
  .png()
  .toBuffer()
writeFileSync(`${PRODUCTION}/batch-index.png`, out)
console.log(`batch-index.png written: ${W}x${totalH}`)
